import { createHash } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findSha256AssetForSetup,
  findSha256SumsAsset,
  parseSha256SidecarFile,
  parseSha256SumsLineForFile,
  validateDownloadedInstaller
} from './validator'

describe('parseSha256SidecarFile', () => {
  it('парсит одну hex-строку', () => {
    expect(
      parseSha256SidecarFile('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789\n')
    ).toBe('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789')
  })

  it('возвращает null при мусоре', () => {
    expect(parseSha256SidecarFile('hello')).toBeNull()
  })
})

describe('parseSha256SumsLineForFile', () => {
  it('совпадает со стилем GNU с звёздочкой', () => {
    const line =
      'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789  *LexPatrol Setup 1.0.0.exe'
    expect(parseSha256SumsLineForFile(line, 'LexPatrol Setup 1.0.0.exe')).toBe(
      'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
    )
  })
})

describe('findSha256AssetForSetup', () => {
  it('находит sidecar по имени', () => {
    const setup = { name: 'LexPatrol Setup 1.0.0.exe', size: 1, browser_download_url: 'u' }
    const assets = [
      setup,
      { name: 'LexPatrol Setup 1.0.0.exe.sha256', size: 2, browser_download_url: 'h' }
    ]
    expect(findSha256AssetForSetup(setup, assets)?.browser_download_url).toBe('h')
  })
})

describe('findSha256SumsAsset', () => {
  it('находит SHA256SUMS', () => {
    const assets = [{ name: 'SHA256SUMS', size: 1, browser_download_url: 'x' }]
    expect(findSha256SumsAsset(assets)?.name).toBe('SHA256SUMS')
  })
})

describe('validateDownloadedInstaller', () => {
  const setupAsset = { name: 'setup.exe', size: 4, browser_download_url: 'https://x/setup.exe' }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('отклоняет файл при несовпадении размера с метаданными релиза', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lex-v-'))
    const fp = join(dir, 'setup.exe')
    writeFileSync(fp, Buffer.from([1, 2]))
    try {
      const r = await validateDownloadedInstaller({
        filePath: fp,
        setupAsset: { ...setupAsset, size: 99 },
        releaseAssets: []
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toMatch(/Размер/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('принимает файл когда sidecar sha256 совпадает', async () => {
    const body = Buffer.from([9, 8, 7, 6])
    const hex = createHash('sha256').update(body).digest('hex')
    const dir = mkdtempSync(join(tmpdir(), 'lex-v-'))
    const fp = join(dir, 'setup.exe')
    writeFileSync(fp, body)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => `${hex}\n`
      })) as unknown as typeof fetch
    )

    try {
      const r = await validateDownloadedInstaller({
        filePath: fp,
        setupAsset,
        releaseAssets: [{ name: 'setup.exe.sha256', size: 10, browser_download_url: 'https://h' }]
      })
      expect(r.ok).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('находит хеш в SHA256SUMS по имени установщика', async () => {
    const body = Buffer.from([1, 1, 1, 1])
    const hex = createHash('sha256').update(body).digest('hex')
    const dir = mkdtempSync(join(tmpdir(), 'lex-v-'))
    const fp = join(dir, 'setup.exe')
    writeFileSync(fp, body)
    const sums = `${hex} *setup.exe\n`

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => sums
      })) as unknown as typeof fetch
    )

    try {
      const r = await validateDownloadedInstaller({
        filePath: fp,
        setupAsset,
        releaseAssets: [{ name: 'SHA256SUMS', size: sums.length, browser_download_url: 'https://s' }]
      })
      expect(r.ok).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ошибка когда нет sidecar и нет SHA256SUMS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lex-v-'))
    const fp = join(dir, 'setup.exe')
    writeFileSync(fp, Buffer.alloc(setupAsset.size))
    try {
      const r = await validateDownloadedInstaller({
        filePath: fp,
        setupAsset,
        releaseAssets: []
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toMatch(/контрольной суммы|checksum/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
