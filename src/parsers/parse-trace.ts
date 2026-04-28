/**
 * Диагностика разбора статей в терминал (main process: npm run dev / electron).
 * Включить подробный дамп текста: LEX_PARSE_DEBUG=1 или LEX_PARSE_TRACE=1
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
