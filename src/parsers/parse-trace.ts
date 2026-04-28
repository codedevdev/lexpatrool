/**
 * Диагностика разбора статей в терминал (main process: npm run dev / electron).
 *
 * | Переменная           | Эффект |
 * |---------------------|--------|
 * | LEX_PARSE_DIAG=1    | Пошаговый препроцесс (длины, Δ строк), образцы «похожих на статьи» строк — без полных дампов |
 * | LEX_PARSE_DEBUG=1   | То же + полные дампы текста (logParseDump), см. также LEX_PARSE_TRACE |
 * | LEX_PARSE_TRACE=1   | Алиас к подробному режиму |
 */

function envFlag(key: string): string | undefined {
  try {
    if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string') {
      return process.env[key]
    }
  } catch {
    /* ignore */
  }
  return undefined
}

export function parseTraceVerbose(): boolean {
  const v = envFlag('LEX_PARSE_DEBUG') ?? envFlag('LEX_PARSE_TRACE')
  return v === '1' || v === 'true' || v === 'yes'
}

/** Пошаговая статистика препроцесса (без полных дампов текста). */
export function parseDiagnostics(): boolean {
  const v = envFlag('LEX_PARSE_DIAG')
  return v === '1' || v === 'true' || v === 'yes'
}

export function shouldLogParsePipeline(): boolean {
  return parseDiagnostics() || parseTraceVerbose()
}

function countLines(s: string): number {
  if (!s) return 0
  return s.split(/\r?\n/).length
}

function newlineCount(s: string): number {
  return (s.match(/\n/g) || []).length
}

/**
 * Сравнение до/после шага препроцесса: длины, число строк, вставленные переводы строк.
 */
export function logParsePipelineStep(
  step: string,
  before: string,
  after: string,
  extra?: Record<string, unknown>
): void {
  if (!shouldLogParsePipeline()) return
  const lb = countLines(before)
  const la = countLines(after)
  const insertedNl = newlineCount(after) - newlineCount(before)
  logParse(`preprocess:${step}`, {
    chars: { before: before.length, after: after.length, delta: after.length - before.length },
    lines: { before: lb, after: la, delta: la - lb },
    newlinesInsertedApprox: insertedNl,
    ...extra
  })
}

/**
 * Первые строки, похожие на заголовки статей / частей — быстрая проверка «видит ли поток номера».
 */
export function previewArticleLikeLines(text: string, maxLines = 18, maxLineLen = 160): string[] {
  const re = /^(?:\d+(?:\.\d+)+)\.?(?:\s*\([^)]*\))?\s*\S|^(?:Статья|статья|Часть|часть|Глава|глава)\s/i
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && re.test(l))
    .slice(0, maxLines)
    .map((l) => (l.length > maxLineLen ? `${l.slice(0, maxLineLen)}…` : l))
}

/** Последние непустые строки — удобно видеть хвост импорта (куда «уплыла» подстатья). */
export function previewLastLines(text: string, maxLines = 14, maxLineLen = 180): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  return lines.slice(-maxLines).map((l) => (l.length > maxLineLen ? `${l.slice(0, maxLineLen)}…` : l))
}

export function logParse(event: string, data?: Record<string, unknown>): void {
  const ts = new Date().toISOString()
  if (data && Object.keys(data).length) {
    console.log(`[LexPatrol][parse] ${ts} ${event}`, data)
  } else {
    console.log(`[LexPatrol][parse] ${ts} ${event}`)
  }
}

export function logParseDump(label: string, text: string, maxChars = 6000): void {
  if (!parseTraceVerbose()) return
  const n = text.length
  const t = n > maxChars ? `${text.slice(0, maxChars)}\n… [обрезано, всего ${n} символов]` : text
  console.log(`[LexPatrol][parse] ---------- ${label} (${n} симв.) ----------`)
  console.log(t)
  console.log(`[LexPatrol][parse] ---------- конец ${label} ----------`)
}

export function previewLines(text: string, maxLines = 25, maxLineLen = 160): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, maxLines)
    .map((l) => (l.length > maxLineLen ? `${l.slice(0, maxLineLen)}…` : l))
}
