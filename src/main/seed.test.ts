import { describe, expect, it } from 'vitest'
import { createTestDatabase } from '../test-utils/memory-db'
import { seedIfEmpty } from '../main/seed'

describe('seedIfEmpty', () => {
  it('вставляет демо-данные в пустую базу', () => {
    const db = createTestDatabase()
    try {
      const before = (db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number }).c
      expect(before).toBe(0)
      seedIfEmpty(db)
      const after = (db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number }).c
      expect(after).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })

  it('идемпотентен при повторном вызове', () => {
    const db = createTestDatabase()
    try {
      seedIfEmpty(db)
      const n1 = (db.prepare('SELECT COUNT(*) AS c FROM articles').get() as { c: number }).c
      seedIfEmpty(db)
      const n2 = (db.prepare('SELECT COUNT(*) AS c FROM articles').get() as { c: number }).c
      expect(n2).toBe(n1)
    } finally {
      db.close()
    }
  })
})
