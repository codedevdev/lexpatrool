/**
 * Укороченные названия кодексов в запросах («ПК», «УК», «pk») → корни для FTS/LIKE,
 * чтобы находить документы с полными заголовками («Процессуальный кодекс», …).
 * При неоднозначности перечислены несколько корней (перебор OR в FTS).
 */

export const LEGAL_CODE_ABBREV_TO_SEARCH_TERMS: Record<string, readonly string[]> = {
  пк: ['процессуальный', 'процессуальн', 'уголовно-процессуальный'],
  упк: ['уголовно-процессуальный', 'уголовно-процессуальн'],
  ук: ['уголовный', 'уголовн'],
  ак: ['административный', 'административн'],
  апк: ['арбитражный', 'арбитражн'],
  гк: ['гражданский', 'гражданск'],
  нк: ['налоговый', 'налогов'],
  жк: ['жилищный', 'жилищн'],
  тк: ['трудовой', 'трудов'],
  ск: ['семейный', 'семейн'],
  коап: ['коап', 'административных правонарушений', 'административн']
}

/** Латиница в чате (раскладка / привычка): pk → те же корни, что у «пк». */
const LATIN_ABBREV_TO_KEY: Record<string, keyof typeof LEGAL_CODE_ABBREV_TO_SEARCH_TERMS> = {
  pk: 'пк',
  uk: 'ук',
  ak: 'ак',
  gk: 'гк',
  nk: 'нк',
  jk: 'жк',
  tk: 'тк',
  sk: 'ск',
  upk: 'упк',
  apk: 'апк',
  koap: 'коап'
}

function normalizeAbbrevToken(t: string): string {
  return t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase()
}

function lookupAbbrevExpansions(token: string): readonly string[] | undefined {
  const n = normalizeAbbrevToken(token)
  if (!n.length) return undefined

  const direct = LEGAL_CODE_ABBREV_TO_SEARCH_TERMS[n]
  if (direct) return direct

  const ascii = n.replace(/[^a-z0-9]/gi, '')
  const key = LATIN_ABBREV_TO_KEY[ascii]
  if (key) return LEGAL_CODE_ABBREV_TO_SEARCH_TERMS[key]

  return undefined
}

/**
 * Добавляет к токенам запроса корни полных названий для совпадения с заголовками документов и FTS.
 * Исходные токены идут первыми; дубликаты по регистру не добавляются.
 */
export function expandLegalCodeAbbrevTokens(tokens: string[]): string[] {
  const seen = new Set(tokens.map((t) => t.toLowerCase()))
  const out = [...tokens]
  for (const t of tokens) {
    const adds = lookupAbbrevExpansions(t)
    if (!adds) continue
    for (const a of adds) {
      const al = a.toLowerCase()
      if (!seen.has(al)) {
        seen.add(al)
        out.push(a)
      }
    }
  }
  return out
}

/**
 * Корневые формы названий кодексов, которые встречаются в `documents.title` (для фильтрации по кодексу).
 * Сюда заносим только укороченные «без окончаний» варианты — они стабильно матчат и «Процессуальный»,
 * и «процессуальная», и «Уголовно-процессуального».
 */
const CODEX_TITLE_ROOTS: Record<string, readonly string[]> = {
  процессуальный: ['процессуальн'],
  'уголовно-процессуальный': ['уголовно-процессуальн', 'процессуальн'],
  уголовный: ['уголовн'],
  административный: ['административн'],
  арбитражный: ['арбитражн'],
  гражданский: ['гражданск'],
  налоговый: ['налогов'],
  жилищный: ['жилищн'],
  трудовой: ['трудов'],
  семейный: ['семейн'],
  коап: ['коап', 'административн']
}

/**
 * Привязывает синонимы к каноничным ключам — что бы пользователь ни написал
 * («процессуальном», «процессуальный», «УПК», «pk»), мы должны вернуть один и тот же набор корней.
 */
const CODEX_SYNONYMS: Record<string, keyof typeof CODEX_TITLE_ROOTS> = {
  пк: 'процессуальный',
  pk: 'процессуальный',
  упк: 'уголовно-процессуальный',
  upk: 'уголовно-процессуальный',
  ук: 'уголовный',
  uk: 'уголовный',
  ак: 'административный',
  ak: 'административный',
  апк: 'арбитражный',
  apk: 'арбитражный',
  гк: 'гражданский',
  gk: 'гражданский',
  нк: 'налоговый',
  nk: 'налоговый',
  жк: 'жилищный',
  jk: 'жилищный',
  тк: 'трудовой',
  tk: 'трудовой',
  ск: 'семейный',
  sk: 'семейный',
  koap: 'коап'
}

/** Канонический ключ кодекса (как в `CODEX_TITLE_ROOTS`) — для приоритета «текущее сообщение». */
export type CodexCanonicalKey = keyof typeof CODEX_TITLE_ROOTS

/** Один токен → каноничный ключ кодекса (или null). */
function codexCanonicalForToken(token: string): CodexCanonicalKey | null {
  const n = token.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '')
  if (!n) return null
  if (n in CODEX_TITLE_ROOTS) return n as CodexCanonicalKey
  if (n in CODEX_SYNONYMS) return CODEX_SYNONYMS[n]!
  // Падежи / окончания (process-уальном, уголов-ного и т.д.) → ищем по началу.
  if (/^процессуа/.test(n)) return 'процессуальный'
  if (/^уголовно-?процесс/.test(n)) return 'уголовно-процессуальный'
  if (/^уголовн/.test(n)) return 'уголовный'
  if (/^административн/.test(n)) return 'административный'
  if (/^арбитражн/.test(n)) return 'арбитражный'
  if (/^гражданск/.test(n)) return 'гражданский'
  if (/^налогов/.test(n)) return 'налоговый'
  if (/^жилищн/.test(n)) return 'жилищный'
  if (/^трудов/.test(n)) return 'трудовой'
  if (/^семейн/.test(n)) return 'семейный'
  return null
}

/**
 * Канонические ключи кодексов, явно упомянутые в тексте (порядок появления, без дубликатов).
 * Не сливает несколько сообщений чата — передавайте одну строку или массив только «текущего хода».
 */
export function extractCodexCanonicalKeys(input: string | string[]): CodexCanonicalKey[] {
  const texts = Array.isArray(input) ? input : [input]
  const seen = new Set<CodexCanonicalKey>()
  const out: CodexCanonicalKey[] = []

  for (const text of texts) {
    if (!text) continue
    const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, ' ')
    for (const tok of normalized.split(/\s+/)) {
      if (!tok) continue
      const key = codexCanonicalForToken(tok)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(key)
    }
  }
  return out
}

/** Корни `documents.title` для заданных канонических ключей (для жёсткого фильтра в пайплайне). */
export function codexHintRootsForCanonicalKeys(keys: CodexCanonicalKey[]): string[] {
  const tokenSeen = new Set<string>()
  const out: string[] = []
  for (const key of keys) {
    for (const r of CODEX_TITLE_ROOTS[key] ?? []) {
      const rl = r.toLowerCase()
      if (!rl || tokenSeen.has(rl)) continue
      tokenSeen.add(rl)
      out.push(rl)
    }
  }
  return out
}

/**
 * Извлекает явные «подсказки кодекса» из произвольного текста (вопроса пользователя или планера).
 * Возвращает корни, которые гарантированно совпадут с `documents.title` (через `LIKE %root%`).
 *
 * Используется в ai-pipeline.ts, чтобы при «Процессуальный кодекс ст. 8.1» не утянуло УК 8.1.
 */
export function extractCodexHintRoots(input: string | string[]): string[] {
  return codexHintRootsForCanonicalKeys(extractCodexCanonicalKeys(input))
}

/** Проверяет, что заголовок документа явно относится к одному из перечисленных корней-кодексов. */
export function documentTitleMatchesCodexRoots(title: string, roots: string[]): boolean {
  if (!roots.length) return true
  const t = (title ?? '').toLowerCase()
  if (!t) return false
  for (const r of roots) {
    if (r && t.includes(r)) return true
  }
  return false
}
