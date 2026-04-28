import { app } from 'electron'
import Database from 'better-sqlite3'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { readdirSync } from 'fs'
import { seedIfEmpty } from './seed'

let db: Database.Database | null = null
/** Путь к lexpatrol.db после успешного init (для логов / поддержки). */
let openedDbPath: string | null = null

function migrationsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'migrations')
  }
  return join(app.getAppPath(), 'src', 'db', 'migrations')
}

function resolveDbFilePath(): string {
  const dir = join(app.getPath('userData'), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'lexpatrol.db')
}

/** Абсолютный путь к файлу БД (директория создаётся при первом init). */
export function getDatabasePath(): string {
  return openedDbPath ?? resolveDbFilePath()
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

function configureSqlite(instance: Database.Database): void {
  instance.pragma('journal_mode = WAL')
  instance.pragma('foreign_keys = ON')
  /** С WAL обычно достаточно NORMAL: меньше fsync без потери целостности при типичном одном writer (Electron main). */
  instance.pragma('synchronous = NORMAL')
  /**
   * SQLITE_BUSY при кратковременной конкуренции (антивирус, resize оверлея + запись настроек и т.д.).
   * Дублирует смысл опции конструктора timeout, но pragma явно видна в отладке.
   */
  instance.pragma('busy_timeout = 8000')
}

/**
 * Открывает SQLite, применяет миграции и пост-инициализацию.
 * Повторный вызов без close — возвращает тот же экземпляр (защита от двойного open).
 */
export function initDatabase(): Database.Database {
  if (db) return db

  const path = resolveDbFilePath()
  const verbose = !app.isPackaged && process.env['LEX_DB_DEBUG'] === '1'

  try {
    db = new Database(path, {
      timeout: 8000,
      readonly: false,
      fileMustExist: false
    })
  } catch (e) {
    console.error('[LexPatrol] SQLite: не удалось открыть файл', path, e)
    throw e
  }

  openedDbPath = path
  if (verbose) {
    console.log('[LexPatrol] SQLite:', path)
  }

  configureSqlite(db)
  applyMigrations(db)
  seedIfEmpty(db)
  cleanupOrphanSources(db)
  return db
}

/** Записи импорта без документа оставались после удаления документов (до исправления каскада). */
function cleanupOrphanSources(instance: Database.Database): void {
  instance.prepare(
    `DELETE FROM sources WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.source_id = sources.id)`
  ).run()
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

/**
 * Закрывает соединение. Перед закрытием — checkpoint WAL (меньше «висящего» wal-файла рядом с db после выхода).
 * Идемпотентно: повторные вызовы безопасны.
 */
export function closeDatabase(): void {
  if (!db) return

  const instance = db
  db = null

  try {
    instance.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* занятость / только чтение — не блокируем выход */
  }

  try {
    instance.close()
  } catch (e) {
    console.warn('[LexPatrol] SQLite: close()', e)
  }
}
