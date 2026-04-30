/**
 * Нормализация номеров статей для сопоставления запроса «8.1» с полями БД
 * («Статья 8.1», «8,1», «№ 8.1 » и т.д.).
 */

/** Оставляем только цифры и точки, схлопываем лишние точки. */
export function normalizeArticleNumberCore(s: string): string {
  return s
    .replace(/№/g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.]/g, '')
    .replace(/\.+/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

/** Варианты строки для SQL IN по полю article_number (как в импорте). */
export function sqlLiteralVariantsForArticleNumber(requested: string): string[] {
  const core = normalizeArticleNumberCore(requested)
  const s = new Set<string>()
  if (core) {
    s.add(core)
    s.add(`${core}.`)
    s.add(`№ ${core}`)
    s.add(`№${core}`)
    s.add(`статья ${core}`)
    s.add(`Статья ${core}`)
    s.add(`ст. ${core}`)
    s.add(`ст ${core}`)
  }
  const trimmed = requested.trim().replace(/,/g, '.')
  if (trimmed.length) s.add(trimmed)
  return [...s].filter((x) => x.length > 0).slice(0, 16)
}

/**
 * Из формулировок «статья 8.1», «ст. 12.3» — все номера; для запроса выбираем самый специфичный
 * (8.1 важнее 8, если оба есть).
 */
export function parseArticleNumbersFromQuery(raw: string): string[] {
  const re = /(?:статья|статьёй|статье|статью|ст\.|ст\s*|№)\s*(\d+(?:\.\d+)*)/giu
  const found: string[] = []
  for (const m of raw.matchAll(re)) {
    const n = m[1]?.trim()
    if (n) found.push(n)
  }
  const m2 = raw.match(/№\s*(\d+(?:\.\d+)*)/u)
  if (m2?.[1]?.trim()) found.push(m2[1].trim())
  const uniq = [...new Set(found)]
  uniq.sort((a, b) => {
    const dots = (s: string) => (s.match(/\./g) ?? []).length
    const d = dots(b) - dots(a)
    if (d !== 0) return d
    return b.length - a.length
  })
  return uniq
}

/** Один основной номер для fallback по article_number (предпочтение подстатьям и длинным номерам). */
export function pickPrimaryArticleNumberFromQuery(raw: string): string | null {
  const nums = parseArticleNumbersFromQuery(raw)
  if (nums.length) return nums[0]
  const loose = raw.match(/(?:^|[\s,(«])((?:\d+\.)+\d+)(?:[^\d]|$)/)
  if (loose?.[1]) return loose[1].trim()
  return null
}

/** Совпадение номера в БД с запрошенным после нормализации. */
export function articleNumberMatchesQuery(dbValue: string | null | undefined, requested: string): boolean {
  const a = normalizeArticleNumberCore(dbValue ?? '')
  const b = normalizeArticleNumberCore(requested)
  if (!a || !b) return false
  return a === b
}

/** Узнаём номер статьи в строке заголовка/поля без лишних совпадений «18.1» для «8.1». */
export function rowTextMatchesArticleNumber(
  articleNumber: string | null | undefined,
  heading: string | null | undefined,
  requested: string
): boolean {
  const core = normalizeArticleNumberCore(requested)
  if (!core) return false
  if (articleNumberMatchesQuery(articleNumber, requested)) return true
  const blob = `${articleNumber ?? ''} ${heading ?? ''}`
  const re = new RegExp(`(^|[^\\d])${core.replace(/\./g, '\\.')}([^\\d]|$)`)
  return re.test(blob)
}
