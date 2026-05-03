import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'

function logPath(): string {
  const dir = join(app.getPath('userData'), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'updater.log')
}

function ts(): string {
  return new Date().toISOString()
}

export function appendUpdaterLog(line: string): void {
  try {
    appendFileSync(logPath(), `[${ts()}] ${line}\n`, 'utf-8')
  } catch {
    /* ignore */
  }
}

export function getUpdaterLogFilePath(): string {
  const dir = join(app.getPath('userData'), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return logPath()
}

/** Path for helper script to append (same file). */
export function ensureUpdaterLogPath(): string {
  const p = logPath()
  const d = dirname(p)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return p
}
