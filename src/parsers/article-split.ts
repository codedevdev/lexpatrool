/**
 * Heuristic splitting of plain text into articles (RU/EN legal-style patterns).
 * Best-effort: forum markup and odd spacing may require manual cleanup in the reader.
 */

import {
  logParse,
  logParsePipelineStep,
  parseDiagnostics,
  parseTraceVerbose,
  previewArticleLikeLines,
  previewLastLines,
  previewLines,
  shouldLogParsePipeline
} from './parse-trace'

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
 * Вложенная нумерация «1.1. В случае…» / «10.3.4. Назначение…» — точка после последней цифры, затем пробел.
 * Отличается от строки УК «10.3.1 (A, CR) …», где после номера идёт пробел и «(», без лишней точки.
 */
export function isEnumerateClauseLine(line: string): boolean {
  const t = line.trim()
  return /^\d+(?:\.\d+)+\.\s+\S/.test(t)
}

/**
 * Номер без слова «Статья»: 7.1 (A, CR) Похищение… | 4.11. Классификация…
 * Не ловим даты вида 2024.01.15 (нет пробела + буквы после номера).
 */
function isBareNumberedLegalHeading(line: string): boolean {
  const t = line.trim()
  if (isProseQuantityOrPercentLine(t)) return false
  if (isEnumerateClauseLine(t)) return false
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

/** Заголовок основной статьи кодекса («Статья 3. …»), не подпункт списка. */
function isStatyaHeadingLine(heading: string): boolean {
  const h = heading.trimStart().slice(0, 160)
  return /^(?:Статья|статья|ст\.)\s*[\d.]+/i.test(h)
}

/**
 * Подпункт перечисления «2) Текст» или «4)Текст» (иногда без пробела после «)» в копипасте).
 * Такие строки не должны начинать новый блок, если они идут сразу под «Статья N.» (справочные статьи без таблицы санкций).
 */
function isClosingParenEnumLine(line: string): boolean {
  const t = line.trimStart()
  return /^\d+\)\s*\S/.test(t)
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
  if (isEnumerateClauseLine(t)) return null
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
  if (isEnumerateClauseLine(t)) return null

  const tryOrder: (() => RegExpMatchArray | null)[] = [
    () => t.match(/^(?:Статья|статья|ст\.)\s+(\d+(?:\.\d+)*)\b/i),
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

/**
 * Подстатья «10.3.1 (A, CR) …» клеится к телу «10.3» — режем после конца фразы только для номера из **трёх**
 * сегментов (две точки в номере). Двухсегментные «3.1», «7.1» здесь не трогаем — отдельная эвристика ниже.
 */
export function splitEmbeddedSubArticleLines(text: string): string {
  // Только пробелы/таб — НЕ \s, иначе съедаются \n между строками форума (−десятки строк в логе).
  return text.replace(
    /(?<=[.!?;:\u2026\)])[ \t]+(?=(?:\d+\.){2}\d+(?:\s*\([^)]{0,160}\))?\s+\S)/g,
    '\n'
  )
}

/**
 * Соседняя статья «15.6 (F, CR) …» в одной строке с «…наказание.» — только пробелы между предложением и номером.
 * `(?!\.)` после второго сегмента: не матчить префикс «10.3» у «10.3.1».
 */
function splitTwoPartTaggedArticleLines(text: string): string {
  return text.replace(
    /(?<=[.!?;:\u2026\)])[ \t]+(?=\d{2,}\.\d{1,4}(?!\.)\s*\([^)]{0,160}\)\s+\S)/g,
    '\n'
  )
}

/**
 * «…порядке.Глава 6…» — точка сразу перед «Глава» без пробела; иначе splitMidLineGlavaRecursive не видит разрыва.
 */
function splitDotGluedGlava(text: string): string {
  return text.replace(/(?<=[.!?;:\u2026])(?=Глава\s+[IVXLCM\d]+\.)/gi, '\n')
}

/**
 * «здоровья6.1 (A, CR) …» — буква сразу перед номером со скобками; не трогаем «Глава6.1» (конец слова Глава).
 */
export function splitLetterGluedLegalArticles(text: string): string {
  return text.replace(
    /([а-яёА-ЯЁa-z])(?=((?:\d+\.)+\d+)\s*\()/gi,
    (full: string, letter: string, _num: string, offset: number, whole: string) => {
      const throughLetter = (whole.slice(0, offset) + letter).trimEnd()
      if (/\bГлава$/i.test(throughLetter)) return full
      return `${letter}\n`
    }
  )
}

/**
 * Общий порядок до expandGluedChapterArticleLines: invisible glue, .Глава, вложенные номера, буква+номер.
 * При LEX_PARSE_DIAG=1 / LEX_PARSE_DEBUG=1 — пошаговые метрики в консоль ([LexPatrol][parse] preprocess:…).
 */
export function preprocessForumCodecPlainText(raw: string): string {
  let s = stripInvisibleForumGlue(raw)
  if (shouldLogParsePipeline()) logParsePipelineStep('stripInvisibleForumGlue', raw, s)
  let prev = s
  s = splitDotGluedGlava(s)
  if (shouldLogParsePipeline()) logParsePipelineStep('splitDotGluedGlava', prev, s)
  prev = s
  s = splitEmbeddedSubArticleLines(s)
  if (shouldLogParsePipeline()) logParsePipelineStep('splitEmbeddedSubArticleLines', prev, s)
  prev = s
  s = splitTwoPartTaggedArticleLines(s)
  if (shouldLogParsePipeline()) logParsePipelineStep('splitTwoPartTaggedArticleLines', prev, s)
  prev = s
  s = splitLetterGluedLegalArticles(s)
  if (shouldLogParsePipeline()) logParsePipelineStep('splitLetterGluedLegalArticles', prev, s)

  if (shouldLogParsePipeline()) {
    logParse('preprocess:образцы строк похожих на заголовки статей', {
      samples: previewArticleLikeLines(s),
      note:
        'Если нужного номера нет — строка не начинается с номера/«Статья» или номер в середине абзаца без перевода строки.'
    })
  }
  return s
}

function normalizeText(raw: string): string {
  const preprocessed = preprocessForumCodecPlainText(raw)
  const expanded = expandGluedChapterArticleLines(preprocessed)
  if (shouldLogParsePipeline()) logParsePipelineStep('expandGluedChapterArticleLines', preprocessed, expanded)
  return expanded
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** XenForo и браузеры вставляют ZWSP и др. между точкой и номером — ломают шаблон «.7.1». */
function stripInvisibleForumGlue(raw: string): string {
  return raw.replace(/[\u200B-\u200D\uFEFF\u2060\u00AD\u034F]/g, '')
}

/**
 * «Статья 2.5 … наказание.Глава 3. …» — режем перед «.Глава», чтобы следующая глава была новой строкой.
 */
function splitMidLineGlavaRecursive(line: string): string[] {
  const re = /\.(?=Глава\s+[IVXLCM\d]+\.)/i
  const idx = line.search(re)
  if (idx < 0) return [line]
  const left = line.slice(0, idx + 1).trimEnd()
  const right = line.slice(idx + 1).trimStart()
  return [left, ...splitMidLineGlavaRecursive(right)]
}

/**
 * «Глава 1. … Основные термины.Статья 1.1 …» — без перевода строки между главой и первой статьёй.
 */
function splitGluedChapterStatyaLine(line: string): string[] {
  const lead = line.trimStart()
  if (!/^Глава\s+/i.test(lead)) return [line]

  let lastDot = -1
  const re = /\.(?:\s*)(?=Статья\s+\d+(?:\.\d+)*\b)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) lastDot = m.index
  if (lastDot < 0) return [line]

  const chapterPart = line.slice(0, lastDot + 1).trimEnd()
  const articlePart = line.slice(lastDot + 1).trimStart()
  if (!/^Статья\s+/i.test(articlePart)) return [line]

  const ch = chapterPart.endsWith('.') ? chapterPart : `${chapterPart}.`
  return [ch, articlePart]
}

/** Индекс первого символа номера статьи «7.1» после заголовка главы «Глава …». */
function findBareArticleAfterChapterHeading(line: string): number {
  const t = line.trimEnd()
  if (!/^Глава\s+/i.test(t.trimStart())) return -1

  let lastStart = -1
  let m: RegExpExecArray | null

  const reParen = /\.(?:\s*)(((?:\d+\.)+\d+)\s*\()/g
  while ((m = reParen.exec(t)) !== null) {
    lastStart = m.index + 1
  }

  const reCap = /\.(?:\s*)(((?:\d+\.)+\d+)\s+[А-ЯЁA-Z])/g
  while ((m = reCap.exec(t)) !== null) {
    lastStart = m.index + 1
  }

  const reWordDigit = /([а-яёА-ЯЁa-z])(((?:\d+\.)+\d+)\s*\()/gi
  while ((m = reWordDigit.exec(t)) !== null) {
    lastStart = m.index + m[1]!.length
  }

  return lastStart
}

function splitGluedChapterArticleLine(line: string): string[] {
  const articleStart = findBareArticleAfterChapterHeading(line)
  if (articleStart < 0) return [line]

  const chapterPart = line.slice(0, articleStart).trimEnd()
  const articlePart = line.slice(articleStart).trimStart()

  if (!/^Глава\s+/i.test(chapterPart.trim())) return [line]
  if (!/^(\d+(?:\.\d+)+)/.test(articlePart)) return [line]

  const ch = chapterPart.endsWith('.') ? chapterPart : `${chapterPart}.`
  return [ch, articlePart]
}

/**
 * Форумы часто клеят строку без перевода: «Глава 10. … .10.1 (R, CR) …», «…собственности.​7.1 …» (ZWSP).
 */
export function expandGluedChapterArticleLines(text: string): string {
  const stripped = stripInvisibleForumGlue(text)
  return stripped
    .split('\n')
    .flatMap((line) => splitMidLineGlavaRecursive(line))
    .flatMap((line) => splitGluedChapterStatyaLine(line))
    .flatMap((line) => splitGluedChapterArticleLine(line))
    .join('\n')
}

/** Убрать блок «только Глава N…» без тела — после expand это служебная строка, не статья. */
function dropStandaloneChapterOnlyBlocks(blocks: SplitArticle[]): SplitArticle[] {
  const dropped: SplitArticle[] = []
  const out = blocks.filter((b) => {
    if (b.articleNumber?.trim()) return true
    const head = b.heading.trim()
    if (!/^Глава\s+/i.test(head)) return true
    if (b.body.trim().length > 0) return true
    dropped.push(b)
    return false
  })
  if (shouldLogParsePipeline() && dropped.length > 0) {
    logParse('dropStandaloneChapterOnlyBlocks: убраны блоки только «Глава» без тела', {
      count: dropped.length,
      headings: dropped.map((d) => d.heading.slice(0, 100))
    })
  }
  return out
}

/** Индекс под иерархический номер «10.3.1» (не «Часть», не голый заголовок). */
function hierarchyTupleForReorder(b: SplitArticle): number[] | null {
  if (isPartHeading(b.heading)) return null
  const n = b.articleNumber?.trim()
  if (!n || !/^\d+(?:\.\d+)+$/.test(n)) return null
  return n.split('.').map(Number)
}

function compareTupleLex(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0
    const vb = b[i] ?? 0
    if (va !== vb) return va - vb
  }
  return 0
}

/**
 * Ставит блоки с номерами N(.N)+ в порядок возрастания по «пути» номера, не двигая «Часть» и прочие вставки.
 * Родительская статья (10.3) оказывается перед подстатьёй (10.3.1), если в тексте они были перепутаны.
 */
export function reorderHierarchyArticleBlocks(blocks: SplitArticle[]): SplitArticle[] {
  if (blocks.length <= 1) return blocks
  const idxs: number[] = []
  for (let i = 0; i < blocks.length; i++) {
    if (hierarchyTupleForReorder(blocks[i]!) !== null) idxs.push(i)
  }
  if (idxs.length <= 1) return blocks

  const pairs = idxs.map((origIdx) => ({
    origIdx,
    t: hierarchyTupleForReorder(blocks[origIdx]!)!,
    b: blocks[origIdx]!
  }))
  pairs.sort((a, b) => {
    const c = compareTupleLex(a.t, b.t)
    if (c !== 0) return c
    return a.origIdx - b.origIdx
  })

  const out = blocks.slice()
  for (let k = 0; k < idxs.length; k++) {
    out[idxs[k]!] = pairs[k]!.b
  }
  return out
}

export function splitIntoArticles(raw: string): SplitArticle[] {
  if (shouldLogParsePipeline()) {
    logParse('splitIntoArticles: режим логов', {
      LEX_PARSE_DIAG: parseDiagnostics(),
      LEX_PARSE_DEBUG_or_TRACE: parseTraceVerbose(),
      подсказка:
        'DIAG — пошаговый препроцесс; DEBUG — полный дамп normalized текста в этом же потоке логов'
    })
  }

  const text = normalizeText(raw)
  if (!text) {
    logParse('splitIntoArticles: пустой текст после normalize')
    return []
  }

  logParse('splitIntoArticles: старт', {
    rawLength: raw.length,
    normalizedLength: text.length,
    firstLines: previewLines(text, 20, 180),
    ...(shouldLogParsePipeline() ? { lastLines: previewLastLines(text, 14, 180) } : {})
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

    const statyaEnumContinuation =
      current !== null &&
      isStatyaHeadingLine(current.heading) &&
      isClosingParenEnumLine(trimmed)

    if (statyaEnumContinuation) {
      if (current) current.body += `${trimmed}\n`
      prevNonEmpty = trimmed
      continue
    }

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
  const cleaned = dropStandaloneChapterOnlyBlocks(merged)
  logParse('splitIntoArticles: готово', {
    blocksAfterMerge: cleaned.length,
    blocksBeforeTinyMerge: blocks.length,
    headings: cleaned.slice(0, 15).map((b) => ({
      n: b.articleNumber,
      h: b.heading.slice(0, 90)
    }))
  })
  return cleaned
}

/**
 * Не склеивать с предыдущим блоком строки, которые уже выглядят как статья/часть УК —
 * иначе пропадают «Часть 1», подстатьи 10.3.1 и т.д. (см. mergeTinyBlocks в логах LEX_PARSE_DIAG).
 */
function isLikelyCodecArticleOrPartHeading(heading: string): boolean {
  const h = heading.trim()
  if (/^(?:Статья|статья|Часть|часть|Глава|глава)\s/i.test(h)) return true
  if (/^(?:\d+\.){2,}\d+(?:\s*\([^)]*\))?\s+\S/m.test(h)) return true
  if (/^\d{2,}\.\d{1,4}\s*\([^)]*\)\s+\S/m.test(h)) return true
  if (/^(?:\d+\.)+\d+\s+\S/.test(h) && h.length >= 20) return true
  return false
}

/** Merge orphan one-line blocks into neighbours to reduce noise from OCR/forum glitches. */
function mergeTinyBlocks(blocks: SplitArticle[]): SplitArticle[] {
  if (blocks.length <= 1) return blocks
  const out: SplitArticle[] = []
  let mergedCount = 0
  const mergedSamples: string[] = []
  for (const b of blocks) {
    const prev = out[out.length - 1]
    const tiny = b.body.trim().length < 4 && b.heading.length < 80
    const mergeOk =
      tiny &&
      prev &&
      !isStructuralHeadingLine(b.heading) &&
      !isLikelyCodecArticleOrPartHeading(b.heading)
    if (mergeOk) {
      mergedCount++
      if (shouldLogParsePipeline() && mergedSamples.length < 24) {
        mergedSamples.push(`${b.articleNumber ?? '∅'} ${b.heading.slice(0, 72)}`)
      }
      prev.body += `\n\n${b.heading}${b.body ? `\n${b.body}` : ''}`
      continue
    }
    out.push(b)
  }
  if (shouldLogParsePipeline() && mergedCount > 0) {
    logParse('mergeTinyBlocks: короткий блок присоединён к предыдущему', {
      mergedCount,
      samples: mergedSamples
    })
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
