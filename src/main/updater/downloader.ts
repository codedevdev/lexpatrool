import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { finished } from 'stream/promises'
import { app } from 'electron'
import type { GitHubReleaseAsset } from './checker'

export type DownloadProgress = {
  received: number
  total: number | null
  percent: number | null
  bytesPerSecond: number | null
}

function updatesDir(): string {
  const d = join(app.getPath('userData'), 'updates')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/** Безопасное имя файла для диска. */
function safeFileName(name: string): string {
  return name.replace(/[^\w.\-()+ ]/g, '_').slice(0, 180) || 'setup.exe'
}

export function resolveDownloadTargetPath(asset: GitHubReleaseAsset): string {
  return join(updatesDir(), `${Date.now()}-${safeFileName(asset.name)}`)
}

/**
 * Скачивание по URL из ответа GitHub API (browser_download_url).
 * Запись во временный файл; при ошибке файл удаляется.
 */
export async function downloadReleaseAsset(
  asset: GitHubReleaseAsset,
  opts: {
    signal?: AbortSignal
    onProgress?: (p: DownloadProgress) => void
  }
): Promise<string> {
  const dest = resolveDownloadTargetPath(asset)
  const url = asset.browser_download_url
  let lastTick = Date.now()
  let lastReceived = 0

  const res = await fetch(url, {
    signal: opts.signal,
    headers: { 'User-Agent': 'LexPatrol-Desktop/UpdateDownload', Accept: '*/*' }
  })
  if (!res.ok) {
    throw new Error(`Скачивание: HTTP ${res.status}`)
  }

  const totalHeader = res.headers.get('content-length')
  const total = totalHeader ? parseInt(totalHeader, 10) : null

  const body = res.body
  if (!body) {
    throw new Error('Пустой ответ при скачивании.')
  }

  const ws = createWriteStream(dest)
  let received = 0

  try {
    const reader = body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (opts.signal?.aborted) {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        throw err
      }
      if (done) break
      if (value) {
        received += value.length
        ws.write(Buffer.from(value))
        const now = Date.now()
        if (now - lastTick >= 200 && opts.onProgress) {
          const dt = (now - lastTick) / 1000
          const dr = received - lastReceived
          const bps = dt > 0 ? dr / dt : null
          const percent = total && total > 0 ? Math.min(100, (received / total) * 100) : null
          opts.onProgress({ received, total, percent, bytesPerSecond: bps })
          lastTick = now
          lastReceived = received
        }
      }
    }
    ws.end()
    await finished(ws)
  } catch (e) {
    try {
      ws.destroy()
    } catch {
      /* ignore */
    }
    try {
      if (existsSync(dest)) unlinkSync(dest)
    } catch {
      /* ignore */
    }
    throw e
  }

  if (opts.onProgress) {
    const percent = total && total > 0 ? Math.min(100, (received / total) * 100) : received >= asset.size ? 100 : null
    opts.onProgress({ received, total, percent, bytesPerSecond: null })
  }

  return dest
}
