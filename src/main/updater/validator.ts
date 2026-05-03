import { createHash } from 'crypto'
import { statSync, unlinkSync, existsSync } from 'fs'
import { createReadStream } from 'fs'
import type { GitHubReleaseAsset } from './checker'
import { appendUpdaterLog } from './logger'

export type ValidateResult = { ok: true } | { ok: false; message: string }

/** Парсинг содержимого .sha256 (одна строка hex). */
export function parseSha256SidecarFile(content: string): string | null {
  const line = content.trim().split(/\r?\n/u)[0]?.trim() ?? ''
  const m = line.match(/^([a-f0-9]{64})\b/i)
  return m ? m[1]!.toLowerCase() : null
}

/**
 * Строка из SHA256SUMS: `hash *name` или `hash  name`.
 * Возвращает hash если имя файла совпадает.
 */
export function parseSha256SumsLineForFile(line: string, fileName: string): string | null {
  const t = line.trim()
  if (!t || t.startsWith('#')) return null
  const star = /^([a-f0-9]{64})\s+\*\s*(.+)$/i.exec(t)
  if (star && star[2] === fileName) return star[1]!.toLowerCase()
  const sp = /^([a-f0-9]{64})\s{2,}(\S+)$/i.exec(t)
  if (sp && sp[2] === fileName) return sp[1]!.toLowerCase()
  return null
}

export function findSha256AssetForSetup(
  setupAsset: GitHubReleaseAsset,
  releaseAssets: GitHubReleaseAsset[]
): GitHubReleaseAsset | null {
  const exact = `${setupAsset.name}.sha256`
  const hit = releaseAssets.find((a) => a.name === exact)
  return hit ?? null
}

export function findSha256SumsAsset(releaseAssets: GitHubReleaseAsset[]): GitHubReleaseAsset | null {
  return releaseAssets.find((a) => /^sha256sums$/i.test(a.name.trim())) ?? null
}

async function sha256FileHex(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const rs = createReadStream(filePath)
    rs.on('error', reject)
    rs.on('data', (c: string | Buffer) => hash.update(c))
    rs.on('end', () => resolve(hash.digest('hex')))
  })
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': 'LexPatrol-Desktop/UpdateValidate', Accept: '*/*' }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}

function removeFileQuiet(p: string): void {
  try {
    if (existsSync(p)) unlinkSync(p)
  } catch {
    /* ignore */
  }
}

/**
 * Проверка размера и SHA256 (ассет .sha256 или SHA256SUMS из того же релиза).
 */
export async function validateDownloadedInstaller(opts: {
  filePath: string
  setupAsset: GitHubReleaseAsset
  releaseAssets: GitHubReleaseAsset[]
  signal?: AbortSignal
}): Promise<ValidateResult> {
  const { filePath, setupAsset, releaseAssets } = opts
  try {
    const st = statSync(filePath)
    if (st.size !== setupAsset.size) {
      appendUpdaterLog(`validate: size mismatch disk=${st.size} expected=${setupAsset.size}`)
      return { ok: false, message: `Размер файла (${st.size}) не совпадает с данными релиза (${setupAsset.size}).` }
    }

    const sidecar = findSha256AssetForSetup(setupAsset, releaseAssets)
    let expected: string | null = null

    if (sidecar) {
      const text = await fetchText(sidecar.browser_download_url, opts.signal)
      expected = parseSha256SidecarFile(text)
      if (!expected) {
        appendUpdaterLog('validate: could not parse .sha256 sidecar')
        return { ok: false, message: 'Файл контрольной суммы релиза повреждён или имеет неожиданный формат.' }
      }
    } else {
      const sumsAsset = findSha256SumsAsset(releaseAssets)
      if (sumsAsset) {
        const text = await fetchText(sumsAsset.browser_download_url, opts.signal)
        for (const line of text.split(/\r?\n/u)) {
          const h = parseSha256SumsLineForFile(line, setupAsset.name)
          if (h) {
            expected = h
            break
          }
        }
      }
    }

    if (!expected) {
      appendUpdaterLog('validate: no .sha256 sidecar or SHA256SUMS for setup asset')
      return {
        ok: false,
        message:
          'Для этого релиза нет файла контрольной суммы (.sha256). Обновитесь вручную со страницы релиза или дождитесь сборки с checksum.'
      }
    }

    const actual = await sha256FileHex(filePath)
    if (actual !== expected) {
      appendUpdaterLog(`validate: hash mismatch expected=${expected} actual=${actual}`)
      return { ok: false, message: 'Контрольная сумма не совпала — файл мог повредиться при скачивании.' }
    }

    appendUpdaterLog(`validate: ok size=${st.size} sha256=${actual.slice(0, 12)}…`)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    appendUpdaterLog(`validate: error ${msg}`)
    return { ok: false, message: `Проверка файла: ${msg}` }
  }
}

export function deleteInstallerIfInvalid(filePath: string, result: ValidateResult): void {
  if (!result.ok) removeFileQuiet(filePath)
}
