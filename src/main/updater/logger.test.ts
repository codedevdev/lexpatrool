import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendUpdaterLog, ensureUpdaterLogPath, getUpdaterLogFilePath } from './logger'
import { app } from '../../test-utils/stubs/electron'

describe('appendUpdaterLog', () => {
  afterEach(() => {
    try {
      const p = getUpdaterLogFilePath()
      if (existsSync(p)) rmSync(p, { force: true })
    } catch {
      /* ignore */
    }
  })

  it('добавляет строку в updater.log под userData', () => {
    appendUpdaterLog('test-line-xyz')
    const p = join(app.getPath('userData'), 'logs', 'updater.log')
    expect(existsSync(p)).toBe(true)
    const tail = readFileSync(p, 'utf-8')
    expect(tail).toContain('test-line-xyz')
  })

  it('ensureUpdaterLogPath возвращает абсолютный путь к логу', () => {
    const p = ensureUpdaterLogPath()
    expect(p).toMatch(/updater\.log$/)
    expect(p.includes('logs')).toBe(true)
  })
})
