import { describe, expect, it } from 'vitest'
import { createTestDatabase } from '../test-utils/memory-db'
import { restoreDatabaseFromBackupData } from './backup-restore'
import { LEX_BACKUP_TABLE_ORDER } from './backup-tables'

function emptyBackupData(): Record<string, unknown[]> {
  const data: Record<string, unknown[]> = {}
  for (const t of LEX_BACKUP_TABLE_ORDER) data[t] = []
  return data
}

describe('restoreDatabaseFromBackupData', () => {
  it('заменяет содержимое tags данными из бэкапа', () => {
    const db = createTestDatabase()
    try {
      const data = emptyBackupData()
      data['tags'] = [{ id: 'tag-br', name: 'from-backup' }]
      restoreDatabaseFromBackupData(db, data)

      const row = db.prepare('SELECT name FROM tags WHERE id = ?').get('tag-br') as { name: string } | undefined
      expect(row?.name).toBe('from-backup')
    } finally {
      db.close()
    }
  })
})
