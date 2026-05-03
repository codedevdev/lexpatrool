import Database from 'better-sqlite3'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '../db/migrations')

function applyMigrations(instance: Database.Database): void {
  instance.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  const appliedRows = instance.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
  const done = new Set(appliedRows.map((r) => r.version))

  const files = existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort()
    : []

  for (const file of files) {
    const version = parseInt(file.split('_')[0] ?? '0', 10)
    if (Number.isNaN(version) || done.has(version)) continue

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
    const run = instance.transaction(() => {
      instance.exec(sql)
      instance.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version)
    })
    run()
  }
}

/** In-memory SQLite with the same migrations as the desktop app (for retrieval / seed tests). */
export function createTestDatabase(): Database.Database {
  const db = new Database(':memory:', { timeout: 5000 })
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 8000')
  applyMigrations(db)
  return db
}
