import { describe, expect, it } from 'vitest'
import { parseBackupJson } from './backup-restore'

describe('parseBackupJson', () => {
  it('принимает корректный бэкап version 1', () => {
    const raw = JSON.stringify({
      version: 1,
      exportedAt: '2020-01-01',
      data: { documents: [{ id: 'x' }] }
    })
    const r = parseBackupJson(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.version).toBe(1)
      expect(Array.isArray(r.data.documents)).toBe(true)
    }
  })

  it('отклоняет невалидный JSON', () => {
    const r = parseBackupJson('{')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/JSON/i)
  })

  it('отклоняет неверную версию', () => {
    const r = parseBackupJson(JSON.stringify({ version: 2, data: {} }))
    expect(r.ok).toBe(false)
  })

  it('отклоняет отсутствие data', () => {
    const r = parseBackupJson(JSON.stringify({ version: 1 }))
    expect(r.ok).toBe(false)
  })
})
