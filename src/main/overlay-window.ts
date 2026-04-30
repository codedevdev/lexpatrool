import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import type { Database } from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { resolveAppIconPath } from './app-resources'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

type GetDb = () => Database

const BOUNDS_KEY = 'overlay_bounds'
const OVERLAY_AOT_KEY = 'overlay_always_on_top_level'
const OVERLAY_OPACITY_KEY = 'overlay_opacity'
const OVERLAY_CLICK_THROUGH_KEY = 'overlay_click_through'
const OVERLAY_INTERACTION_MODE_KEY = 'overlay_interaction_mode'
const DEFAULT_WIDTH_RATIO = 0.36

function olog(...args: unknown[]): void {
  console.log('[LexPatrol overlay]', ...args)
}

function shouldOpenOverlayDevTools(): boolean {
  if (app.isPackaged) return false
  return (
    process.env['LEX_OVERLAY_DEVTOOLS'] === '1' ||
    process.env['LEX_OPEN_DEVTOOLS'] === '1'
  )
}

function overlayDebugVerbose(): boolean {
  return process.env['LEX_OVERLAY_DEBUG'] === '1'
}

/**
 * Прозрачное frameless окно + отключённый GPU на Windows часто даёт «невидимое» окно (DWM не рисует слой).
 * По умолчанию — непрозрачный фон; прозрачность к игре: LEX_OVERLAY_TRANSPARENT=1
 */
function overlayWindowTransparent(): boolean {
  return process.env['LEX_OVERLAY_TRANSPARENT'] === '1'
}

function overlayRevealNoFocus(): boolean {
  return process.env['LEX_OVERLAY_NO_FOCUS'] === '1'
}

type OverlayAotLevel = 'off' | 'floating' | 'screen-saver' | 'pop-up-menu'
export type OverlayInteractionMode = 'game' | 'interactive'
export type OverlayDockPosition =
  | 'left'
  | 'right'
  | 'top-right'
  | 'center'
  | 'top-left'
  | 'bottom-left'
  | 'bottom-right'
  | 'compact-top-right'
  | 'wide-right'
type RevealOptions = { forceFocus?: boolean }

function readOverlayAotLevel(db: Database): OverlayAotLevel {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(OVERLAY_AOT_KEY) as
    | { value: string }
    | undefined
  const v = row?.value?.trim()
  if (v === 'off' || v === 'floating' || v === 'screen-saver' || v === 'pop-up-menu') return v
  /** По умолчанию — максимально возможный уровень под игры/полноэкранные окна (не помогает при exclusive fullscreen DirectX). */
  return 'pop-up-menu'
}

function readOverlayInteractionMode(db: Database): OverlayInteractionMode {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(OVERLAY_INTERACTION_MODE_KEY) as
    | { value: string }
    | undefined
  const v = row?.value?.trim()
  if (v === 'interactive' || v === 'game') return v
  return 'game'
}

type Bounds = { x: number; y: number; width: number; height: number }

function readBounds(db: Database): Bounds | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(BOUNDS_KEY) as
    | { value: string }
    | undefined
  if (!row?.value) return null
  try {
    const b = JSON.parse(row.value) as { x?: number; y?: number; width?: number; height?: number }
    if (
      typeof b.x === 'number' &&
      typeof b.y === 'number' &&
      typeof b.width === 'number' &&
      typeof b.height === 'number'
    ) {
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    }
  } catch {
    /* ignore */
  }
  return null
}

function writeBounds(db: Database, bounds: Bounds): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(BOUNDS_KEY, JSON.stringify(bounds))
}

/** Оверлей: отдельное окно поверх других; не встраивается в процесс игры. */
export class OverlayController {
  private win: BrowserWindow | null = null
  private clickThrough = false
  private alwaysOnTopLevel: OverlayAotLevel = 'floating'
  private readonly getDb: GetDb
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor(getDb: GetDb) {
    this.getDb = getDb
  }

  getClickThrough(): boolean {
    return this.clickThrough
  }

  getInteractionMode(): OverlayInteractionMode {
    return readOverlayInteractionMode(this.getDb())
  }

  private schedulePersistBounds(): void {
    const w = this.win
    if (!w || w.isDestroyed()) return
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      try {
        writeBounds(this.getDb(), w.getBounds())
      } catch {
        /* ignore */
      }
    }, 400)
  }

  ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) {
      olog('ensure: reuse existing window', { visible: this.win.isVisible(), bounds: this.win.getBounds() })
      return this.win
    }

    olog('ensure: creating BrowserWindow')
    const db = this.getDb()
    this.alwaysOnTopLevel = readOverlayAotLevel(db)
    const saved = readBounds(db)
    const { width: sw, height: sh, x: sx, y: sy } = workAreaForInitialBounds(saved)

    const defaultW = Math.min(440, Math.floor(sw * DEFAULT_WIDTH_RATIO))
    const defaultH = Math.min(680, Math.floor(sh * 0.78))
    const bounds: Bounds =
      saved && saved.width >= 200 && saved.height >= 200
        ? clampRectToWorkArea(saved, { x: sx, y: sy, width: sw, height: sh })
        : {
            width: defaultW,
            height: defaultH,
            x: sx + sw - defaultW - 12,
            y: sy + 36
          }

    const transparent = overlayWindowTransparent()
    const iconPath = resolveAppIconPath()
    this.win = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent,
      backgroundColor: transparent ? '#00000000' : '#0c0e14',
      icon: iconPath,
      alwaysOnTop: this.alwaysOnTopLevel !== 'off',
      skipTaskbar: true,
      resizable: true,
      minWidth: 280,
      minHeight: 320,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: app.isPackaged,
        /** Отдельное хранилище Chromium от главного окна — иначе два окна делят один SW/IndexedDB-профиль и на Windows бывает IO error при удалении БД (service_worker_storage.cc). */
        partition: 'persist:lexpatrol-overlay'
      }
    })

    try {
      this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    } catch {
      /* best-effort: Windows may ignore this, but macOS/Linux benefit from it */
    }

    olog('window created', {
      bounds,
      transparent,
      alwaysOnTopLevel: this.alwaysOnTopLevel,
      workArea: { sx, sy, sw, sh }
    })

    const ctRow = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(OVERLAY_CLICK_THROUGH_KEY) as
      | { value: string }
      | undefined
    this.setClickThrough(ctRow?.value === '1')

    this.applyAlwaysOnTopToWindow(this.win)

    this.win.on('move', () => this.schedulePersistBounds())
    this.win.on('resize', () => this.schedulePersistBounds())

    this.win.on('show', () => {
      olog('event: show')
      /** Синхронизация закрепов с БД при каждом показе — если ipc «pins-updated» пришёл до готовности React, список не потеряется. */
      this.send('overlay:pins-updated')
    })
    this.win.on('hide', () => olog('event: hide'))
    this.win.once('ready-to-show', () => olog('event: ready-to-show (window)'))

    const wc = this.win.webContents
    wc.on('did-start-loading', () => olog('webContents: did-start-loading'))
    wc.on('did-stop-loading', () => olog('webContents: did-stop-loading', { url: wc.getURL() }))
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      console.error('[LexPatrol overlay] did-fail-load', { code, desc, url, isMainFrame })
    })
    wc.on('render-process-gone', (_e, details) => {
      console.error('[LexPatrol overlay] render-process-gone', details)
    })
    if (overlayDebugVerbose()) {
      wc.on('console-message', (_e, level, message, line, sourceId) => {
        const text = String(message)
        if (text.includes('Electron Security Warning')) return
        if (text.includes('Download the React DevTools')) return
        olog(`renderer console [${level}]:`, text, sourceId != null && line != null ? `(${sourceId}:${line})` : '')
      })
    }

    if (process.env['ELECTRON_RENDERER_URL']) {
      const base = process.env['ELECTRON_RENDERER_URL'].replace(/\/$/, '')
      const url = `${base}/#/overlay`
      olog('loadURL (dev)', url)
      void this.win.loadURL(url)
    } else {
      /** HashRouter: нужен именно #/overlay, иначе pathname не совпадёт с /overlay и отрисуется главное окно + редирект. */
      const htmlPath = join(__dirname, '../renderer/index.html')
      olog('loadFile (packaged)', htmlPath, { hash: '/overlay' })
      void this.win.loadFile(htmlPath, { hash: '/overlay' })
    }

    if (shouldOpenOverlayDevTools()) {
      olog('opening DevTools (LEX_OVERLAY_DEVTOOLS=1 or LEX_OPEN_DEVTOOLS=1)')
      void wc.openDevTools({ mode: 'detach' })
    }

    this.win.on('closed', () => {
      olog('window closed')
      this.win = null
    })

    const opRow = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(OVERLAY_OPACITY_KEY) as
      | { value: string }
      | undefined
    wc.once('did-finish-load', () => {
      olog('webContents: did-finish-load', { url: wc.getURL() })
      if (!opRow?.value) return
      const n = Number(opRow.value)
      if (!Number.isNaN(n)) this.setOpacity(n)
    })

    return this.win
  }

  hide(): void {
    const w = this.win
    if (w && !w.isDestroyed()) {
      olog('hide()')
      w.hide()
    }
  }

  dock(where: OverlayDockPosition): void {
    const w = this.ensure()
    const { width: sw, height: sh, x: sx, y: sy } = screen.getDisplayMatching(w.getBounds()).workArea
    const cur = w.getBounds()
    const margin = 10
    switch (where) {
      case 'left':
        w.setBounds({ x: sx + margin, y: sy + margin, width: cur.width, height: sh - margin * 2 })
        break
      case 'right':
        w.setBounds({
          x: sx + sw - cur.width - margin,
          y: sy + margin,
          width: cur.width,
          height: sh - margin * 2
        })
        break
      case 'wide-right': {
        const width = Math.min(Math.max(cur.width, 520), Math.floor(sw * 0.42))
        w.setBounds({
          x: sx + sw - width - margin,
          y: sy + margin,
          width,
          height: sh - margin * 2
        })
        break
      }
      case 'top-left':
        w.setBounds({
          x: sx + margin,
          y: sy + margin,
          width: Math.min(cur.width, 480),
          height: Math.min(cur.height, Math.floor(sh * 0.85))
        })
        break
      case 'top-right':
        w.setBounds({
          x: sx + sw - cur.width - margin,
          y: sy + margin,
          width: Math.min(cur.width, 480),
          height: Math.min(cur.height, Math.floor(sh * 0.85))
        })
        break
      case 'bottom-left': {
        const width = Math.min(cur.width, 460)
        const height = Math.min(cur.height, Math.floor(sh * 0.72))
        w.setBounds({ x: sx + margin, y: sy + sh - height - margin, width, height })
        break
      }
      case 'bottom-right': {
        const width = Math.min(cur.width, 460)
        const height = Math.min(cur.height, Math.floor(sh * 0.72))
        w.setBounds({ x: sx + sw - width - margin, y: sy + sh - height - margin, width, height })
        break
      }
      case 'compact-top-right': {
        const width = Math.min(360, Math.max(320, Math.floor(sw * 0.28)))
        const height = Math.min(520, Math.max(360, Math.floor(sh * 0.56)))
        w.setBounds({ x: sx + sw - width - margin, y: sy + margin, width, height })
        break
      }
      default:
        w.setBounds({
          x: sx + Math.floor((sw - cur.width) / 2),
          y: sy + Math.floor((sh - cur.height) / 3),
          width: cur.width,
          height: cur.height
        })
    }
    this.schedulePersistBounds()
  }

  /** Показать поверх других окон без кражи фокуса из игры (по возможности). */
  show(options?: RevealOptions): void {
    olog('show() called')
    this.reveal(this.ensure(), options)
  }

  toggle(options?: RevealOptions): void {
    const w = this.ensure()
    olog('toggle()', { visible: w.isVisible() })
    if (w.isVisible()) w.hide()
    else this.reveal(w, options)
  }

  /** Поднять Z-order (удобно, если окно ушло под игру). */
  bringToFront(): void {
    olog('bringToFront()')
    const w = this.ensure()
    if (!w.isVisible()) this.reveal(w)
    else this.applyTopZOrder(w)
  }

  /** Прозрачное окно до первого кадра = полностью невидимо; ждём отрисовки. */
  private reveal(w: BrowserWindow, options?: RevealOptions): void {
    if (w.isDestroyed()) return
    const wc = w.webContents
    const loading = wc.isLoading()
    olog('reveal()', { loading, visible: w.isVisible(), opacity: w.getOpacity() })

    let done = false
    let revealTimer: ReturnType<typeof setTimeout> | null = null
    const go = (reason: string): void => {
      if (done || w.isDestroyed()) return
      done = true
      if (revealTimer) {
        clearTimeout(revealTimer)
        revealTimer = null
      }
      olog('reveal: showing window, reason:', reason, {
        bounds: w.getBounds(),
        visibleBefore: w.isVisible(),
        noFocus: this.shouldRevealWithoutFocus(options)
      })
      if (this.shouldRevealWithoutFocus(options)) {
        w.showInactive()
      } else {
        w.show()
        w.focus()
      }
      this.applyTopZOrder(w)
      olog('reveal: after show', { visible: w.isVisible(), focused: w.isFocused() })
    }

    revealTimer = setTimeout(() => {
      revealTimer = null
      if (!done && !w.isDestroyed() && !w.isVisible()) {
        olog('reveal: WARN timeout 8s — forcing show (ready-to-show may not fire for transparent/GPU)')
        go('timeout-fallback')
      }
    }, 8000)

    /**
     * Без «догоняющих» путей бывает гонка: `isLoading() === true`, а `ready-to-show` / `did-finish-load` уже
     * прошли до подписки — окно остаётся скрытым до таймаута 8 с. Слушаем оба события + микротаск/таймер.
     */
    w.once('ready-to-show', () => go('ready-to-show'))
    if (loading) {
      wc.once('did-finish-load', () => {
        olog('reveal: did-finish-load')
        queueMicrotask(() => go('did-finish-load'))
      })
    } else {
      queueMicrotask(() => go('already-not-loading'))
    }
    setTimeout(() => {
      if (done || w.isDestroyed() || w.isVisible()) return
      if (!wc.isLoading()) go('deferred-not-loading')
    }, 0)
  }

  private applyTopZOrder(w: BrowserWindow): void {
    this.alwaysOnTopLevel = readOverlayAotLevel(this.getDb())
    this.applyAlwaysOnTopToWindow(w)
    w.moveTop()
    this.reinforceTopZOrder(w)
  }

  private reinforceTopZOrder(w: BrowserWindow): void {
    if (this.alwaysOnTopLevel === 'off') return
    const reapply = (): void => {
      if (w.isDestroyed() || !w.isVisible()) return
      this.applyAlwaysOnTopToWindow(w)
      w.moveTop()
    }
    setTimeout(reapply, 80)
    setTimeout(reapply, 320)
  }

  /** Уровень «поверх окон» для оверлея (см. Electron `setAlwaysOnTop` second arg). */
  setAlwaysOnTopLevel(level: OverlayAotLevel): void {
    this.alwaysOnTopLevel = level
    const db = this.getDb()
    db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
      OVERLAY_AOT_KEY,
      level
    )
    const w = this.win
    if (w && !w.isDestroyed()) this.applyAlwaysOnTopToWindow(w)
  }

  setInteractionMode(mode: OverlayInteractionMode): void {
    const db = this.getDb()
    db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
      OVERLAY_INTERACTION_MODE_KEY,
      mode
    )
  }

  private shouldRevealWithoutFocus(options?: RevealOptions): boolean {
    if (overlayRevealNoFocus()) return true
    if (options?.forceFocus === true) return false
    return this.getInteractionMode() === 'game'
  }

  private applyAlwaysOnTopToWindow(w: BrowserWindow): void {
    if (this.alwaysOnTopLevel === 'off') {
      w.setAlwaysOnTop(false)
      return
    }
    const levelMap: Record<Exclude<OverlayAotLevel, 'off'>, NonNullable<Parameters<BrowserWindow['setAlwaysOnTop']>[1]>> = {
      floating: 'floating',
      'screen-saver': 'screen-saver',
      'pop-up-menu': 'pop-up-menu'
    }
    w.setAlwaysOnTop(true, levelMap[this.alwaysOnTopLevel])
  }

  send(channel: string, ...args: unknown[]): void {
    const w = this.win
    if (w && !w.isDestroyed()) w.webContents.send(channel, ...args)
  }

  /** После импорта БД — перезагрузить UI оверлея. */
  reloadIfOpen(): void {
    const w = this.win
    if (w && !w.isDestroyed()) w.webContents.reload()
  }

  setClickThrough(enabled: boolean): void {
    this.clickThrough = enabled
    const w = this.win
    if (!w || w.isDestroyed()) return
    w.setIgnoreMouseEvents(enabled, { forward: true })
  }

  /** Переключить «клики в игру» ↔ «клики в оверлей», сохранить в БД, уведомить рендерер. */
  toggleClickThrough(): void {
    const next = !this.clickThrough
    this.setClickThrough(next)
    try {
      this.getDb()
        .prepare(
          `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
        .run(OVERLAY_CLICK_THROUGH_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
    this.send('overlay:click-through-changed', next)
  }

  setOpacity(opacity: number): void {
    const w = this.win
    if (!w || w.isDestroyed()) return
    /** Слишком низкая непрозрачность: «мыльный» UI поверх игры/рабочего стола */
    w.setOpacity(Math.min(1, Math.max(0.28, opacity)))
  }

  getPinnedArticles(): unknown[] {
    const db = this.getDb()
    return db
      .prepare(
        `SELECT a.id, a.heading, a.article_number, a.body_clean, a.summary_short, a.penalty_hint, a.display_meta_json,
                d.id AS document_id, d.title AS document_title, d.article_import_filter AS document_article_import_filter, p.sort_order
         FROM overlay_pins p
         JOIN articles a ON a.id = p.article_id
         JOIN documents d ON d.id = a.document_id
         ORDER BY p.sort_order ASC`
      )
      .all()
  }
}

function clampRectToWorkArea(
  rect: Bounds,
  work: { x: number; y: number; width: number; height: number }
): Bounds {
  let { x, y, width, height } = rect
  const maxW = work.width - 20
  const maxH = work.height - 20
  width = Math.min(Math.max(width, 280), maxW)
  height = Math.min(Math.max(height, 320), maxH)
  x = Math.min(Math.max(x, work.x), work.x + work.width - width - 8)
  y = Math.min(Math.max(y, work.y), work.y + work.height - height - 8)
  return { x, y, width, height }
}

function workAreaForInitialBounds(saved: Bounds | null): Bounds {
  if (saved) {
    return screen.getDisplayMatching(saved).workArea
  }
  const cursor = screen.getCursorScreenPoint()
  return screen.getDisplayNearestPoint(cursor).workArea
}
