import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import type { Database } from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { resolveAppIconPath } from './app-resources'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

type GetDb = () => Database

const OVERLAY_AOT_KEY = 'overlay_always_on_top_level'
const OVERLAY_INTERACTION_MODE_KEY = 'overlay_interaction_mode'

export type ToolOverlayKind = 'cheats' | 'collections'

const CONFIG: Record<
  ToolOverlayKind,
  {
    boundsKey: string
    hashPath: string
    partition: string
    defaultWidthRatio: number
    defaultHeightRatio: number
    minW: number
    minH: number
  }
> = {
  cheats: {
    boundsKey: 'overlay_cheats_bounds',
    hashPath: '/overlay-cheats',
    partition: 'persist:lexpatrol-tool-cheats',
    defaultWidthRatio: 0.3,
    defaultHeightRatio: 0.72,
    minW: 260,
    minH: 280
  },
  collections: {
    boundsKey: 'overlay_collections_bounds',
    hashPath: '/overlay-collections',
    partition: 'persist:lexpatrol-tool-collections',
    defaultWidthRatio: 0.34,
    defaultHeightRatio: 0.76,
    minW: 280,
    minH: 300
  }
}

type OverlayAotLevel = 'off' | 'floating' | 'screen-saver' | 'pop-up-menu'
type OverlayInteractionMode = 'game' | 'interactive'
type RevealOptions = { forceFocus?: boolean }

function readOverlayAotLevel(db: Database): OverlayAotLevel {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(OVERLAY_AOT_KEY) as
    | { value: string }
    | undefined
  const v = row?.value?.trim()
  if (v === 'off' || v === 'floating' || v === 'screen-saver' || v === 'pop-up-menu') return v
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

function readBounds(db: Database, key: string): Bounds | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
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

function writeBounds(db: Database, key: string, bounds: Bounds): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, JSON.stringify(bounds))
}

function toolLog(kind: ToolOverlayKind, ...args: unknown[]): void {
  console.log(`[LexPatrol tool-overlay:${kind}]`, ...args)
}

function shouldOpenToolOverlayDevTools(): boolean {
  if (app.isPackaged) return false
  return (
    process.env['LEX_TOOL_OVERLAY_DEVTOOLS'] === '1' ||
    process.env['LEX_OVERLAY_DEVTOOLS'] === '1' ||
    process.env['LEX_OPEN_DEVTOOLS'] === '1'
  )
}

function toolWindowTransparent(): boolean {
  return process.env['LEX_OVERLAY_TRANSPARENT'] === '1'
}

function toolOverlayRevealNoFocus(): boolean {
  return process.env['LEX_OVERLAY_NO_FOCUS'] === '1'
}

function clampRectToWorkArea(
  rect: Bounds,
  work: { x: number; y: number; width: number; height: number },
  minW: number,
  minH: number
): Bounds {
  let { x, y, width, height } = rect
  const maxW = work.width - 20
  const maxH = work.height - 20
  width = Math.min(Math.max(width, minW), maxW)
  height = Math.min(Math.max(height, minH), maxH)
  x = Math.min(Math.max(x, work.x), work.x + work.width - width - 8)
  y = Math.min(Math.max(y, work.y), work.y + work.height - height - 8)
  return { x, y, width, height }
}

/** Отдельное frameless окно для шпаргалок или подборок поверх игры. */
export class ToolOverlayController {
  private win: BrowserWindow | null = null
  private alwaysOnTopLevel: OverlayAotLevel = 'floating'
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly getDb: GetDb,
    public readonly kind: ToolOverlayKind
  ) {}

  private cfg(): (typeof CONFIG)['cheats'] {
    return CONFIG[this.kind]
  }

  private schedulePersistBounds(): void {
    const w = this.win
    if (!w || w.isDestroyed()) return
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      try {
        writeBounds(this.getDb(), this.cfg().boundsKey, w.getBounds())
      } catch {
        /* ignore */
      }
    }, 400)
  }

  ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win

    const db = this.getDb()
    const c = this.cfg()
    this.alwaysOnTopLevel = readOverlayAotLevel(db)
    const saved = readBounds(db, c.boundsKey)
    const { width: sw, height: sh, x: sx, y: sy } = workAreaForInitialBounds(saved)

    const defaultW = Math.min(480, Math.floor(sw * c.defaultWidthRatio))
    const defaultH = Math.min(720, Math.floor(sh * c.defaultHeightRatio))
    const bounds: Bounds =
      saved && saved.width >= c.minW && saved.height >= c.minH
        ? clampRectToWorkArea(saved, { x: sx, y: sy, width: sw, height: sh }, c.minW, c.minH)
        : {
            width: defaultW,
            height: defaultH,
            x: sx + sw - defaultW - 12,
            y: sy + 48
          }

    const transparent = toolWindowTransparent()
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
      minWidth: c.minW,
      minHeight: c.minH,
      show: false,
      opacity: 1,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: app.isPackaged,
        partition: c.partition
      }
    })

    try {
      this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    } catch {
      /* best-effort: Windows may ignore this, but macOS/Linux benefit from it */
    }

    this.applyAlwaysOnTopToWindow(this.win)
    this.win.on('move', () => this.schedulePersistBounds())
    this.win.on('resize', () => this.schedulePersistBounds())
    this.win.on('closed', () => {
      this.win = null
    })

    const wc = this.win.webContents
    const route = c.hashPath.startsWith('/') ? c.hashPath.slice(1) : c.hashPath
    if (process.env['ELECTRON_RENDERER_URL']) {
      const base = process.env['ELECTRON_RENDERER_URL'].replace(/\/$/, '')
      void this.win.loadURL(`${base}/#/${route}`)
    } else {
      const htmlPath = join(__dirname, '../renderer/index.html')
      void this.win.loadFile(htmlPath, { hash: `/${route}` })
    }

    if (shouldOpenToolOverlayDevTools()) {
      void wc.openDevTools({ mode: 'detach' })
    }

    toolLog(this.kind, 'window created', bounds)
    return this.win
  }

  hide(): void {
    const w = this.win
    if (w && !w.isDestroyed()) w.hide()
  }

  /** Как основной оверлей: дождаться готовности, иначе frameless/прозрачное окно часто не появляется. */
  private reveal(w: BrowserWindow, options?: RevealOptions): void {
    if (w.isDestroyed()) return
    const wc = w.webContents
    const loading = wc.isLoading()
    toolLog(this.kind, 'reveal()', { loading, visible: w.isVisible() })

    let done = false
    let revealTimer: ReturnType<typeof setTimeout> | null = null
    const go = (reason: string): void => {
      if (done || w.isDestroyed()) return
      done = true
      if (revealTimer) {
        clearTimeout(revealTimer)
        revealTimer = null
      }
      toolLog(this.kind, 'reveal show', reason)
      if (this.shouldRevealWithoutFocus(options)) {
        w.showInactive()
      } else {
        w.show()
        w.focus()
      }
      this.applyTopZOrder(w)
    }

    revealTimer = setTimeout(() => {
      revealTimer = null
      if (!done && !w.isDestroyed() && !w.isVisible()) {
        toolLog(this.kind, 'reveal timeout — forcing show')
        go('timeout-fallback')
      }
    }, 8000)

    w.once('ready-to-show', () => go('ready-to-show'))
    if (loading) {
      wc.once('did-finish-load', () => {
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

  show(options?: RevealOptions): void {
    const w = this.ensure()
    if (w.isDestroyed()) return
    if (w.isVisible()) {
      this.applyTopZOrder(w)
      return
    }
    this.reveal(w, options)
  }

  toggle(options?: RevealOptions): void {
    const w = this.ensure()
    if (w.isDestroyed()) return
    if (w.isVisible()) w.hide()
    else this.reveal(w, options)
  }

  bringToFront(): void {
    const w = this.ensure()
    if (w.isDestroyed()) return
    if (!w.isVisible()) this.reveal(w)
    else this.applyTopZOrder(w)
  }

  dock(where: 'left' | 'right' | 'top-right' | 'center'): void {
    const w = this.ensure()
    const { width: sw, height: sh, x: sx, y: sy } = screen.getDisplayMatching(w.getBounds()).workArea
    const cur = w.getBounds()
    const margin = 10
    const c = this.cfg()
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
      case 'top-right':
        w.setBounds({
          x: sx + sw - cur.width - margin,
          y: sy + margin,
          width: Math.min(cur.width, 440),
          height: Math.min(cur.height, Math.floor(sh * 0.85))
        })
        break
      default:
        w.setBounds({
          x: sx + Math.floor((sw - cur.width) / 2),
          y: sy + Math.floor((sh - cur.height) / 3),
          width: Math.max(cur.width, c.minW),
          height: Math.max(cur.height, c.minH)
        })
    }
    this.schedulePersistBounds()
  }

  send(channel: string, ...args: unknown[]): void {
    const w = this.win
    if (w && !w.isDestroyed()) w.webContents.send(channel, ...args)
  }

  reloadIfOpen(): void {
    const w = this.win
    if (w && !w.isDestroyed()) w.webContents.reload()
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

  private shouldRevealWithoutFocus(options?: RevealOptions): boolean {
    if (toolOverlayRevealNoFocus()) return true
    if (options?.forceFocus === true) return false
    return readOverlayInteractionMode(this.getDb()) === 'game'
  }
}

function workAreaForInitialBounds(saved: Bounds | null): Bounds {
  if (saved) {
    return screen.getDisplayMatching(saved).workArea
  }
  const cursor = screen.getCursorScreenPoint()
  return screen.getDisplayNearestPoint(cursor).workArea
}
