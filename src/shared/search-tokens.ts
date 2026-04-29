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

/**
 * Выдержка вокруг всех вхождений токенов (минимальный отрезок, покрывающий совпадения), затем обрезка до maxLen.
 * Удобно для длинных статей, когда релевантные части разнесены (несколько слов запроса).
 */
export function buildMatchSnippetMulti(body: string, tokens: string[], maxLen: number): string {
  const text = body ?? ''
  if (!text.length || maxLen < 80) return ''
  const lower = text.toLowerCase()
  let minI = -1
  let maxI = -1
  for (const t of tokens) {
    if (t.length < 2) continue
    const tl = t.toLowerCase()
    let from = 0
    while (from < text.length) {
      const i = lower.indexOf(tl, from)
      if (i < 0) break
      const end = i + t.length
      if (minI < 0 || i < minI) minI = i
      if (maxI < 0 || end > maxI) maxI = end
      from = i + 1
    }
  }
  if (minI < 0) {
    return text.length <= maxLen ? text : `${text.slice(0, maxLen)}…`
  }
  const core = maxI - minI
  if (core >= maxLen) {
    return buildMatchSnippet(body, tokens, maxLen)
  }
  const padTotal = maxLen - core
  const padLeft = Math.floor(padTotal / 2)
  let left = Math.max(0, minI - padLeft)
  let right = Math.min(text.length, left + maxLen)
  left = Math.max(0, right - maxLen)
  const slice = text.slice(left, right)
  const prefix = left > 0 ? '…' : ''
  const suffix = right < text.length ? '…' : ''
  return `${prefix}${slice}${suffix}`
}
