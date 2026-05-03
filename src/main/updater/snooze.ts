import type { Database } from 'better-sqlite3'

const KEY_VERSION = 'update_snooze_version'
const KEY_COUNT = 'update_snooze_count'

function writeSetting(db: Database, key: string, value: string): void {
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    key,
    value
  )
}

function readSetting(db: Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

/** Максимум отложений «Позже» для одной версии; после — баннер без откладывания. */
export const UPDATE_SNOOZE_MAX = 3

export function getSnoozeCountForVersion(db: Database, latestVersion: string): number {
  const v = readSetting(db, KEY_VERSION)
  if (v !== latestVersion) return 0
  const c = readSetting(db, KEY_COUNT)
  const n = parseInt(c ?? '0', 10)
  return Number.isFinite(n) ? n : 0
}

export function isSnoozeExhaustedForVersion(db: Database, latestVersion: string): boolean {
  return getSnoozeCountForVersion(db, latestVersion) >= UPDATE_SNOOZE_MAX
}

/**
 * Увеличить счётчик «Позже» для версии. Возвращает новый счётчик и флаг «дальше нельзя откладывать».
 */
export function recordUpdateSnooze(db: Database, latestVersion: string): { count: number; blocked: boolean } {
  const v = readSetting(db, KEY_VERSION)
  let next = 1
  if (v === latestVersion) {
    next = getSnoozeCountForVersion(db, latestVersion) + 1
  }
  writeSetting(db, KEY_VERSION, latestVersion)
  writeSetting(db, KEY_COUNT, String(next))
  return { count: next, blocked: next >= UPDATE_SNOOZE_MAX }
}
