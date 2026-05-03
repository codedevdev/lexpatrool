import { afterEach, describe, expect, it, vi } from 'vitest'
import releaseFixture from './__fixtures__/valid-release-response.json' assert { type: 'json' }
import emptyAssetsFixture from './__fixtures__/release-without-assets.json' assert { type: 'json' }
import {
  checkForUpdates,
  fetchLatestRelease,
  getUpdateRepoLabel,
  isRemoteVersionNewer,
  releaseBodyHasCritical
} from './checker'

describe('isRemoteVersionNewer', () => {
  it('возвращает true когда удалённая patch-версия выше', () => {
    expect(isRemoteVersionNewer('v1.7.1', '1.7.0')).toBe(true)
  })

  it('возвращает false при равных semver', () => {
    expect(isRemoteVersionNewer('v2.0.0', '2.0.0')).toBe(false)
  })

  it('возвращает false когда локальная версия новее', () => {
    expect(isRemoteVersionNewer('1.0.0', '2.0.0')).toBe(false)
  })

  it('возвращает false при непарсящихся версиях', () => {
    expect(isRemoteVersionNewer('latest', '1.0.0')).toBe(false)
    expect(isRemoteVersionNewer('v1.0.0', 'dev')).toBe(false)
  })
})

describe('releaseBodyHasCritical', () => {
  it('находит маркер [critical] в теле релиза', () => {
    expect(releaseBodyHasCritical('hello [critical] world')).toBe(true)
  })

  it('регистронезависимый поиск', () => {
    expect(releaseBodyHasCritical('[Critical]')).toBe(true)
  })

  it('возвращает false для пустого или не-строки', () => {
    expect(releaseBodyHasCritical('')).toBe(false)
    expect(releaseBodyHasCritical(undefined)).toBe(false)
    expect(releaseBodyHasCritical(null)).toBe(false)
  })
})

describe('getUpdateRepoLabel', () => {
  afterEach(() => {
    delete process.env.LEX_GITHUB_REPO
  })

  it('использует LEX_GITHUB_REPO когда задан', () => {
    process.env.LEX_GITHUB_REPO = '  myorg/myrepo  '
    expect(getUpdateRepoLabel()).toBe('myorg/myrepo')
  })

  it('подставляет репозиторий по умолчанию', () => {
    expect(getUpdateRepoLabel()).toMatch(/^.+\/.+$/)
  })
})

describe('fetchLatestRelease', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('нормализует ассеты и отбрасывает записи без обязательных полей', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          tag_name: 'v1.0.0',
          html_url: 'https://x',
          assets: [
            { name: 'a.exe', size: 1, browser_download_url: 'u1' },
            { name: 'bad', size: 'x', browser_download_url: 'u2' },
            { name: 'c.exe', size: 2, browser_download_url: 'u3' }
          ]
        })
      })) as unknown as typeof fetch
    )

    const rel = await fetchLatestRelease('o', 'r')
    expect(rel?.assets?.length).toBe(2)
    expect(rel?.assets?.every((a) => typeof a.size === 'number')).toBe(true)
  })

  it('возвращает null при HTTP ошибке', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch
    )
    expect(await fetchLatestRelease('o', 'r')).toBeNull()
  })
})

describe('checkForUpdates', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.LEX_SKIP_UPDATE_CHECK
    delete process.env.LEX_GITHUB_REPO
  })

  it('возвращает skipped когда LEX_SKIP_UPDATE_CHECK=1', async () => {
    process.env.LEX_SKIP_UPDATE_CHECK = '1'
    const r = await checkForUpdates('1.0.0')
    expect(r.status).toBe('skipped')
  })

  it('возвращает error при неверном LEX_GITHUB_REPO', async () => {
    process.env.LEX_GITHUB_REPO = 'not-a-repo'
    const r = await checkForUpdates('1.0.0')
    expect(r.status).toBe('error')
    expect(r.message).toMatch(/owner\/repo/i)
  })

  it('возвращает latest когда удалённая версия не новее', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => releaseFixture
      })) as unknown as typeof fetch
    )

    const r = await checkForUpdates('2.0.0')
    expect(r.status).toBe('latest')
    expect(r.critical).toBe(true)
  })

  it('возвращает available с setupAsset когда версия новее', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => releaseFixture
      })) as unknown as typeof fetch
    )

    const r = await checkForUpdates('1.0.0')
    expect(r.status).toBe('available')
    expect(r.setupAsset?.name).toMatch(/setup/i)
    expect(r.downloadUrl).toMatch(/^https:\/\//)
  })

  it('возвращает error когда релиз без tag_name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ...emptyAssetsFixture, tag_name: '' })
      })) as unknown as typeof fetch
    )

    const r = await checkForUpdates('1.0.0')
    expect(r.status).toBe('error')
  })

  it('мапит abort в сообщение о таймауте', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Aborted')
      }) as unknown as typeof fetch
    )

    const r = await checkForUpdates('1.0.0')
    expect(r.status).toBe('error')
    expect(r.message).toMatch(/таймаут|отмена/i)
  })
})
