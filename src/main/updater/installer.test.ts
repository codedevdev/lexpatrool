import { readFileSync, unlinkSync, existsSync } from 'fs'
import { describe, expect, it, vi } from 'vitest'
import {
  installDirFromExe,
  launchExePathForInstallDir,
  needsElevationForInstallerTarget,
  prepareHelperConfig,
  spawnDetachedUpdateHelper
} from './installer'

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const child = { pid: 4242, unref: vi.fn() }
    return child
  })
}))

describe('installDirFromExe', () => {
  it('возвращает каталог установки по пути exe', () => {
    expect(installDirFromExe('C:\\Apps\\LexPatrol\\LexPatrol.exe')).toBe('C:\\Apps\\LexPatrol')
  })
})

describe('launchExePathForInstallDir', () => {
  it('добавляет LexPatrol.exe к каталогу', () => {
    expect(launchExePathForInstallDir('D:\\Lex')).toMatch(/LexPatrol\.exe$/)
  })
})

describe('needsElevationForInstallerTarget', () => {
  it('возвращает true для Program Files', () => {
    expect(needsElevationForInstallerTarget('C:\\Program Files\\LexPatrol')).toBe(true)
  })

  it('возвращает false для пользовательского каталога', () => {
    expect(needsElevationForInstallerTarget('C:\\Users\\me\\AppData\\Local\\LexPatrol')).toBe(false)
  })
})

describe('prepareHelperConfig', () => {
  it('заполняет поля для helper-скрипта', () => {
    const cfg = prepareHelperConfig({
      parentPid: 100,
      installerPath: 'C:\\tmp\\setup.exe',
      oldVersion: '1.0.0',
      silent: true
    })
    expect(cfg.parentPid).toBe(100)
    expect(cfg.installerPath).toContain('setup.exe')
    expect(cfg.silent).toBe(true)
    expect(cfg.oldVersion).toBe('1.0.0')
    expect(cfg.logPath.length).toBeGreaterThan(0)
  })
})

describe('spawnDetachedUpdateHelper', () => {
  it('пишет ps1/json и вызывает spawn с powershell', async () => {
    const { spawn } = await import('child_process')
    const cfg = prepareHelperConfig({
      parentPid: 1,
      installerPath: 'C:\\a\\setup.exe',
      oldVersion: '1.1.0',
      silent: false
    })
    const { ps1, json } = spawnDetachedUpdateHelper(cfg)
    try {
      expect(existsSync(ps1)).toBe(true)
      expect(existsSync(json)).toBe(true)
      const script = readFileSync(ps1, 'utf-8')
      expect(script).toContain('Wait-Process')
      expect(script).toContain('$ConfigPath')
      expect(vi.mocked(spawn).mock.calls.length).toBeGreaterThan(0)
      const [cmd, args] = vi.mocked(spawn).mock.calls[0]!
      expect(cmd).toMatch(/powershell/i)
      expect(args).toContain('-File')
      expect(args).toContain(ps1)
    } finally {
      try {
        unlinkSync(ps1)
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(json)
      } catch {
        /* ignore */
      }
    }
  })
})
