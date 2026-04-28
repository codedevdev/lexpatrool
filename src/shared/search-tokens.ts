/** Общая токенизация для FTS и UI (кириллица/латиница, цифры). */

const MAX_TOKENS = 16

/**
 * Слова из запроса: пробелы, минимум 2 символа, без пунктуации по краям.
 * Пример: «оружие, ношение» → ['оружие', 'ношение']
 */
export function extractSearchTokens(query: string): string[] {
  const trimmed = query.trim().replace(/\s+/g, ' ')
  if (!trimmed) return []

  const parts = trimmed.split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (const part of parts) {
    const cleaned = part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    if (cleaned.length >= 2) out.push(cleaned)
  }

  const uniq = [...new Set(out)]
  return uniq.slice(0, MAX_TOKENS)
}

/**
 * Фрагмент текста вокруг первого вхождения любого токена (для превью в поиске).
 */
export function buildMatchSnippet(body: string, tokens: string[], maxLen = 280): string {
  const text = body ?? ''
  if (!text.length) return ''
  const lower = text.toLowerCase()
  let best = -1
  for (const t of tokens) {
    if (t.length < 2) continue
    const i = lower.indexOf(t.toLowerCase())
    if (i >= 0 && (best < 0 || i < best)) best = i
  }
  if (best < 0) {
    return text.length <= maxLen ? text : `${text.slice(0, maxLen)}…`
  }
  const left = Math.max(0, best - Math.floor(maxLen * 0.25))
  const slice = text.slice(left, left + maxLen)
  const prefix = left > 0 ? '…' : ''
  const suffix = left + maxLen < text.length ? '…' : ''
  return `${prefix}${slice}${suffix}`
}
