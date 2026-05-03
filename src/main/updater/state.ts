import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

const FILE = 'update-session-state.json'

export type UpdateSessionState = {
  version: 1
  /** Версия, с которой обновились (до установки). */
  oldVersion: string
  /** Целевая версия релиза. */
  targetVersion: string
  releaseUrl: string
  savedAt: string
  /** UI: маршрут React (pathname + search). */
  route?: string
  /** Открытый документ / статья в ридере. */
  reader?: { documentId: string; articleId?: string }
}

function path(): string {
  return join(app.getPath('userData'), FILE)
}

export function saveUpdateSessionState(state: Omit<UpdateSessionState, 'version' | 'savedAt'>): void {
  const full: UpdateSessionState = {
    version: 1,
    savedAt: new Date().toISOString(),
    ...state
  }
  writeFileSync(path(), JSON.stringify(full, null, 0), 'utf-8')
}

export function readUpdateSessionState(): UpdateSessionState | null {
  const p = path()
  if (!existsSync(p)) return null
  try {
    const raw = readFileSync(p, 'utf-8')
    const j = JSON.parse(raw) as UpdateSessionState
    if (j?.version !== 1 || typeof j.oldVersion !== 'string' || typeof j.targetVersion !== 'string') return null
    return j
  } catch {
    return null
  }
}

export function clearUpdateSessionState(): void {
  try {
    if (existsSync(path())) unlinkSync(path())
  } catch {
    /* ignore */
  }
}

export function parseUpdatedFromArgv(argv: readonly string[] = process.argv): string | null {
  const prefix = '--updated-from='
  for (const a of argv) {
    if (typeof a === 'string' && a.startsWith(prefix)) {
      const v = a.slice(prefix.length).trim()
      return v || null
    }
  }
  return null
}
