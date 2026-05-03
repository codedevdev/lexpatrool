import { app, BrowserWindow, screen } from 'electron'
import type { Display, Rectangle } from 'electron'
import { join } from 'path'
import type { Database } from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { resolveAppIconPath } from './app-resources'
import {
  OVERLAY_EDGE_MARGIN,
  OVERLAY_MAX_HEIGHT_FRAC,
  OVERLAY_ULTRAWIDE_MAX_WIDTH,
  overlayWidthForPreset,
  overlayWorkAreaIsUltrawide,
  type OverlayLayoutPreset
} from './overlay-layout-constants'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

type GetDb = () => Database

const BOUNDS_KEY = 'overlay_bounds'
const OVERLAY_UI_PREFS_KEY = 'overlay_ui_prefs'
const OVERLAY_AOT_KEY = 'overlay_always_on_top_level'
const OVERLAY_OPACITY_KEY = 'overlay_opacity'
const OVERLAY_CLICK_THROUGH_KEY = 'overlay_click_through'
const OVERLAY_INTERACTION_MODE_KEY = 'overlay_interaction_mode'

const EDGE = OVERLAY_EDGE_MARGIN

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

export type { OverlayLayoutPreset } from './overlay-layout-constants'

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

function readOverlayLayoutPreset(db: Database): OverlayLayoutPreset {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(OVERLAY_UI_PREFS_KEY) as
    | { value: string }
    | undefined
  if (!row?.value) return 'full'
  try {
    const j = JSON.parse(row.value) as { layoutPreset?: string }
    if (j.layoutPreset === 'compact' || j.layoutPreset === 'reading' || j.layoutPreset === 'full') {
      return j.layoutPreset
    }
  } catch {
    /* ignore */
  }
  return 'full'
}

type Bounds = { x: number; y: number; width: number; height: number }

type OverlayAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

type PersistedPlacementV2 = {
  v: 2
  displayId: number
  anchor: OverlayAnchor
  offsetXPct: number
  offsetYPct: number
  width: number
  height: number
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

function resolveDisplayForPlacement(p: PersistedPlacementV2): Display {
  const all = screen.getAllDisplays()
  const found = all.find((d) => d.id === p.displayId)
  return found ?? screen.getPrimaryDisplay()
}

function rectFromPlacement(p: PersistedPlacementV2, work: Rectangle): Bounds {
  const sx = work.x
  const sy = work.y
  const sw = work.width
  const sh = work.height
  const ox = p.offsetXPct / 100
  const oy = p.offsetYPct / 100
  const w = p.width
  const h = p.height
  let x: number
  let y: number
  switch (p.anchor) {
    case 'top-left':
      x = sx + ox * sw
      y = sy + oy * sh
      break
    case 'top-right':
      x = sx + sw - w - ox * sw
      y = sy + oy * sh
      break
    case 'bottom-left':
      x = sx + ox * sw
      y = sy + sh - h - oy * sh
      break
    case 'bottom-right':
      x = sx + sw - w - ox * sw
      y = sy + sh - h - oy * sh
      break
    default:
      x = sx + sw - w - ox * sw
      y = sy + oy * sh
  }
  return clampRectToWorkArea({ x, y, width: w, height: h }, work)
}

function inferPlacementFromBounds(b: Bounds, display: Display): PersistedPlacementV2 {
  const work = display.workArea
  const sx = work.x
  const sy = work.y
  const sw = work.width
  const sh = work.height
  const w = b.width
  const h = b.height
  const anchors: OverlayAnchor[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  let best: PersistedPlacementV2 = {
    v: 2,
    displayId: display.id,
    anchor: 'top-right',
    offsetXPct: clampPct(((sx + sw - w - b.x) / sw) * 100),
    offsetYPct: clampPct(((b.y - sy) / sh) * 100),
    width: w,
    height: h
  }
  let bestErr = Infinity
  for (const anchor of anchors) {
    let ox: number
    let oy: number
    switch (anchor) {
      case 'top-left':
        ox = ((b.x - sx) / sw) * 100
        oy = ((b.y - sy) / sh) * 100
        break
      case 'top-right':
        ox = ((sx + sw - w - b.x) / sw) * 100
        oy = ((b.y - sy) / sh) * 100
        break
      case 'bottom-left':
        ox = ((b.x - sx) / sw) * 100
        oy = ((sy + sh - h - b.y) / sh) * 100
        break
      case 'bottom-right':
        ox = ((sx + sw - w - b.x) / sw) * 100
        oy = ((sy + sh - h - b.y) / sh) * 100
        break
    }
    const oxC = clampPct(ox)
    const oyC = clampPct(oy)
    const r = rectFromPlacement(
      { v: 2, displayId: display.id, anchor, offsetXPct: oxC, offsetYPct: oyC, width: w, height: h },
      work
    )
    const err = Math.abs(r.x - b.x) + Math.abs(r.y - b.y)
    if (err < bestErr) {
      bestErr = err
      best = { v: 2, displayId: display.id, anchor, offsetXPct: oxC, offsetYPct: oyC, width: w, height: h }
    }
  }
  return best
}

function writePlacement(db: Database, p: PersistedPlacementV2): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(BOUNDS_KEY, JSON.stringify(p))
}

function readPersistedPlacement(db: Database): PersistedPlacementV2 | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(BOUNDS_KEY) as
    | { value: string }
    | undefined
  if (!row?.value) return null
  try {
    const raw = JSON.parse(row.value) as Record<string, unknown>
    if (raw['v'] === 2) {
      const displayId = raw['displayId']
      const anchor = raw['anchor']
      const offsetXPct = raw['offsetXPct']
      const offsetYPct = raw['offsetYPct']
      const width = raw['width']
      const height = raw['height']
      if (
        typeof displayId === 'number' &&
        (anchor === 'top-left' || anchor === 'top-right' || anchor === 'bottom-left' || anchor === 'bottom-right') &&
        typeof offsetXPct === 'number' &&
        typeof offsetYPct === 'number' &&
        typeof width === 'number' &&
        typeof height === 'number' &&
        width >= 200 &&
        height >= 200
      ) {
        return {
          v: 2,
          displayId,
          anchor,
          offsetXPct: clampPct(offsetXPct),
          offsetYPct: clampPct(offsetYPct),
          width,
          height
        }
      }
    }
    const x = raw['x']
    const y = raw['y']
    const w = raw['width']
    const h = raw['height']
    if (typeof x === 'number' && typeof y === 'number' && typeof w === 'number' && typeof h === 'number') {
      const rect: Bounds = { x, y, width: w, height: h }
      const display = screen.getDisplayMatching(rect)
      const migrated = inferPlacementFromBounds(rect, display)
      writePlacement(db, migrated)
      return migrated
    }
  } catch {
    /* ignore */
  }
  return null
}

function defaultInitialBounds(work: Rectangle, preset: OverlayLayoutPreset): Bounds {
  const sw = work.width
  const sh = work.height
  const ultrawide = overlayWorkAreaIsUltrawide(work)
  const width = overlayWidthForPreset(preset, sw, ultrawide)
  const height = Math.min(Math.floor(sh * 0.78), Math.floor(sh * OVERLAY_MAX_HEIGHT_FRAC))
  const x = work.x + sw - width - EDGE
  const y = work.y + Math.max(EDGE, Math.min(48, Math.floor(sh * 0.04)))
  return clampRectToWorkArea({ x, y, width, height }, work)
}

/** Оверлей: отдельное окно поверх других; не встраивается в процесс игры. */
export class OverlayController {
  private win: BrowserWindow | null = null
  private clickThrough = false
  private alwaysOnTopLevel: OverlayAotLevel = 'floating'
  private readonly getDb: GetDb
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private displayMetricsTimer: ReturnType<typeof setTimeout> | null = null
  private readonly onDisplayMetricsChangedBound: () => void

  constructor(getDb: GetDb) {
    this.getDb = getDb
    this.onDisplayMetricsChangedBound = (): void => {
      if (this.displayMetricsTimer) clearTimeout(this.displayMetricsTimer)
      this.displayMetricsTimer = setTimeout(() => {
        this.displayMetricsTimer = null
        this.applyDisplayMetricsUpdate()
      }, 200)
    }
    screen.on('display-metrics-changed', this.onDisplayMetricsChangedBound)
  }

  private applyDisplayMetricsUpdate(): void {
    const w = this.win
    if (!w || w.isDestroyed() || !w.isVisible()) return
    const db = this.getDb()
    const placement = readPersistedPlacement(db)
    if (!placement) {
      const b = w.getBounds()
      const work = screen.getDisplayMatching(b).workArea
      w.setBounds(clampRectToWorkArea(b, work))
      return
    }
    const display = resolveDisplayForPlacement(placement)
    const work = display.workArea
    const next = rectFromPlacement(placement, work)
    w.setBounds(next)
  }

  getClickThrough(): boolean {
    return this.clickThrough
  }

  getInteractionMode(): OverlayInteractionMode {
    return readOverlayInteractionMode(this.getDb())
  }

  /** Подогнать ширину под пресет UI, сохраняя край окна ближе к правой или левой границе workArea. */
  applyLayoutPreset(preset: OverlayLayoutPreset): void {
    const w = this.ensure()
    if (w.isDestroyed()) return
    const b = w.getBounds()
    const display = screen.getDisplayMatching(b)
    const work = display.workArea
    const ultrawide = overlayWorkAreaIsUltrawide(work)
    const newWidth = overlayWidthForPreset(preset, work.width, ultrawide)
    const distLeft = b.x - work.x
    const distRight = work.x + work.width - (b.x + b.width)
    let x = distRight < distLeft ? b.x + b.width - newWidth : b.x
    const maxH = Math.floor(work.height * OVERLAY_MAX_HEIGHT_FRAC)
    const height = Math.min(b.height, maxH)
    let next: Bounds = { x, y: b.y, width: newWidth, height }
    next = clampRectToWorkArea(next, work)
    w.setBounds(next)
    this.schedulePersistBounds()
  }

  private schedulePersistBounds(): void {
    const w = this.win
    if (!w || w.isDestroyed()) return
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      try {
        const b = w.getBounds()
        const display = screen.getDisplayMatching(b)
        const placement = inferPlacementFromBounds(b, display)
        writePlacement(this.getDb(), placement)
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
    const placement = readPersistedPlacement(db)
    const preset = readOverlayLayoutPreset(db)
    let bounds: Bounds
    if (placement) {
      const display = resolveDisplayForPlacement(placement)
      bounds = rectFromPlacement(placement, display.workArea)
    } else {
      const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
      bounds = defaultInitialBounds(work, preset)
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
      /* best-effort: Windows may ignore this, but macOS/Linux benefit from this */
    }

    olog('window created', {
      bounds,
      transparent,
      alwaysOnTopLevel: this.alwaysOnTopLevel
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
    const margin = EDGE
    const ultrawide = overlayWorkAreaIsUltrawide({ width: sw, height: sh })
    const cap = (x: number): number => (ultrawide ? Math.min(x, OVERLAY_ULTRAWIDE_MAX_WIDTH) : x)
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
        const target = Math.min(Math.max(cur.width, 520), Math.floor(sw * 0.42))
        const width = cap(target)
        w.setBounds({
          x: sx + sw - width - margin,
          y: sy + margin,
          width,
          height: sh - margin * 2
        })
        break
      }
      case 'top-left': {
        const width = ultrawide ? Math.min(cur.width, OVERLAY_ULTRAWIDE_MAX_WIDTH) : cur.width
        w.setBounds({
          x: sx + margin,
          y: sy + margin,
          width,
          height: Math.min(cur.height, Math.floor(sh * OVERLAY_MAX_HEIGHT_FRAC))
        })
        break
      }
      case 'top-right': {
        const width = ultrawide ? Math.min(cur.width, OVERLAY_ULTRAWIDE_MAX_WIDTH) : cur.width
        w.setBounds({
          x: sx + sw - width - margin,
          y: sy + margin,
          width,
          height: Math.min(cur.height, Math.floor(sh * OVERLAY_MAX_HEIGHT_FRAC))
        })
        break
      }
      case 'bottom-left': {
        const width = cap(Math.min(cur.width, 460))
        const height = Math.min(cur.height, Math.floor(sh * 0.72))
        w.setBounds({ x: sx + margin, y: sy + sh - height - margin, width, height })
        break
      }
      case 'bottom-right': {
        const width = cap(Math.min(cur.width, 460))
        const height = Math.min(cur.height, Math.floor(sh * 0.72))
        w.setBounds({ x: sx + sw - width - margin, y: sy + sh - height - margin, width, height })
        break
      }
      case 'compact-top-right': {
        const presetW = overlayWidthForPreset('compact', sw, ultrawide)
        const height = Math.min(520, Math.max(360, Math.floor(sh * 0.56)))
        w.setBounds({ x: sx + sw - presetW - margin, y: sy + margin, width: presetW, height })
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

function clampRectToWorkArea(rect: Bounds, work: Rectangle): Bounds {
  let { x, y, width, height } = rect
  const inset = EDGE * 2
  const maxW = Math.max(280, work.width - inset)
  const maxH = Math.max(320, work.height - inset)
  width = Math.min(Math.max(width, 280), maxW)
  height = Math.min(Math.max(height, 320), maxH)
  x = Math.min(Math.max(x, work.x + EDGE), work.x + work.width - width - EDGE)
  y = Math.min(Math.max(y, work.y + EDGE), work.y + work.height - height - EDGE)
  return { x, y, width, height }
}
