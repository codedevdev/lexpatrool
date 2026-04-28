import { globalShortcut } from 'electron'
import type { Database } from 'better-sqlite3'
import type { OverlayController } from './overlay-window'

export interface HotkeyConfig {
  toggle: string
  search: string
  clickThrough: string
}

const STORAGE = {
  toggle: 'hotkey_overlay_toggle',
  search: 'hotkey_overlay_search',
  clickThrough: 'hotkey_overlay_clickthrough'
} as const

export const DEFAULT_HOTKEYS: HotkeyConfig = {
  toggle: 'CommandOrControl+Shift+Space',
  search: 'CommandOrControl+Shift+F',
  clickThrough: 'CommandOrControl+Shift+G'
}

export function readHotkeys(db: Database): HotkeyConfig {
  const one = (key: string, fallback: string): string => {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
    const v = row?.value?.trim()
    return v && v.length > 0 ? v : fallback
  }
  return {
    toggle: one(STORAGE.toggle, DEFAULT_HOTKEYS.toggle),
    search: one(STORAGE.search, DEFAULT_HOTKEYS.search),
    clickThrough: one(STORAGE.clickThrough, DEFAULT_HOTKEYS.clickThrough)
  }
}

export function saveHotkeys(db: Database, h: HotkeyConfig): void {
  const run = (key: string, val: string): void => {
    db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
      key,
      val
    )
  }
  run(STORAGE.toggle, h.toggle.trim())
  run(STORAGE.search, h.search.trim())
  run(STORAGE.clickThrough, h.clickThrough.trim())
}

/** Подпись для подсказок в UI (оверлей, настройки). */
export function humanizeAccelerator(acc: string): string {
  const isMac = process.platform === 'darwin'
  return acc
    .split('+')
    .map((p) => {
      if (p === 'CommandOrControl') return isMac ? '⌘' : 'Ctrl'
      if (p === 'Command') return '⌘'
      if (p === 'Control') return 'Ctrl'
      return p
    })
    .join('+')
}

export function validateAccelerator(acc: string): { ok: true } | { ok: false; error: string } {
  const trimmed = acc.trim()
  if (!trimmed) return { ok: false, error: 'Пустое сочетание' }
  try {
    const ok = globalShortcut.register(trimmed, (): void => {})
    if (!ok) return { ok: false, error: 'Не удалось зарегистрировать (занято системой или недопустимо)' }
    globalShortcut.unregister(trimmed)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg || 'Недопустимый accelerator' }
  }
}

export function applyOverlayGlobalShortcuts(overlay: OverlayController, db: Database): void {
  globalShortcut.unregisterAll()
  const h = readHotkeys(db)

  const reg = (accelerator: string, fn: () => void): void => {
    const ok = globalShortcut.register(accelerator, fn)
    if (!ok) {
      console.warn('[LexPatrol] global shortcut failed:', accelerator)
    }
  }

  reg(h.toggle, () => overlay.toggle())

  reg(h.search, () => {
    overlay.show()
    overlay.send('overlay:focus-search')
  })

  reg(h.clickThrough, () => {
    overlay.ensure()
    overlay.show()
    overlay.toggleClickThrough()
  })

  console.log('[LexPatrol] global shortcuts:', h.toggle, '|', h.search, '|', h.clickThrough)
}
