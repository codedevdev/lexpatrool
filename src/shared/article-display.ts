/** Единый заголовок в списке и в карточке: не дублировать номер, если он уже в тексте («7.4» + «Часть 7.4…»). */

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Убрать лишний префикс номера перед «Статья/Часть…» при сохранении (например «7.4 Часть 7.4»). */
export function stripRedundantLeadingNumber(articleNumber: string | null, heading: string): string {
  const h = heading.trim()
  if (!articleNumber?.trim()) return h
  const num = articleNumber.trim()
  const reDup = new RegExp(`^${escapeRegExp(num)}\\s+(?=(?:Статья|статья|Часть|часть|ст\\.|ч\\.))`, 'i')
  if (reDup.test(h)) return h.replace(reDup, '').trim()
  return h
}

/**
 * Заголовок для отображения: если в heading уже есть тот же номер / «Часть N» / «Статья N», не prepend-ить article_number.
 */
export function articleDisplayTitle(articleNumber: string | null | undefined, heading: string): string {
  const h = stripRedundantLeadingNumber(articleNumber ?? null, heading.trim())
  if (!articleNumber?.trim()) return h
  const num = articleNumber.trim()
  const rePart = new RegExp(
    `^(?:Статья|статья|ст\\.|Часть|часть|ч\\.)\\s*[№N]?\\s*${escapeRegExp(num)}(?:[.\\s\u00A0]|$)`,
    'i'
  )
  const reBare = new RegExp(`^${escapeRegExp(num)}(?:[.\\s\u00A0]|$)`)
  if (rePart.test(h) || reBare.test(h)) return h
  return `${num} ${h}`
}
