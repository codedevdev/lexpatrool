import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabase } from '../test-utils/memory-db'
import { globalShortcutTestHooks } from '../test-utils/stubs/electron'
import {
  applyOverlayGlobalShortcuts,
  DEFAULT_HOTKEYS,
  humanizeAccelerator,
  readHotkeys,
  saveHotkeys,
  validateAccelerator
} from './global-shortcuts'
import type { OverlayController } from './overlay-window'
import type { ToolOverlayController } from './tool-overlay-window'

afterEach(() => {
  globalShortcutTestHooks.reset()
})
describe('readHotkeys', () => {
  it('возвращает дефолты когда в app_settings нет записей', () => {
    const db = createTestDatabase()
    try {
      const h = readHotkeys(db)
      expect(h.toggle).toBe(DEFAULT_HOTKEYS.toggle)
      expect(h.search).toBe(DEFAULT_HOTKEYS.search)
    } finally {
      db.close()
    }
  })
})

describe('saveHotkeys', () => {
  it('сохраняет и readHotkeys возвращает обновлённое значение', () => {
    const db = createTestDatabase()
    try {
      const next = {
        ...DEFAULT_HOTKEYS,
        toggle: 'CommandOrControl+Shift+9'
      }
      saveHotkeys(db, next)
      expect(readHotkeys(db).toggle).toBe('CommandOrControl+Shift+9')
    } finally {
      db.close()
    }
  })
})

describe('humanizeAccelerator', () => {
  it('заменяет CommandOrControl на Ctrl в подписи для Windows', () => {
    const prev = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      expect(humanizeAccelerator('CommandOrControl+Shift+F')).toContain('Ctrl')
    } finally {
      Object.defineProperty(process, 'platform', { value: prev })
    }
  })
})

describe('validateAccelerator', () => {
  it('возвращает ошибку при пустой строке', () => {
    const r = validateAccelerator('   ')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Пустое/)
  })

  it('возвращает ошибку если globalShortcut.register вернул false', () => {
    globalShortcutTestHooks.setRegisterImpl(() => false)
    const r = validateAccelerator('CommandOrControl+Shift+Z')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Не удалось зарегистрировать/)
  })

  it('возвращает ошибку при исключении в register', () => {
    globalShortcutTestHooks.setRegisterImpl(() => {
      throw new Error('invalid accelerator')
    })
    const r = validateAccelerator('Bad+Combo')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('invalid accelerator')
  })

  it('возвращает ok при успешной регистрации и снятии', () => {
    const r = validateAccelerator('CommandOrControl+Shift+B')
    expect(r.ok).toBe(true)
    expect(globalShortcutTestHooks.unregisterCalls.length).toBeGreaterThan(0)
  })
})

describe('applyOverlayGlobalShortcuts', () => {
  it('вызывает unregisterAll и регистрирует коллбек для toggle', () => {
    const db = createTestDatabase()
    const before = globalShortcutTestHooks.unregisterAllCount
    const overlay: Pick<OverlayController, 'toggle' | 'show' | 'send' | 'ensure' | 'toggleClickThrough'> = {
      toggle: vi.fn(),
      show: vi.fn(),
      send: vi.fn(),
      ensure: vi.fn(),
      toggleClickThrough: vi.fn()
    }
    const tool: Pick<ToolOverlayController, 'toggle'> = { toggle: vi.fn() }
    try {
      applyOverlayGlobalShortcuts(
        overlay as OverlayController,
        tool as ToolOverlayController,
        tool as ToolOverlayController,
        db
      )
      expect(globalShortcutTestHooks.unregisterAllCount).toBeGreaterThanOrEqual(before + 1)
      const cb = globalShortcutTestHooks.getRegisteredCallback(DEFAULT_HOTKEYS.toggle)
      expect(cb).toBeTypeOf('function')
      cb?.()
      expect(overlay.toggle).toHaveBeenCalledTimes(1)
    } finally {
      db.close()
    }
  })

  it('для search вызывает overlay.show и overlay.send', () => {
    const db = createTestDatabase()
    const overlay: Pick<OverlayController, 'toggle' | 'show' | 'send' | 'ensure' | 'toggleClickThrough'> = {
      toggle: vi.fn(),
      show: vi.fn(),
      send: vi.fn(),
      ensure: vi.fn(),
      toggleClickThrough: vi.fn()
    }
    const tool: Pick<ToolOverlayController, 'toggle'> = { toggle: vi.fn() }
    try {
      applyOverlayGlobalShortcuts(
        overlay as OverlayController,
        tool as ToolOverlayController,
        tool as ToolOverlayController,
        db
      )
      globalShortcutTestHooks.getRegisteredCallback(DEFAULT_HOTKEYS.search)?.()
      expect(overlay.show).toHaveBeenCalledWith({ forceFocus: true })
      expect(overlay.send).toHaveBeenCalledWith('overlay:focus-search')
    } finally {
      db.close()
    }
  })
})
