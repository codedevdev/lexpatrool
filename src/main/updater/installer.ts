import { writeFileSync } from 'fs'
import { join } from 'path'
import { win32 as winPath } from 'path'
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { appendUpdaterLog, ensureUpdaterLogPath } from './logger'

/** Каталог установки по пути exe: всегда win32-семантика (CI на Linux, релиз на Windows). */
export function installDirFromExe(exePath: string): string {
  return winPath.dirname(exePath)
}

export function launchExePathForInstallDir(installDir: string): string {
  return winPath.join(installDir, 'LexPatrol.exe')
}

/** Требуется ли elevation для записи в каталог установки. */
export function needsElevationForInstallerTarget(installDir: string): boolean {
  const low = installDir.replace(/\//g, '\\').toLowerCase()
  return low.includes('program files\\')
}

export type HelperConfig = {
  logPath: string
  parentPid: number
  installerPath: string
  installDir: string
  appExePath: string
  oldExePath: string
  oldVersion: string
  elevation: boolean
  silent: boolean
}

const PS1_TEMPLATE = `param(
  [Parameter(Mandatory = $true)]
  [string] $ConfigPath
)
$ErrorActionPreference = 'Stop'
$raw = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8
$cfg = $raw | ConvertFrom-Json
function Write-Log([string] $m) {
  try { Add-Content -LiteralPath $cfg.logPath -Value ("[{0}] {1}" -f (Get-Date).ToString("o"), $m) } catch {}
}
Write-Log "helper start pid=$($cfg.parentPid) silent=$($cfg.silent) elevation=$($cfg.elevation)"
try {
  try { Wait-Process -Id $cfg.parentPid -Timeout 30 -ErrorAction SilentlyContinue } catch {}
  Write-Log "after wait parent"
  $args = @()
  if ($cfg.silent) { $args += '/S' }
  $args += '/UPDATE'
  $args += ('/D=' + $cfg.installDir)
  $ec = 0
  try {
    if ($cfg.elevation) {
      $p = Start-Process -FilePath $cfg.installerPath -ArgumentList $args -Verb RunAs -Wait -PassThru
      $ec = if ($null -ne $p.ExitCode) { $p.ExitCode } else { 0 }
    } else {
      $p = Start-Process -FilePath $cfg.installerPath -ArgumentList $args -Wait -PassThru
      $ec = if ($null -ne $p.ExitCode) { $p.ExitCode } else { 0 }
    }
  } catch {
    Write-Log ("installer Start-Process failed: " + $_.Exception.Message)
    $ec = 1
  }
  Write-Log ("installer exit code: " + $ec)
  if ($ec -ne 0) {
    if (Test-Path -LiteralPath $cfg.oldExePath) {
      try { Start-Process -FilePath $cfg.oldExePath } catch { Write-Log ("rollback start old failed: " + $_.Exception.Message) }
    }
    Remove-Item -LiteralPath $ConfigPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
    exit $ec
  }
  Start-Sleep -Seconds 2
  $launchArg = '--updated-from=' + $cfg.oldVersion
  if (Test-Path -LiteralPath $cfg.appExePath) {
    try { Start-Process -FilePath $cfg.appExePath -ArgumentList $launchArg } catch { Write-Log ("start new app failed: " + $_.Exception.Message) }
  } else {
    Write-Log "app exe missing after install"
  }
  $deadline = (Get-Date).AddSeconds(10)
  $seen = $false
  while ((Get-Date) -lt $deadline) {
    $pr = Get-Process -Name 'LexPatrol' -ErrorAction SilentlyContinue
    if ($pr) { $seen = $true; break }
    Start-Sleep -Milliseconds 400
  }
  if (-not $seen) {
    Write-Log 'new LexPatrol process not seen within 10s'
    if (Test-Path -LiteralPath $cfg.oldExePath) {
      try { Start-Process -FilePath $cfg.oldExePath } catch { Write-Log ("fallback old exe failed: " + $_.Exception.Message) }
    }
  }
} catch {
  try { Add-Content -LiteralPath $cfg.logPath -Value ("helper fatal: " + $_.Exception.Message) } catch {}
}
Remove-Item -LiteralPath $ConfigPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
`

function randomId(): string {
  return randomBytes(8).toString('hex')
}

/**
 * Пишет helper.ps1 + config.json и запускает powershell detached.
 * Вызывающий затем должен немедленно завершить приложение.
 */
export function spawnDetachedUpdateHelper(cfg: HelperConfig): { ps1: string; json: string } {
  const base = join(tmpdir(), `lexpatrol-update-${randomId()}`)
  const jsonPath = `${base}.json`
  const ps1Path = `${base}.ps1`

  writeFileSync(ps1Path, PS1_TEMPLATE, 'utf-8')
  writeFileSync(jsonPath, JSON.stringify(cfg, null, 0), 'utf-8')

  appendUpdaterLog(
    `spawn helper ps1=${ps1Path} installer=${cfg.installerPath} installDir=${cfg.installDir} silent=${cfg.silent} elev=${cfg.elevation}`
  )

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1Path, '-ConfigPath', jsonPath],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }
  )
  child.unref()

  return { ps1: ps1Path, json: jsonPath }
}

export function prepareHelperConfig(opts: {
  parentPid: number
  installerPath: string
  oldVersion: string
  silent: boolean
}): HelperConfig {
  const { execPath } = process
  const installDir = installDirFromExe(execPath)
  const appExePath = launchExePathForInstallDir(installDir)
  const logPath = ensureUpdaterLogPath()
  return {
    logPath,
    parentPid: opts.parentPid,
    installerPath: opts.installerPath,
    installDir,
    appExePath,
    oldExePath: execPath,
    oldVersion: opts.oldVersion,
    elevation: needsElevationForInstallerTarget(installDir),
    silent: opts.silent
  }
}
