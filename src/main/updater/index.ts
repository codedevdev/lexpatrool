import { app, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { closeDatabase } from '../database'
import { destroyTray, setAppQuitting } from '../system-tray'
import type { OverlayController } from '../overlay-window'
import type { ToolOverlayController } from '../tool-overlay-window'
import { resolveAppIconPath } from '../app-resources'
import { appendUpdaterLog } from './logger'
import {
  fetchLatestRelease,
  getUpdateRepoLabel,
  isRemoteVersionNewer,
  type GitHubReleaseAsset
} from './checker'
import { downloadReleaseAsset, type DownloadProgress } from './downloader'
import { validateDownloadedInstaller, deleteInstallerIfInvalid } from './validator'
import { prepareHelperConfig, spawnDetachedUpdateHelper } from './installer'
import { saveUpdateSessionState } from './state'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'update-available'
  | 'downloading'
  | 'validating'
  | 'ready-to-install'
  | 'installing'
  | 'restarting'
  | 'done'
  | 'error'

export type InstallContext = {
  getMainWindow: () => BrowserWindow | null
  overlay: OverlayController
  cheatToolOverlay: ToolOverlayController
  collectionToolOverlay: ToolOverlayController
}

let phase: UpdatePhase = 'idle'
let phaseReason: string | null = null
let downloadAbort: AbortController | null = null
let validatedInstallerPath: string | null = null
let cachedSetupAsset: GitHubReleaseAsset | null = null
let cachedTargetVersion: string | null = null
let cachedReleaseUrl: string | null = null

function broadcast(ctx: InstallContext, channel: string, payload: unknown): void {
  const mw = ctx.getMainWindow()
  if (mw && !mw.isDestroyed()) {
    try {
      mw.webContents.send(channel, payload)
    } catch {
      /* ignore */
    }
  }
}

export function getUpdatePhase(): { phase: UpdatePhase; reason: string | null } {
  return { phase, reason: phaseReason }
}

export function resetUpdateFlowAfterError(): void {
  phase = 'idle'
  phaseReason = null
  validatedInstallerPath = null
  cachedSetupAsset = null
  cachedTargetVersion = null
  cachedReleaseUrl = null
}

function setPhase(ctx: InstallContext, p: UpdatePhase, reason?: string | null): void {
  phase = p
  phaseReason = reason ?? null
  broadcast(ctx, 'update:phase', { phase: p, reason: phaseReason })
}

function createInstallingSplash(): BrowserWindow {
  const iconPath = resolveAppIconPath()
  const splash = new BrowserWindow({
    width: 420,
    height: 200,
    frame: false,
    show: false,
    center: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: iconPath ?? undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;font-family:system-ui,sans-serif;background:#0c0e12;color:#e8eaef;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:24px;}
    h1{font-size:16px;font-weight:600;margin:0 0 8px;}
    p{font-size:13px;opacity:.85;margin:0;line-height:1.45;}
  </style></head><body><div><h1>Устанавливается обновление</h1><p>Не закрывайте это окно — LexPatrol перезапустится автоматически.</p></div></body></html>`
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  splash.once('ready-to-show', () => splash.show())
  return splash
}

/**
 * Скачивание и валидация установщика (Windows, NSIS-ассет из релиза).
 */
export async function runDownloadAndValidate(ctx: InstallContext): Promise<{ ok: true } | { ok: false; message: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Автоустановка поддерживается только в Windows.' }
  }
  if (process.env['PORTABLE_EXECUTABLE_DIR']) {
    return {
      ok: false,
      message: 'Портативная сборка: автоустановка недоступна. Скачайте установщик с GitHub и установите отдельно.'
    }
  }

  downloadAbort?.abort()
  downloadAbort = new AbortController()
  validatedInstallerPath = null
  cachedSetupAsset = null
  cachedTargetVersion = null
  cachedReleaseUrl = null

  setPhase(ctx, 'checking')
  appendUpdaterLog('download: start (re-fetch release)')

  const repo = getUpdateRepoLabel()
  const parts = repo.split('/').filter(Boolean)
  if (parts.length !== 2) {
    setPhase(ctx, 'error', 'Некорректный LEX_GITHUB_REPO')
    return { ok: false, message: 'Некорректный LEX_GITHUB_REPO (нужно owner/repo).' }
  }

  try {
    const rel = await fetchLatestRelease(parts[0]!, parts[1]!)
    if (!rel?.tag_name) {
      setPhase(ctx, 'error', 'Нет данных релиза')
      return { ok: false, message: 'Не удалось получить релиз с GitHub.' }
    }

    const cur = app.getVersion()
    const remoteTag = rel.tag_name.trim()
    if (!isRemoteVersionNewer(remoteTag, cur)) {
      setPhase(ctx, 'idle')
      return { ok: false, message: 'Обновление больше не доступно (уже последняя версия).' }
    }

    const assets = rel.assets ?? []
    const setup =
      assets.find((a) => /\.exe$/i.test(a.name) && /setup/i.test(a.name)) ??
      assets.find((a) => /\.exe$/i.test(a.name))
    if (!setup?.browser_download_url) {
      setPhase(ctx, 'error', 'Нет exe в релизе')
      return { ok: false, message: 'В релизе не найден установщик .exe.' }
    }

    cachedSetupAsset = setup
    cachedTargetVersion = remoteTag.replace(/^v/i, '')
    cachedReleaseUrl = rel.html_url

    setPhase(ctx, 'downloading')
    appendUpdaterLog(`download: asset=${setup.name} size=${setup.size}`)

    const dest = await downloadReleaseAsset(setup, {
      signal: downloadAbort.signal,
      onProgress: (p: DownloadProgress) => broadcast(ctx, 'update:progress', p)
    })

    setPhase(ctx, 'validating')
    const v = await validateDownloadedInstaller({
      filePath: dest,
      setupAsset: setup,
      releaseAssets: assets,
      signal: downloadAbort.signal
    })

    if (!v.ok) {
      deleteInstallerIfInvalid(dest, v)
      setPhase(ctx, 'error', v.message)
      appendUpdaterLog(`validate failed: ${v.message}`)
      return { ok: false, message: v.message }
    }

    validatedInstallerPath = dest
    setPhase(ctx, 'ready-to-install')
    appendUpdaterLog(`download+validate ok path=${dest}`)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('Abort') || msg === 'Aborted') {
      setPhase(ctx, 'idle')
      appendUpdaterLog('download: aborted')
      return { ok: false, message: 'Скачивание отменено.' }
    }
    setPhase(ctx, 'error', msg)
    appendUpdaterLog(`download error: ${msg}`)
    return { ok: false, message: msg }
  } finally {
    downloadAbort = null
  }
}

export function cancelUpdateDownload(ctx: InstallContext): void {
  downloadAbort?.abort()
  downloadAbort = null
  if (phase === 'downloading' || phase === 'validating') {
    setPhase(ctx, 'idle')
  }
}

export type ApplyInstallPayload = {
  silent: boolean
  route?: string
  reader?: { documentId: string; articleId?: string }
}

/**
 * Подготовка процесса, splash, detached helper, завершение приложения.
 */
export function applyValidatedInstallAndExit(
  ctx: InstallContext,
  payload: ApplyInstallPayload
): { ok: true } | { ok: false; message: string } {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Только Windows.' }
  }
  if (process.env['PORTABLE_EXECUTABLE_DIR']) {
    return { ok: false, message: 'Портативная сборка: используйте ручную установку.' }
  }
  const inst = validatedInstallerPath
  const setup = cachedSetupAsset
  const target = cachedTargetVersion
  const relUrl = cachedReleaseUrl
  if (!inst || !existsSync(inst) || !setup || !target || !relUrl) {
    return { ok: false, message: 'Сначала скачайте и проверьте обновление.' }
  }

  appendUpdaterLog(`apply: silent=${payload.silent} target=${target}`)

  const oldVersion = app.getVersion()
  saveUpdateSessionState({
    oldVersion,
    targetVersion: target,
    releaseUrl: relUrl,
    route: payload.route,
    reader: payload.reader
  })

  setAppQuitting(true)
  setPhase(ctx, 'installing')

  try {
    ctx.overlay.hide()
    ctx.cheatToolOverlay.hide()
    ctx.collectionToolOverlay.hide()
  } catch {
    /* ignore */
  }
  destroyTray()

  try {
    closeDatabase()
  } catch {
    /* ignore */
  }

  const splash = createInstallingSplash()

  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.id !== splash.id) {
      try {
        w.destroy()
      } catch {
        /* ignore */
      }
    }
  }

  const helperCfg = prepareHelperConfig({
    parentPid: process.pid,
    installerPath: inst,
    oldVersion,
    silent: payload.silent
  })
  spawnDetachedUpdateHelper(helperCfg)

  appendUpdaterLog('apply: helper spawned, app.exit')
  setTimeout(() => {
    try {
      app.exit(0)
    } catch {
      process.exit(0)
    }
  }, 400)

  return { ok: true }
}
