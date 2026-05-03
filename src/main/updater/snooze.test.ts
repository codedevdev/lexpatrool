import { describe, expect, it } from 'vitest'
import { createTestDatabase } from '../../test-utils/memory-db'
import {
  getSnoozeCountForVersion,
  isSnoozeExhaustedForVersion,
  recordUpdateSnooze,
  UPDATE_SNOOZE_MAX
} from './snooze'

describe('getSnoozeCountForVersion', () => {
  it('возвращает 0 для новой версии', () => {
    const db = createTestDatabase()
    expect(getSnoozeCountForVersion(db, '9.9.9')).toBe(0)
    db.close()
  })
})

describe('recordUpdateSnooze', () => {
  it('увеличивает счётчик для той же версии', () => {
    const db = createTestDatabase()
    const v = '1.2.3'
    const a = recordUpdateSnooze(db, v)
    const b = recordUpdateSnooze(db, v)
    expect(b.count).toBe(a.count + 1)
    db.close()
  })

  it('сбрасывает счётчик при смене версии', () => {
    const db = createTestDatabase()
    recordUpdateSnooze(db, '1.0.0')
    const r = recordUpdateSnooze(db, '2.0.0')
    expect(r.count).toBe(1)
    db.close()
  })
})

describe('isSnoozeExhaustedForVersion', () => {
  it('возвращает true после максимума отложений', () => {
    const db = createTestDatabase()
    const v = '3.0.0'
    for (let i = 0; i < UPDATE_SNOOZE_MAX; i++) recordUpdateSnooze(db, v)
    expect(isSnoozeExhaustedForVersion(db, v)).toBe(true)
    db.close()
  })
})
