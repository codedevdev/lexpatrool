/**
 * Heuristic splitting of plain text into articles (RU/EN legal-style patterns).
 * Best-effort: forum markup and odd spacing may require manual cleanup in the reader.
 */

import { logParse, parseTraceVerbose, previewLines } from './parse-trace'

export interface SplitArticle {
  articleNumber: string | null
  heading: string
  body: string
}

/** "1.5 млн" / "2.3%" at line start — not a new article, just prose. */
function isProseQuantityOrPercentLine(line: string): boolean {
  const t = line.trim()
  return /^\d+(?:[.,]\d+)?\s+(?:млн|млрд|тыс|руб|₽|коп|долл|%|проц)/i.test(t)
}

/**
 * Номер без слова «Статья»: 7.1 (A, CR) Похищение… | 4.11. Классификация…
 * Не ловим даты вида 2024.01.15 (нет пробела + буквы после номера).
 */
function isBareNumberedLegalHeading(line: string): boolean {
  const t = line.trim()
  if (isProseQuantityOrPercentLine(t)) return false
  return /^(?:\d+(?:\.\d+)+)\.?(?:\s*\([^)]{0,160}\))?\s+\S/.test(t)
}

/** Строка только с картинкой markdown / пустой декор — не заголовок статьи. */
function isSkippableDecorLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (/^\s*!\[[^\]]*]\([^)]*\)\s*$/.test(t)) return true
  if (/^\s*\[img[^\]]*]\s*$/i.test(t)) return true
  return false
}

/** Раздел / статья / часть — короткие заголовки не сливаем с предыдущим «мусорным» блоком в mergeTinyBlocks. */
export function isStructuralHeadingLine(line: string): boolean {
  return /^(?:Раздел|Статья|Часть|Глава|§|Article)\b/i.test(line.trim())
}

/** Lines that likely start a new block (article / section / numbered clause). */
function isBlockStart(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (isSkippableDecorLine(t)) return false
  if (isProseQuantityOrPercentLine(t)) return false
  if (isBareNumberedLegalHeading(t)) return true

  const patterns: RegExp[] = [
    /^(?:Статья|статья|ст\.)\s*[\d.]+/i,
    /^(?:ч\.|часть)\s*\d+.*(?:ст\.|статья)/i,
    /^§\s*[\d.]+/,
    /^Article\s+\d+/i,
    /^(?:Глава|глава)\s+[IVXLC\d]+/i,
    /^(?:Раздел|раздел)\s+[\dIVXLC]+/i,
    // Часть 6.7 / Часть 5.1 — с десятичным номером части
    /^(?:Часть|часть)\s+(?:\d+(?:\.\d+)*)\b/i,
    /^(?:ч\.|Ч\.)\s*(?:\d+(?:\.\d+)*)\b/,
    /^(?:Пункт|п\.|пп\.)\s*[\d.]+/i,
    /^(?:Подпункт|подп\.)\s*[\d.]+/i,
    // Только «1) текст», без «1. текст» — иначе ломаем нумерацию внутри частей (п. 3.1 АК)
    /^\d+\)\s+\S+/
  ]

  return patterns.some((re) => re.test(t))
}

function isContinuationLine(prevLine: string | null, line: string): boolean {
  if (!prevLine) return false
  const t = line.trim()
  if (!t) return true
  if (isProseQuantityOrPercentLine(t)) return true
  // Continuation: starts with lowercase, comma-led, or dash bullet
  if (/^[a-zа-яё]/.test(t) && !isBlockStart(t)) return true
  if (/^[,;]/.test(t)) return true
  if (/^[-–—]\s/.test(t) && !isBlockStart(t)) return true
  return false
}

/**
 * Первая колонка табличной строки: «8.5», «7.1 (A, CR) Похищение…».
 * Годы вида 2024 и строки «1) пункт» отсекаются.
 */
function normalizeArticleNumToken(s: string): string {
  return s.replace(/\.+$/g, '').trim()
}

/** Блок «Часть 5.1 …» / «ч. 6.7» — подпункт под предыдущей статьёй. */
export function isPartHeading(heading: string): boolean {
  return /^(?:Часть|часть|ч\.)\s/i.test(heading.trim())
}

export function parseLeadingArticleRef(firstColumn: string): { num: string; remainder: string } | null {
  let t = firstColumn.trim()
  const st = t.match(/^(?:Статья|статья)\s+(\d+(?:\.\d+)*)\.?\s*(.*)$/i)
  if (st) {
    const num = normalizeArticleNumToken(st[1]!)
    const remainder = (st[2] || '').trim()
    if (/^\d{4}$/.test(num)) return null
    if (num.length > 14) return null
    return { num, remainder }
  }
  t = t.replace(/^ст\.?\s*/i, '').trim()
  const m = t.match(/^(\d+(?:\.\d+)*)(?:\s*\([^)]*\))?\s*(.*)$/)
  if (!m) return null
  const num = normalizeArticleNumToken(m[1]!)
  const remainder = (m[2] || '').trim()
  if (/^\d{4}$/.test(num)) return null
  if (num.length > 14) return null
  if (/^\)/.test(remainder)) return null
  return { num, remainder }
}

export function detectArticleNumber(line: string): string | null {
  const t = line.trim()

  const tryOrder: (() => RegExpMatchArray | null)[] = [
    () => t.match(/^(?:Статья|статья|ст\.)\s*([\d]+(?:\.\d+)*)/i),
    () => t.match(/^(?:Часть|часть)\s+([\d.]+)/i),
    () => t.match(/^(?:ч\.|Ч\.)\s*([\d.]+)/i),
    () => t.match(/^(\d+(?:\.\d+)+)\.?(?:\s*\([^)]*\))?\s+/),
    () => t.match(/Article\s+([\d.]+)/i),
    () => t.match(/§\s*([\d.]+)/),
    () => t.match(/^(?:Пункт|п\.)\s*([\d.]+)/i),
    () => t.match(/^(\d+\)\s*\S+)/)
  ]

  for (const fn of tryOrder) {
    const m = fn()
    if (m?.[1]) return normalizeArticleNumToken(m[1]!).slice(0, 64)
  }
  return null
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function splitIntoArticles(raw: string): SplitArticle[] {
  const text = normalizeText(raw)
  if (!text) {
    logParse('splitIntoArticles: пустой текст после normalize')
    return []
  }

  logParse('splitIntoArticles: старт', {
    rawLength: raw.length,
    normalizedLength: text.length,
    firstLines: previewLines(text, 20, 180)
  })
  if (parseTraceVerbose()) {
    logParse('splitIntoArticles: полный normalized текст (фрагмент)', {
      head: text.slice(0, 4000),
      tail: text.length > 4500 ? text.slice(-1500) : undefined
    })
  }

  const lines = text.split('\n')
  const blocks: SplitArticle[] = []
  let current: SplitArticle | null = null
  let prevNonEmpty: string | null = null

  const flush = () => {
    if (current && (current.body.trim() || current.heading.trim())) {
      blocks.push({
        ...current,
        body: current.body.trim()
      })
    }
    current = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()

    if (!trimmed) {
      if (current) current.body += '\n'
      continue
    }

    if (isSkippableDecorLine(trimmed)) {
      continue
    }

    const starts = isBlockStart(trimmed)
    const cont = isContinuationLine(prevNonEmpty, trimmed)

    if (starts && !cont) {
      flush()
      const num = detectArticleNumber(trimmed)
      current = {
        articleNumber: num,
        heading: trimmed.slice(0, 300),
        body: ''
      }
    } else if (!current) {
      current = {
        articleNumber: null,
        heading: trimmed.slice(0, 200),
        body: trimmed.length > 200 ? `${trimmed}\n` : ''
      }
    } else if (starts && cont) {
      // New block even if previous line looked like continuation (e.g. short heading)
      flush()
      const num = detectArticleNumber(trimmed)
      current = {
        articleNumber: num,
        heading: trimmed.slice(0, 300),
        body: ''
      }
    } else {
      current.body += `${trimmed}\n`
    }

    prevNonEmpty = trimmed
  }
  flush()

  if (blocks.length === 0) {
    logParse('splitIntoArticles: блоков нет — один импорт целиком')
    return [{ articleNumber: null, heading: 'Импортированный текст', body: text }]
  }

  const merged = mergeTinyBlocks(blocks)
  logParse('splitIntoArticles: готово', {
    blocksAfterMerge: merged.length,
    headings: merged.slice(0, 15).map((b) => ({
      n: b.articleNumber,
      h: b.heading.slice(0, 90)
    }))
  })
  return merged
}

/** Merge orphan one-line blocks into neighbours to reduce noise from OCR/forum glitches. */
function mergeTinyBlocks(blocks: SplitArticle[]): SplitArticle[] {
  if (blocks.length <= 1) return blocks
  const out: SplitArticle[] = []
  for (const b of blocks) {
    const prev = out[out.length - 1]
    const tiny = b.body.trim().length < 4 && b.heading.length < 80
    if (tiny && prev && !isStructuralHeadingLine(b.heading)) {
      prev.body += `\n\n${b.heading}${b.body ? `\n${b.body}` : ''}`
      continue
    }
    out.push(b)
  }
  return out
}

/** Extract lines that look like sanctions / penalties (for overlay «focus» mode). */
export function extractPenaltyHints(text: string, maxLines = 24): string {
  const keys =
    /штраф|арест|лишение|срок|лишени|увольн|запрет|предупрежд|наказан|санкци|УК\s|КоАП|ст\.\s*\d|ч\.\s*\d/i
  const lines = text.split('\n').filter((l) => keys.test(l))
  return lines.slice(0, maxLines).join('\n') || text.slice(0, 800)
}
