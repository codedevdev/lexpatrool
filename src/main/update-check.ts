/**
 * Проверка обновлений по публичному API GitHub Releases (без electron-updater).
 * Репозиторий: owner/repo в переменной окружения LEX_GITHUB_REPO или по умолчанию codedevdev/lexpatrool.
 * Отключить: LEX_SKIP_UPDATE_CHECK=1
 */
import { app, type BrowserWindow } from 'electron'

const DEFAULT_REPO = 'codedevdev/lexpatrool'
const REQUEST_MS = 15_000
const STARTUP_DELAY_MS = 5_000

export type UpdateCheckResult = {
  currentVersion: string
  status: 'latest' | 'available' | 'error' | 'skipped'
  latestVersion?: string
  releaseUrl?: string
  /** Прямая ссылка на .exe установщика из последнего релиза (если нашли в assets). */
  downloadUrl?: string
  publishedAt?: string
  /** Короткий текст ошибки или подсказки */
  message?: string
}

interface GitHubRelease {
  tag_name: string
  html_url: string
  published_at?: string
  body?: string | null
  assets?: { name: string; browser_download_url: string }[]
}

export function getUpdateRepoLabel(): string {
  return process.env['LEX_GITHUB_REPO']?.trim() || DEFAULT_REPO
}

function parseRepo(): { owner: string; repo: string } | null {
  const raw = getUpdateRepoLabel()
  const parts = raw.split('/').filter(Boolean)
  if (parts.length !== 2) return null
  return { owner: parts[0]!, repo: parts[1]! }
}

/** Сравнение только по major.minor.patch в начале строки (без pre-release в первой версии). */
function parseTriple(v: string): [number, number, number] | null {
  const m = v.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)]
}

export function isRemoteVersionNewer(remoteTag: string, localVersion: string): boolean {
  const a = parseTriple(remoteTag)
  const b = parseTriple(localVersion)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true
    if (a[i]! < b[i]!) return false
  }
  return false
}

function pickDownloadUrl(rel: GitHubRelease): string {
  const assets = rel.assets ?? []
  const setup = assets.find((a) => /\.exe$/i.test(a.name) && /setup/i.test(a.name))
  if (setup?.browser_download_url) return setup.browser_download_url
  const anyExe = assets.find((a) => /\.exe$/i.test(a.name))
  if (anyExe?.browser_download_url) return anyExe.browser_download_url
  return rel.html_url
}

async function fetchLatestRelease(owner: string, repo: string): Promise<GitHubRelease | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), REQUEST_MS)
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'LexPatrol-Desktop/UpdateCheck'
      }
    })
    if (!res.ok) return null
    return (await res.json()) as GitHubRelease
  } finally {
    clearTimeout(timer)
  }
}

export async function checkForUpdates(currentVersion: string): Promise<UpdateCheckResult> {
  const cv = currentVersion.trim() || '0.0.0'

  if (process.env['LEX_SKIP_UPDATE_CHECK'] === '1') {
    return { currentVersion: cv, status: 'skipped', message: 'Проверка отключена (LEX_SKIP_UPDATE_CHECK).' }
  }

  const repo = parseRepo()
  if (!repo) {
    return {
      currentVersion: cv,
      status: 'error',
      message: `Некорректный LEX_GITHUB_REPO (нужно owner/repo).`
    }
  }

  try {
    const rel = await fetchLatestRelease(repo.owner, repo.repo)
    if (!rel?.tag_name) {
      return {
        currentVersion: cv,
        status: 'error',
        message: 'Не удалось получить данные о релизе (нет доступа или репозиторий пустой).'
      }
    }

    const remoteTag = rel.tag_name.trim()
    const newer = isRemoteVersionNewer(remoteTag, cv)

    if (!newer) {
      return {
        currentVersion: cv,
        status: 'latest',
        latestVersion: remoteTag.replace(/^v/i, ''),
        releaseUrl: rel.html_url,
        publishedAt: rel.published_at ?? undefined,
        message: `Последний релиз на GitHub: ${remoteTag}`
      }
    }

    const downloadUrl = pickDownloadUrl(rel)
    const notes =
      typeof rel.body === 'string' && rel.body.trim()
        ? rel.body.trim().slice(0, 1200) + (rel.body.length > 1200 ? '…' : '')
        : undefined

    return {
      currentVersion: cv,
      status: 'available',
      latestVersion: remoteTag.replace(/^v/i, ''),
      releaseUrl: rel.html_url,
      downloadUrl,
      publishedAt: rel.published_at ?? undefined,
      message: notes
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      currentVersion: cv,
      status: 'error',
      message:
        msg.includes('abort') || msg.includes('Abort')
          ? 'Таймаут или отмена запроса к GitHub.'
          : `Сеть: ${msg}`
    }
  }
}

export type UpdateAvailablePayload = {
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  downloadUrl: string
}

export function scheduleStartupUpdateCheck(getMainWindow: () => BrowserWindow | null): void {
  if (process.env['LEX_SKIP_UPDATE_CHECK'] === '1') return

  setTimeout(() => {
    void (async () => {
      try {
        const result = await checkForUpdates(app.getVersion())
        if (result.status !== 'available' || !result.latestVersion || !result.releaseUrl || !result.downloadUrl) return

        const win = getMainWindow()
        if (!win || win.isDestroyed()) return

        const payload: UpdateAvailablePayload = {
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          releaseUrl: result.releaseUrl,
          downloadUrl: result.downloadUrl
        }
        win.webContents.send('app:update-available', payload)
      } catch (e) {
        console.warn('[LexPatrol] startup update check:', e)
      }
    })()
  }, STARTUP_DELAY_MS)
}
