/**
 * Проверка обновлений по публичному API GitHub Releases (без electron-updater).
 * Репозиторий: LEX_GITHUB_REPO или codedevdev/lexpatrool.
 * LEX_SKIP_UPDATE_CHECK=1 — отключить.
 */
import { app, type BrowserWindow } from 'electron'
import { getDb } from '../database'

export const DEFAULT_REPO = 'codedevdev/lexpatrool'
const REQUEST_MS = 15_000
const STARTUP_DELAY_MS = 5_000

/** Ассет релиза (поля, нужные для скачивания и валидации). */
export type GitHubReleaseAsset = {
  name: string
  size: number
  browser_download_url: string
}

export type UpdateCheckResult = {
  currentVersion: string
  status: 'latest' | 'available' | 'error' | 'skipped'
  latestVersion?: string
  releaseUrl?: string
  /** Прямая ссылка на .exe установщика (как раньше). */
  downloadUrl?: string
  publishedAt?: string
  message?: string
  /** Тело релиза содержит маркер [critical] (регистронезависимо). */
  critical?: boolean
  /** Выбранный NSIS Setup-ассет (если есть); для внутреннего скачивания. */
  setupAsset?: GitHubReleaseAsset
  /** Все ассеты последнего релиза (для поиска .sha256). */
  releaseAssets?: GitHubReleaseAsset[]
}

export interface GitHubRelease {
  tag_name: string
  html_url: string
  published_at?: string
  body?: string | null
  assets?: GitHubReleaseAsset[]
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

/** Сравнение только по major.minor.patch в начале строки. */
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

export function releaseBodyHasCritical(body: string | null | undefined): boolean {
  if (!body || typeof body !== 'string') return false
  return /\[critical\]/i.test(body)
}

function pickSetupAsset(rel: GitHubRelease): GitHubReleaseAsset | null {
  const assets = rel.assets ?? []
  const setup = assets.find((a) => /\.exe$/i.test(a.name) && /setup/i.test(a.name))
  if (setup?.browser_download_url && typeof setup.size === 'number') return normalizeAsset(setup)
  const anyExe = assets.find((a) => /\.exe$/i.test(a.name))
  if (anyExe?.browser_download_url && typeof anyExe.size === 'number') return normalizeAsset(anyExe)
  return null
}

function normalizeAsset(a: { name: string; size: number; browser_download_url: string }): GitHubReleaseAsset {
  return { name: a.name, size: a.size, browser_download_url: a.browser_download_url }
}

function pickDownloadUrl(rel: GitHubRelease): string {
  const s = pickSetupAsset(rel)
  if (s) return s.browser_download_url
  return rel.html_url
}

function normalizeAssets(assets: GitHubRelease['assets']): GitHubReleaseAsset[] {
  if (!Array.isArray(assets)) return []
  return assets
    .filter(
      (a): a is GitHubReleaseAsset =>
        typeof a?.name === 'string' &&
        typeof a?.browser_download_url === 'string' &&
        typeof a?.size === 'number'
    )
    .map((a) => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url }))
}

export async function fetchLatestRelease(owner: string, repo: string): Promise<GitHubRelease | null> {
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
    const json = (await res.json()) as GitHubRelease
    if (json.assets) json.assets = normalizeAssets(json.assets)
    return json
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
    const critical = releaseBodyHasCritical(rel.body)
    const setupAsset = pickSetupAsset(rel)
    const releaseAssets = rel.assets ?? []

    if (!newer) {
      return {
        currentVersion: cv,
        status: 'latest',
        latestVersion: remoteTag.replace(/^v/i, ''),
        releaseUrl: rel.html_url,
        publishedAt: rel.published_at ?? undefined,
        message: `Последний релиз на GitHub: ${remoteTag}`,
        critical,
        releaseAssets
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
      message: notes,
      critical,
      setupAsset: setupAsset ?? undefined,
      releaseAssets
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
  publishedAt?: string
  releaseNotes?: string
  critical?: boolean
}

function readNotifyStartupEnabled(): boolean {
  if (process.env['LEX_SKIP_UPDATE_CHECK'] === '1') return false
  try {
    const row = getDb()
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get('update_notify_startup') as { value: string } | undefined
    if (row?.value === '0') return false
    return true
  } catch {
    return true
  }
}

export function scheduleStartupUpdateCheck(getMainWindow: () => BrowserWindow | null): void {
  if (process.env['LEX_SKIP_UPDATE_CHECK'] === '1') return
  if (!readNotifyStartupEnabled()) return

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
          downloadUrl: result.downloadUrl,
          publishedAt: result.publishedAt,
          releaseNotes: result.message && result.status === 'available' ? result.message : undefined,
          critical: result.critical
        }
        win.webContents.send('app:update-available', payload)
      } catch (e) {
        console.warn('[LexPatrol] startup update check:', e)
      }
    })()
  }, STARTUP_DELAY_MS)
}
