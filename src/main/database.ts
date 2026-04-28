import { app } from 'electron'
import Database from 'better-sqlite3'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { readdirSync } from 'fs'
import { seedIfEmpty } from './seed'

let db: Database.Database | null = null

function migrationsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'migrations')
  }
  return join(app.getAppPath(), 'src', 'db', 'migrations')
}

function openDbPath(): string {
  const dir = join(app.getPath('userData'), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'lexpatrol.db')
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function initDatabase(): Database.Database {
  const path = openDbPath()
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

function applyMigrations(instance: Database.Database): void {
  instance.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  const appliedRows = instance.prepare('SELECT version FROM schema_migrations').all() as {
    version: number
  }[]
  const done = new Set(appliedRows.map((r) => r.version))

  const dir = migrationsDir()
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
    : []

  for (const file of files) {
    const version = parseInt(file.split('_')[0] ?? '0', 10)
    if (Number.isNaN(version) || done.has(version)) continue

    const sql = readFileSync(join(dir, file), 'utf-8')
    const run = instance.transaction(() => {
      instance.exec(sql)
      instance.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version)
    })
    run()
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
