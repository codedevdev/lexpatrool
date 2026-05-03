import { readFileSync, rmSync, statSync } from 'fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadReleaseAsset, resolveDownloadTargetPath } from './downloader'

describe('resolveDownloadTargetPath', () => {
  it('кладёт файл в каталог updates под userData и санитизирует имя', () => {
    const p = resolveDownloadTargetPath({
      name: '../../../evil.exe',
      size: 1,
      browser_download_url: 'u'
    })
    expect(p).toMatch(/updates/)
    expect(p).toMatch(/evil\.exe$|_+\.exe$/i)
  })
})

describe('downloadReleaseAsset', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('скачивает тело ответа в файл и возвращает путь', async () => {
    const buf = Buffer.from([10, 20, 30, 40])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: { get: (h: string) => (h === 'content-length' ? String(buf.length) : null) },
        body: new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(buf))
            c.close()
          }
        })
      })) as unknown as typeof fetch
    )

    const dest = await downloadReleaseAsset(
      { name: 'tiny.bin', size: buf.length, browser_download_url: 'https://example.com/x' },
      {}
    )

    try {
      expect(statSync(dest).size).toBe(buf.length)
      expect(readFileSync(dest).equals(buf)).toBe(true)
    } finally {
      rmSync(dest, { force: true })
    }
  })

  it('бросает при HTTP ошибке', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500
      })) as unknown as typeof fetch
    )

    await expect(
      downloadReleaseAsset(
        { name: 'x.exe', size: 1, browser_download_url: 'https://example.com/x' },
        {}
      )
    ).rejects.toThrow(/HTTP 500/)
  })

  it('вызывает onProgress при длинном потоке', async () => {
    const chunk = new Uint8Array(500).fill(7)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => null },
        body: new ReadableStream({
          start(c) {
            for (let i = 0; i < 12; i++) c.enqueue(chunk)
            c.close()
          }
        })
      })) as unknown as typeof fetch
    )

    const progress: number[] = []
    const dest = await downloadReleaseAsset(
      { name: 'big.bin', size: chunk.length * 12, browser_download_url: 'https://example.com/x' },
      {
        onProgress: (p) => {
          if (p.percent != null) progress.push(p.percent)
        }
      }
    )

    try {
      expect(progress.length).toBeGreaterThan(0)
    } finally {
      rmSync(dest, { force: true })
    }
  })

  it('бросает при отмене после получения данных', async () => {
    const chunk = new Uint8Array(400).fill(1)
    const ac = new AbortController()
    let pulls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => null },
        body: new ReadableStream({
          pull(c) {
            pulls++
            c.enqueue(chunk)
            if (pulls >= 2) ac.abort()
          }
        })
      })) as unknown as typeof fetch
    )

    await expect(
      downloadReleaseAsset(
        { name: 'abort.bin', size: 999999, browser_download_url: 'https://example.com/x' },
        { signal: ac.signal }
      )
    ).rejects.toThrow(/Abort/i)
  })
})
