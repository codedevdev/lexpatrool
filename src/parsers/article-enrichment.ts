/**
 * Эвристики без жёсткой привязки к одному шаблону: вытаскиваем суть, наказание, штраф/УК/звёзды из произвольного текста.
 * Табличные вставки (Статья | Расшифровка | Наказание) обрабатываются в tryParseTableRows.
 */

import {
  expandGluedChapterArticleLines,
  parseLeadingArticleRef,
  preprocessForumCodecPlainText,
  type SplitArticle
} from './article-split'
import { logParse, logParseDump, parseTraceVerbose, previewLines } from './parse-trace'

export interface ArticleDisplayMeta {
  stars?: number
  fineUsd?: number
  fineRub?: number
  ukArticle?: string
  tags?: string[]
  /** Выход под залог (отдельно от «Наказание», чтобы не путать в карточке). */
  bailHint?: string
}

export interface ArticleEnrichment {
  summaryShort: string | null
  penaltyHint: string | null
  meta: ArticleDisplayMeta
}

/** Не включаем «Выход под залог» — он идёт в bailHint, иначе путался с наказанием. */
const PENALTY_LINE =
  /(?:Наказание|Санкци|Штраф|Эвакуаци|лишени|арест|УК|ст\.?\s*\d+[\d.]*|^\s*\d[\d\s.,]*\$|\d[\d\s]*(?:руб|₽)|★|звезд)/im

/** Обычная строка кодекса без таблицы (не должна целиком уходить в режим «только |»). */
function isProseCodecHeadingLine(line: string): boolean {
  const l = line.trim()
  if (!l || l.includes('|')) return false
  return /^(?:Статья|статья|Часть|часть|ст\.|§|Глава|глава|Раздел|раздел)\s/i.test(l)
}

/**
 * Строки вида `8.5 | текст | Эвакуация`, `7.1 (A, CR) Похищение. | 5*`, табуляция.
 * Первая колонка — номер (в т.ч. с суффиксом в скобках и названием).
 *
 * Если в тексте смешаны обычный кодекс и несколько табличных строк, **не** подменяем
 * весь документ таблицей (иначе теряется всё до первой строки с `|`).
 */
export function tryParseTableRows(raw: string): SplitArticle[] | null {
  const rawExpanded = expandGluedChapterArticleLines(preprocessForumCodecPlainText(raw))
  const lines = rawExpanded.split(/\r?\n/).map((l) => l.trim())
  const nonEmpty = lines.filter((l) => l && !l.startsWith('#'))

  logParse('tryParseTableRows: вход', {
    rawLength: raw.length,
    linesTotal: lines.length,
    nonEmptyLines: nonEmpty.length,
    linesWithPipe: nonEmpty.filter((l) => l.includes('|')).length,
    firstNonEmptyPreview: nonEmpty[0]?.slice(0, 140) ?? '(пусто)'
  })
  if (parseTraceVerbose()) {
    logParseDump('tryParseTableRows: полный raw', raw, 8000)
    logParse('tryParseTableRows: первые строки (preview)', { lines: previewLines(raw, 40, 200) })
  }

  const first = nonEmpty[0]
  if (first && isProseCodecHeadingLine(first)) {
    logParse('tryParseTableRows: отказ — первая строка похожа на заголовок кодекса без |', {
      firstLine: first.slice(0, 200)
    })
    return null
  }

  const proseHeadingLines = nonEmpty.filter(isProseCodecHeadingLine).length

  const rows: SplitArticle[] = []
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue
    let parts: string[]
    if (line.includes('|')) {
      parts = line.split(/\|/).map((p) => p.trim()).filter(Boolean)
    } else if (line.includes('\t')) {
      parts = line.split('\t').map((p) => p.trim()).filter(Boolean)
    } else continue

    if (parts.length < 2) continue

    const firstRaw = parts[0]!.trim()
    const parsed = parseLeadingArticleRef(firstRaw)
    if (!parsed) continue

    const { num, remainder } = parsed
    const heading = firstRaw.slice(0, 300)
    const tailText = parts.slice(1).join('\n\n').trim()

    const bodyParts: string[] = []
    if (remainder) bodyParts.push(`Расшифровка: ${remainder}`)
    if (tailText) {
      const t = tailText.trim()
      const starLike =
        /^(?:\d{1,2}\s*\*+\s*|[★☆]\s*\d+|\d+\s*★)/.test(t) || /^\d+\s*\*+\s*$/.test(t)
      if (starLike) bodyParts.push(`Уровень розыска / пометка: ${tailText}`)
      else bodyParts.push(tailText)
    }

    rows.push({
      articleNumber: num,
      heading,
      body: bodyParts.join('\n\n').trim() || tailText || heading
    })
  }

  if (rows.length === 0) {
    logParse('tryParseTableRows: отказ — ни одной валидной табличной строки (| + номер в 1-й колонке)', {
      proseHeadingLines
    })
    return null
  }

  const n = nonEmpty.length
  const ratio = n > 0 ? rows.length / n : 0

  if (proseHeadingLines > 0 && rows.length < n) {
    logParse('tryParseTableRows: отказ — смешанный текст (есть заголовки Статья/Часть без |, но не все строки таблица)', {
      proseHeadingLines,
      tableRowsParsed: rows.length,
      nonEmptyLines: n
    })
    return null
  }

  if (n > 8 && ratio < 0.35) {
    logParse('tryParseTableRows: отказ — низкая доля табличных строк (ratio < 0.35)', {
      ratio: ratio.toFixed(3),
      tableRowsParsed: rows.length,
      nonEmptyLines: n
    })
    return null
  }

  if (n > 4 && rows.length < 2) {
    logParse('tryParseTableRows: отказ — мало табличных блоков при длинном тексте', {
      tableRowsParsed: rows.length,
      nonEmptyLines: n
    })
    return null
  }

  logParse('tryParseTableRows: принят режим ТАБЛИЦА', {
    tableRowsParsed: rows.length,
    nonEmptyLines: n,
    ratio: ratio.toFixed(3),
    firstHeadings: rows.slice(0, 6).map((r) => r.heading.slice(0, 120))
  })
  return rows
}

export interface EnrichArticleOptions {
  /** Импорт «Только справочные» — не заполнять penalty_hint строками, похожими на санкции УК */
  referenceImport?: boolean
}

export function enrichArticle(heading: string, body: string, options?: EnrichArticleOptions): ArticleEnrichment {
  const meta: ArticleDisplayMeta = {}
  const text = body.replace(/\r\n/g, '\n')

  const uk = text.match(/(?:^|\s)(\d+[\d.]*)\s*УК\b/i) || text.match(/УК\s*(?:ст\.?)?\s*(\d+[\d.]*)/i)
  if (uk) meta.ukArticle = uk[1]

  const fineUsd =
    text.match(/\$\s*([\d\s.,]+)/i) ||
    text.match(/([\d\s.,]+)\s*\$/i) ||
    text.match(/(\d[\d\s.,]*)\s*(?:долл|usd)/i)
  if (fineUsd) {
    const n = parseFloat(fineUsd[1]!.replace(/\s/g, '').replace(',', '.'))
    if (!Number.isNaN(n)) meta.fineUsd = n
  }

  const fineRub = text.match(/([\d\s.,]+)\s*(?:руб|₽)/i)
  if (fineRub) {
    const n = parseFloat(fineRub[1]!.replace(/\s/g, '').replace(',', '.'))
    if (!Number.isNaN(n)) meta.fineRub = n
  }

  const stars =
    text.match(/(\d)\s*(?:звезд|звёзд|уровн)/i) || text.match(/(?:розыск|★)\s*:?\s*(\d)/i) || text.match(/★{1,5}/)
  if (stars) {
    const n = stars[0]!.includes('★') ? (stars[0]!.match(/★/g) ?? []).length : parseInt(stars[1] ?? '0', 10)
    if (n > 0 && n <= 6) meta.stars = n
  }

  if (/эвакуаци/i.test(text)) meta.tags = [...(meta.tags ?? []), 'эвакуация']
  if (/УК/i.test(text)) meta.tags = [...(meta.tags ?? []), 'УК']

  const bailM = text.match(/Выход под залог\s*:\s*([^\n]+)/i)
  if (bailM) meta.bailHint = bailM[1]!.trim().slice(0, 220)

  let penaltyHint: string | null = null
  if (!options?.referenceImport) {
    penaltyHint = extractPenaltyHint(text)
    if (!penaltyHint && partsAfterKeywords(text)) {
      penaltyHint = partsAfterKeywords(text)
    }
  }

  const summaryShort = extractSummaryShort(heading, text)

  return {
    summaryShort,
    penaltyHint,
    meta
  }
}

function partsAfterKeywords(text: string): string | null {
  const m = text.match(/Наказание\s*:\s*([^\n]+)/i)
  return m ? m[1]!.trim().slice(0, 220) : null
}

function extractPenaltyHint(text: string): string | null {
  const nak = text.match(/Наказание\s*:\s*([^\n]+)/im)
  if (nak) {
    const t = nak[1]!.trim()
    if (t && !/^Выход под залог/i.test(t)) return t.slice(0, 280)
  }
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (/^Выход под залог/i.test(line)) continue
    if (PENALTY_LINE.test(line) && line.length < 400) {
      return line.replace(/^Наказание\s*:\s*/i, '').trim().slice(0, 280)
    }
  }
  const hit = lines.find(
    (l) =>
      !/^Выход под залог/i.test(l) && /\$\s*[\d]|[\d]\s*\$|руб|₽|УК|Эвакуация/i.test(l)
  )
  return hit ? hit.slice(0, 280) : null
}

function extractSummaryShort(heading: string, body: string): string | null {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)

  const essenceLine = lines.find((l) => /^(?:Суть|Описание)\s*:/i.test(l))
  if (essenceLine) {
    return essenceLine.replace(/^(?:Суть|Описание)\s*:\s*/i, '').trim().slice(0, 320)
  }

  const flat = body.replace(/\s+/g, ' ').trim()
  const afterR = flat.match(/Расшифровка\s*:\s*(.+?)(?:\s+Наказание|$)/i)
  if (afterR) return afterR[1]!.trim().slice(0, 320)

  const descriptive = lines.find(
    (l) =>
      l.length > 18 &&
      !/^Выход под залог/i.test(l) &&
      !/^Наказание\s*:/i.test(l) &&
      !/^Часть\s+\d/i.test(l) &&
      !/^\d+(?:\.\d+)+\s*\(/.test(l)
  )
  if (descriptive) return descriptive.slice(0, 320)

  const first = flat.split(/(?<=[.!?])\s+/)[0]
  if (
    first &&
    first.length > 20 &&
    first.length < 400 &&
    !/^Выход под залог/i.test(first) &&
    !/^Наказание\s*:/i.test(first)
  ) {
    return first.trim().slice(0, 320)
  }

  const h = heading.replace(/^Статья\s+[\d.]+\.?\s*/i, '').trim()
  return h.length > 5 ? h.slice(0, 240) : null
}

export function metaToJson(meta: ArticleDisplayMeta): string {
  return JSON.stringify(meta)
}
