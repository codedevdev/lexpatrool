/**
 * Minimal Electron stub for Vitest (main-process modules that import `electron`).
 */
import { mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const userData = join(tmpdir(), 'lexpatrol-vitest-userdata')

try {
  mkdirSync(userData, { recursive: true })
} catch {
  /* ignore */
}

export const app = {
  getPath: (name: string): string => {
    if (name === 'userData') return userData
    return join(userData, name)
  },
  getVersion: (): string => '1.0.0',
  isPackaged: false
}

const registered = new Map<string, () => void>()
const unregisterCalls: string[] = []
let unregisterAllCount = 0

let registerImpl: (accelerator: string, callback: () => void) => boolean = (accelerator, callback) => {
  registered.set(accelerator, callback)
  return true
}

/** Сброс и подмена поведения `globalShortcut` в тестах (тот же модуль, что подставляется вместо `electron`). */
export const globalShortcutTestHooks = {
  reset(): void {
    registered.clear()
    unregisterCalls.length = 0
    unregisterAllCount = 0
    registerImpl = (accelerator, callback) => {
      registered.set(accelerator, callback)
      return true
    }
  },
  setRegisterImpl(fn: (accelerator: string, callback: () => void) => boolean): void {
    registerImpl = fn
  },
  getRegisteredCallback(accelerator: string): (() => void) | undefined {
    return registered.get(accelerator)
  },
  get unregisterCalls(): readonly string[] {
    return unregisterCalls
  },
  get unregisterAllCount(): number {
    return unregisterAllCount
  }
}

export const globalShortcut = {
  register(accelerator: string, callback: () => void): boolean {
    return registerImpl(accelerator, callback)
  },
  unregister(accelerator: string): void {
    unregisterCalls.push(accelerator)
    registered.delete(accelerator)
  },
  unregisterAll(): void {
    unregisterAllCount++
    registered.clear()
  }
}

/** Satisfies `type BrowserWindow` imports from modules under test. */
export type BrowserWindow = {
  isDestroyed(): boolean
  webContents: { send: (channel: string, ...args: unknown[]) => void }
}
