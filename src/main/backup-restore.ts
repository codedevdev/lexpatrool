import type { Database } from 'better-sqlite3'
import { LEX_BACKUP_TABLE_ORDER } from './backup-tables'

export type ParsedBackup =
  | { ok: true; version: number; exportedAt: string | null; data: Record<string, unknown[]> }
  | { ok: false; error: string }

function normalizeCell(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && (v as { type?: string }).type === 'Buffer') {
    const d = (v as { data?: unknown }).data
    if (Array.isArray(d) && d.every((x) => typeof x === 'number')) {
      return Buffer.from(d)
    }
  }
  return v
}

function insertRows(db: Database, table: string, rows: unknown[]): void {
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const o = row as Record<string, unknown>
    const cols = Object.keys(o).filter((k) => o[k] !== undefined)
    if (cols.length === 0) continue
    const qCols = cols.map((c) => `"${c.replace(/"/g, '""')}"`)
    const placeholders = cols.map(() => '?').join(', ')
    const sql = `INSERT INTO "${table.replace(/"/g, '""')}" (${qCols.join(', ')}) VALUES (${placeholders})`
    const vals = cols.map((c) => normalizeCell(o[c]))
    db.prepare(sql).run(...vals)
  }
}

export function parseBackupJson(raw: string): ParsedBackup {
  let j: unknown
  try {
    j = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Файл не является корректным JSON.' }
  }
  if (!j || typeof j !== 'object') return { ok: false, error: 'Неверный формат файла.' }
  const rec = j as { version?: unknown; data?: unknown; exportedAt?: unknown }
  if (rec.version !== 1) {
    return { ok: false, error: 'Поддерживается только резервная копия формата version: 1.' }
  }
  if (!rec.data || typeof rec.data !== 'object' || Array.isArray(rec.data)) {
    return { ok: false, error: 'В файле нет объекта data с таблицами.' }
  }
  const data = rec.data as Record<string, unknown[]>
  const exportedAt = typeof rec.exportedAt === 'string' ? rec.exportedAt : null
  return { ok: true, version: 1, exportedAt, data }
}

/**
 * Полная замена пользовательских данных в БД содержимым резервной копии.
 * Вызывать внутри уже открытого соединения; FTS и триггеры обновятся сами.
 */
export function restoreDatabaseFromBackupData(db: Database, data: Record<string, unknown[]>): void {
  const run = db.transaction(() => {
    db.pragma('foreign_keys = OFF')
    try {
      for (const t of LEX_BACKUP_TABLE_ORDER) {
        db.prepare(`DELETE FROM "${t}"`).run()
      }
      for (const t of LEX_BACKUP_TABLE_ORDER) {
        const rows = data[t]
        if (Array.isArray(rows) && rows.length > 0) {
          insertRows(db, t, rows)
        }
      }
    } finally {
      db.pragma('foreign_keys = ON')
    }
  })
  run()
}
