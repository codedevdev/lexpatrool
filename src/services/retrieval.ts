import type { Database } from 'better-sqlite3'
import {
  articleNumberMatchesQuery,
  normalizeArticleNumberCore,
  parseArticleNumbersFromQuery,
  pickPrimaryArticleNumberFromQuery,
  rowTextMatchesArticleNumber,
  sqlLiteralVariantsForArticleNumber
} from '../shared/article-number'
import { expandLegalCodeAbbrevTokens } from '../shared/legal-code-abbrev'
import { buildMatchSnippet, buildMatchSnippetMulti, extractSearchTokens } from '../shared/search-tokens'

export interface RetrievalChunk {
  articleId: string
  documentId: string
  documentTitle: string
  heading: string
  articleNumber: string | null
  body: string
}

export type FtsRow = {
  article_id: string
  document_id: string
  document_title: string
  heading: string
  article_number: string | null
  body_clean: string
  summary_short: string | null
  penalty_hint: string | null
  display_meta_json: string | null
  parent_article_id: string | null
}

/** Keyword-кандидат с источником и позицией ранжирования — для слияния в гибридном retrieval. */
export interface KeywordCandidate {
  row: FtsRow
  /** Откуда пришёл: явный номер статьи, FTS или LIKE-fallback. */
  source: 'article-num' | 'fts' | 'like' | 'reference' | 'mention'
  /** Позиция в этом источнике (0 — самый релевантный). */
  rank: number
}

/** Общий список полей статьи для JOIN после FTS / fallback. */
const ARTICLE_ROW_SELECT = `a.id AS article_id, a.document_id, d.title AS document_title, a.heading, a.article_number,
  a.body_clean, a.summary_short, a.penalty_hint, a.display_meta_json, a.parent_article_id`

/** Кавычки для одного токена FTS5 (фраза из одного слова). */
function ftsQuoteToken(t: string): string {
  const s = t.replace(/"/g, '')
  return `"${s}"`
}

/** Варианты MATCH для перебора от строгого к мягкому. */
function ftsMatchVariants(tokens: string[]): string[] {
  if (tokens.length === 0) return []

  const quoted = tokens.map(ftsQuoteToken)
  const out: string[] = []

  out.push(quoted.join(' AND '))

  if (tokens.length >= 1) {
    const head = tokens.slice(0, -1)
    const last = tokens[tokens.length - 1]!
    const lastBare = last.replace(/"/g, '')
    if (head.length > 0) {
      out.push([...head.map(ftsQuoteToken), `${lastBare}*`].join(' AND '))
    } else {
      out.push(`${lastBare}*`)
    }
  }

  out.push(quoted.join(' OR '))

  if (tokens.every((t) => t.length >= 3)) {
    out.push(tokens.map((t) => `${t.replace(/"/g, '')}*`).join(' OR '))
  }

  const dotted = tokens.filter((t) => /\d+\.\d+/.test(t))
  if (dotted.length) {
    out.push(dotted.map((t) => ftsQuoteToken(t)).join(' OR '))
  }

  return [...new Set(out)]
}

function tagFilterClause(tagIds: string[] | undefined): { sql: string; params: string[] } {
  if (!tagIds?.length) return { sql: '', params: [] }
  const placeholders = tagIds.map(() => '?').join(', ')
  return {
    sql: ` AND a.id IN (SELECT article_id FROM article_tag_assignments WHERE tag_id IN (${placeholders})) `,
    params: tagIds
  }
}

/** Служебные слова запроса — не считаем их подсказкой к названию документа. */
const DOCUMENT_HINT_STOP = new Set([
  'окей',
  'статья',
  'статье',
  'статьёй',
  'статью',
  'чем',
  'что',
  'какой',
  'какая',
  'какие',
  'какое',
  'каков',
  'говорит',
  'скажи',
  'есть',
  'этот',
  'эта',
  'это',
  'эти',
  'про',
  'ли',
  'the',
  'what',
  'which',
  'about',
  'how',
  'такой',
  'такая',
  'такие',
  'могу',
  'могут',
  'будет',
  'было',
  'если',
  'лишь',
  'только',
  'очень'
])

/** Корень слова для LIKE по названию кодекса (склонения «Процессуального» vs «Процессуальный»). */
function documentTitleLikePattern(word: string): string {
  const w = word.trim()
  if (w.length >= 12) return `%${w.slice(0, 11)}%`
  return `%${w}%`
}

function extractDocumentHintSubstrings(raw: string): string[] {
  const words = extractSearchTokens(raw)
  const hints: string[] = []
  for (const w of words) {
    if (/^\d+(?:\.\d+)*$/.test(w)) continue

    const abbrevRoots = expandLegalCodeAbbrevTokens([w]).slice(1)
    if (abbrevRoots.length) {
      for (const a of abbrevRoots) {
        hints.push(a.length > 22 ? a.slice(0, 22) : a)
      }
      continue
    }

    if (w.length < 3) continue
    const low = w.toLowerCase()
    if (DOCUMENT_HINT_STOP.has(low)) continue
    hints.push(w.length > 22 ? w.slice(0, 22) : w)
  }
  return [...new Set(hints)].slice(0, 8)
}

/** Если в запросе нет длинных слов-корней к названию документа — по аббревиатурам ПК/УК и «кодекс». */
function inferDocumentHintsWhenEmpty(raw: string): string[] {
  const hints: string[] = []
  if (/\bпк\b|[пп]роцессуал/i.test(raw)) hints.push('процессуал')
  if (/\bук\b|[uu]головн/i.test(raw)) hints.push('уголовн')
  if (/\bак\b|[аa]дминистратив/i.test(raw)) hints.push('административн')
  if (/\bгк\b|[гg]ражданск/i.test(raw)) hints.push('гражданск')
  if (/\bнк\b|налогов/i.test(raw)) hints.push('налогов')
  if (/кодекс/i.test(raw)) hints.push('кодекс')
  if (/majestic|маджест|forum|форум/i.test(raw)) {
    hints.push('majestic')
    hints.push('forum')
  }
  return [...new Set(hints)].slice(0, 8)
}

function bodyMentionsArticleNumberToken(body: string, core: string): boolean {
  if (!core) return false
  return new RegExp(`(^|[^\\d])${core.replace(/\./g, '\\.')}([^\\d]|$)`).test(body)
}

/**
 * Точное совпадение article_number из запроса — выполняется до FTS, чтобы слоты контекста не занимали
 * другие статьи того же кодекса и целевая статья (например 8.1) не отрезалась лимитом maxPerDocument.
 */
function priorityExactArticleRows(
  db: Database,
  raw: string,
  tagIds: string[] | undefined,
  articleNum: string,
  exclude: Set<string>
): FtsRow[] {
  const literals = sqlLiteralVariantsForArticleNumber(articleNum)
  if (!literals.length) return []

  const litPh = literals.map(() => '?').join(', ')
  const { sql: tagSql, params: tagParams } = tagFilterClause(tagIds)

  let hints = extractDocumentHintSubstrings(raw)
  if (!hints.length) hints = inferDocumentHintsWhenEmpty(raw)

  const strict = (rows: FtsRow[]): FtsRow[] =>
    rows.filter((r) => articleNumberMatchesQuery(r.article_number, articleNum) && !exclude.has(r.article_id))

  if (hints.length) {
    const titleConds = hints.map(() => 'd.title LIKE ? COLLATE NOCASE').join(' OR ')
    const titleParams = hints.map(documentTitleLikePattern)
    const sql = `SELECT ${ARTICLE_ROW_SELECT}
       FROM articles a
       JOIN documents d ON d.id = a.document_id
       WHERE (${titleConds})
       AND coalesce(a.article_number, '') IN (${litPh})
       ${tagSql}
       LIMIT 12`
    let rows = db.prepare(sql).all(...titleParams, ...literals, ...tagParams) as FtsRow[]
    rows = strict(rows)
    if (rows.length) return rows
  }

  const sqlGlobal = `SELECT ${ARTICLE_ROW_SELECT}
     FROM articles a
     JOIN documents d ON d.id = a.document_id
     WHERE coalesce(a.article_number, '') IN (${litPh})
     ${tagSql}
     LIMIT 40`
  let rows = db.prepare(sqlGlobal).all(...literals, ...tagParams) as FtsRow[]
  rows = strict(rows)
  if (rows.length === 1) return rows
  return []
}

/** Если FTS не нашёл статью по номеру + названию кодекса — совпадение article_number / заголовка и LIKE по documents.title. */
function fallbackArticleReferenceRows(
  db: Database,
  raw: string,
  tagIds: string[] | undefined,
  exclude: Set<string>,
  limit: number
): FtsRow[] {
  if (limit <= 0) return []

  const articleNum = pickPrimaryArticleNumberFromQuery(raw)
  if (!articleNum) return []

  let hints = extractDocumentHintSubstrings(raw)
  if (!hints.length) hints = inferDocumentHintsWhenEmpty(raw)
  if (!hints.length) return []

  const literals = sqlLiteralVariantsForArticleNumber(articleNum)
  const litPh = literals.map(() => '?').join(', ')
  const core = normalizeArticleNumberCore(articleNum)
  const paddedCore = core ? ` ${core} ` : ''

  const { sql: tagSql, params: tagParams } = tagFilterClause(tagIds)

  const titleConds = hints.map(() => 'd.title LIKE ? COLLATE NOCASE').join(' OR ')
  const titleParams = hints.map(documentTitleLikePattern)

  const sql = `SELECT ${ARTICLE_ROW_SELECT}
     FROM articles a
     JOIN documents d ON d.id = a.document_id
     WHERE (${titleConds})
     AND (
       coalesce(a.article_number, '') IN (${litPh})
       OR instr(lower(' ' || coalesce(a.article_number, '') || ' ' || coalesce(a.heading, '') || ' '), lower(?)) > 0
     )
     ${tagSql}
     LIMIT ?`

  let rows = db
    .prepare(sql)
    .all(...titleParams, ...literals, paddedCore, ...tagParams, limit + exclude.size + 40) as FtsRow[]
  rows = rows.filter((r) => rowTextMatchesArticleNumber(r.article_number, r.heading, articleNum))
  rows = rows.filter((r) => !exclude.has(r.article_id)).slice(0, limit)
  return rows
}

/** Статьи, где в тексте явно упоминается номер (например ссылки на «8.1», если отдельной статьи нет в базе). */
function fallbackBodyMentionArticleNumberRows(
  db: Database,
  raw: string,
  tagIds: string[] | undefined,
  exclude: Set<string>,
  limit: number
): FtsRow[] {
  if (limit <= 0) return []

  const nums = parseArticleNumbersFromQuery(raw)
  const dotted = nums.filter((n) => n.includes('.'))
  const primary = pickPrimaryArticleNumberFromQuery(raw)
  const cores = [
    ...new Set(
      [...dotted, ...(primary?.includes('.') ? [primary] : [])].map((n) => normalizeArticleNumberCore(n))
    )
  ].filter(Boolean)
  if (!cores.length) return []

  let hints = extractDocumentHintSubstrings(raw)
  if (!hints.length) hints = inferDocumentHintsWhenEmpty(raw)
  if (!hints.length) return []

  const { sql: tagSql, params: tagParams } = tagFilterClause(tagIds)
  const titleConds = hints.map(() => 'd.title LIKE ? COLLATE NOCASE').join(' OR ')
  const titleParams = hints.map(documentTitleLikePattern)

  const bodyOr = cores
    .map(
      () =>
        '(a.body_clean LIKE ? COLLATE NOCASE OR IFNULL(a.summary_short, \'\') LIKE ? COLLATE NOCASE)'
    )
    .join(' OR ')
  const likeParams: string[] = []
  for (const c of cores) {
    likeParams.push(`%${c}%`, `%${c}%`)
  }

  const sql = `SELECT ${ARTICLE_ROW_SELECT}
     FROM articles a
     JOIN documents d ON d.id = a.document_id
     WHERE (${titleConds})
     AND (${bodyOr})
     ${tagSql}
     LIMIT ?`

  let rows = db
    .prepare(sql)
    .all(...titleParams, ...likeParams, ...tagParams, limit + exclude.size + 60) as FtsRow[]
  rows = rows.filter((r) => {
    const blob = `${r.body_clean ?? ''}\n${r.summary_short ?? ''}`
    return cores.some((c) => bodyMentionsArticleNumberToken(blob, c))
  })
  rows = rows.filter((r) => !exclude.has(r.article_id)).slice(0, limit)
  return rows
}

function runFts(db: Database, match: string, limit: number, tagIds?: string[]): FtsRow[] {
  const { sql: tagSql, params: tagParams } = tagFilterClause(tagIds)
  try {
    const rows = db
      .prepare(
        `SELECT ${ARTICLE_ROW_SELECT}
         FROM articles_fts
         JOIN articles a ON a.id = articles_fts.article_id
         JOIN documents d ON d.id = a.document_id
         WHERE articles_fts MATCH ?${tagSql}
         ORDER BY bm25(articles_fts)
         LIMIT ?`
      )
      .all(match, ...tagParams, limit) as FtsRow[]
    return rows
  } catch {
    try {
      const rows = db
        .prepare(
          `SELECT ${ARTICLE_ROW_SELECT}
           FROM articles_fts
           JOIN articles a ON a.id = articles_fts.article_id
           JOIN documents d ON d.id = a.document_id
           WHERE articles_fts MATCH ?${tagSql}
           ORDER BY rank
           LIMIT ?`
        )
        .all(match, ...tagParams, limit) as FtsRow[]
      return rows
    } catch {
      return []
    }
  }
}

function fallbackLikeMulti(
  db: Database,
  tokens: string[],
  limit: number,
  exclude: Set<string>,
  tagIds?: string[]
): FtsRow[] {
  if (!tokens.length || limit <= 0) return []

  const safe = tokens.map((t) => t.replace(/%/g, '').replace(/_/g, '')).filter((t) => t.length >= 2)
  if (!safe.length) return []

  const fieldMatch = `(a.body_clean LIKE ? COLLATE NOCASE OR a.heading LIKE ? COLLATE NOCASE OR IFNULL(a.summary_short, '') LIKE ? COLLATE NOCASE OR IFNULL(a.penalty_hint, '') LIKE ? COLLATE NOCASE)`
  const cond = safe.map(() => fieldMatch).join(' AND ')
  const params: string[] = []
  for (const t of safe) {
    const p = `%${t}%`
    params.push(p, p, p, p)
  }

  const { sql: tagSql, params: tagParams } = tagFilterClause(tagIds)

  const sql = `SELECT ${ARTICLE_ROW_SELECT}
     FROM articles a
     JOIN documents d ON d.id = a.document_id
     WHERE (${cond})${tagSql}
     LIMIT ?`

  let rows = db.prepare(sql).all(...params, ...tagParams, limit + exclude.size) as FtsRow[]
  rows = rows.filter((r) => !exclude.has(r.article_id)).slice(0, limit)
  return rows
}

function fallbackLikePhrase(db: Database, phrase: string, limit: number, tagIds?: string[]): FtsRow[] {
  const q = phrase.trim()
  if (q.length < 2) return []
  const like = `%${q.replace(/%/g, '').replace(/_/g, '')}%`
  if (like === '%%') return []

  const { sql: tagSql, params: tagParams } = tagFilterClause(tagIds)

  return db
    .prepare(
      `SELECT ${ARTICLE_ROW_SELECT}
       FROM articles a
       JOIN documents d ON d.id = a.document_id
       WHERE (
         a.body_clean LIKE ? COLLATE NOCASE OR a.heading LIKE ? COLLATE NOCASE
         OR IFNULL(a.summary_short, '') LIKE ? COLLATE NOCASE OR IFNULL(a.penalty_hint, '') LIKE ? COLLATE NOCASE
       )${tagSql}
       LIMIT ?`
    )
    .all(like, like, like, like, ...tagParams, limit) as FtsRow[]
}

/** Длина выдержки из тела статьи для контекста ИИ (вокруг совпадения с запросом). */
const CHUNK_EXCERPT_MAX = 4200

/** Верхний предел размера одного фрагмента в промпте (иерархия + мета + выдержка). */
const CHUNK_BODY_HARD_CAP = 12000

/**
 * Для lookup по статье: в промпт кладём почти весь `articles.body_clean` (подпункты 2.1, стадии и т.д.).
 * SQLite: полный текст нормы — `body_clean`; краткая выжимка — `summary_short` (см. auxiliaryBlock).
 */
const CHUNK_BODY_HARD_CAP_FULL = 58_000
const FULL_BODY_CORE_CAP = 38_000

export type ArticleBodyPromptMode = 'snippet' | 'full'

export interface RowToPromptChunkOptions {
  /** По умолчанию snippet — окно вокруг совпадения; full — почти всё тело статьи (длинные процедуры). */
  articleBodyMode?: ArticleBodyPromptMode
}

const MAX_PARENT_CHAIN = 8
const MAX_CHILD_PREVIEWS = 10
const CHILD_BODY_CAP = 700
const PARENT_SUMMARY_CAP = 140

function excerptForChunk(body: string, query: string): string {
  const tokens = extractSearchTokens(query)
  if (tokens.length >= 2) {
    return buildMatchSnippetMulti(body, tokens, CHUNK_EXCERPT_MAX)
  }
  if (tokens.length === 1) {
    return buildMatchSnippet(body, tokens, CHUNK_EXCERPT_MAX)
  }
  const q = query.trim()
  if (q.length >= 2) {
    return buildMatchSnippet(body, [q], CHUNK_EXCERPT_MAX)
  }
  return body.length <= CHUNK_EXCERPT_MAX ? body : `${body.slice(0, CHUNK_EXCERPT_MAX)}…`
}

function articleCoreForPrompt(body: string, query: string, mode: ArticleBodyPromptMode): string {
  const b = body ?? ''
  if (mode !== 'full') return excerptForChunk(b, query)
  if (b.length <= FULL_BODY_CORE_CAP) return b
  return `${b.slice(0, FULL_BODY_CORE_CAP)}\n\n[…дальше текст статьи обрезан по длине; полный текст — в читателе приложения.]`
}

function articleLabel(heading: string, articleNumber: string | null): string {
  const n = articleNumber?.trim()
  return n ? `${n} ${heading}` : heading
}

/**
 * Текстовое представление display_meta_json для контекста ИИ (без привязки к UI).
 */
function flattenDisplayMetaJson(raw: string | null | undefined): string {
  if (!raw?.trim()) return ''
  try {
    const m = JSON.parse(raw) as Record<string, unknown>
    const parts: string[] = []
    if (typeof m.jurisdiction === 'string' && m.jurisdiction.trim()) {
      parts.push(`Юрисдикция ${m.jurisdiction.trim()}`)
    }
    if (typeof m.stars === 'number' && m.stars > 0) {
      parts.push(`${m.stars}★`)
    }
    if (typeof m.fineUsd === 'number') {
      parts.push(`штраф ${m.fineUsd} USD`)
    }
    if (typeof m.fineRub === 'number') {
      parts.push(`штраф ${m.fineRub} руб`)
    }
    if (typeof m.ukArticle === 'string' && m.ukArticle.trim()) {
      parts.push(`УК: ${m.ukArticle.trim()}`)
    }
    if (Array.isArray(m.tags)) {
      const tags = (m.tags as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      if (tags.length) parts.push(`Теги: ${tags.join(', ')}`)
    }
    if (typeof m.bailHint === 'string' && m.bailHint.trim()) {
      parts.push(`Залог: ${m.bailHint.trim()}`)
    }
    if (m.criminalRecord === true) {
      parts.push('судимость (CR)')
    }
    if (typeof m.severityTier === 'string' && m.severityTier.trim()) {
      parts.push(`тяжесть: ${m.severityTier}`)
    }
    return parts.join('. ')
  } catch {
    return ''
  }
}

function parentChainBlock(db: Database, articleId: string): string {
  const lines: string[] = []
  let cur = db.prepare('SELECT parent_article_id FROM articles WHERE id = ?').get(articleId) as
    | { parent_article_id: string | null }
    | undefined
  let pid = cur?.parent_article_id ?? null
  const seen = new Set<string>()
  while (pid && !seen.has(pid) && lines.length < MAX_PARENT_CHAIN) {
    seen.add(pid)
    const row = db
      .prepare(
        `SELECT id, parent_article_id, heading, article_number, summary_short FROM articles WHERE id = ?`
      )
      .get(pid) as
      | {
          id: string
          parent_article_id: string | null
          heading: string
          article_number: string | null
          summary_short: string | null
        }
      | undefined
    if (!row) break
    const label = articleLabel(row.heading, row.article_number)
    const sum = row.summary_short?.trim()
    const sumShort =
      sum && sum.length > PARENT_SUMMARY_CAP ? `${sum.slice(0, PARENT_SUMMARY_CAP)}…` : sum
    lines.unshift(sumShort ? `${label} — ${sumShort}` : label)
    pid = row.parent_article_id
  }
  if (!lines.length) return ''
  return `Иерархия (от корня документа к целевой статье):\n${lines.map((l) => `• ${l}`).join('\n')}`
}

function childrenBlock(db: Database, articleId: string): string {
  const rows = db
    .prepare(
      `SELECT heading, article_number, body_clean FROM articles WHERE parent_article_id = ? ORDER BY sort_order ASC LIMIT ?`
    )
    .all(articleId, MAX_CHILD_PREVIEWS) as { heading: string; article_number: string | null; body_clean: string }[]
  if (!rows.length) return ''
  const parts = rows.map((r) => {
    const label = articleLabel(r.heading, r.article_number)
    const b = r.body_clean.trim()
    const body = b.length > CHILD_BODY_CAP ? `${b.slice(0, CHILD_BODY_CAP)}…` : b
    return `• ${label}\n${body}`
  })
  return `Подстатьи и части (прямые потомки этой статьи в документе):\n${parts.join('\n\n')}`
}

function hierarchyBlock(db: Database, articleId: string): string {
  const p = parentChainBlock(db, articleId)
  const c = childrenBlock(db, articleId)
  const blocks = [p, c].filter(Boolean)
  if (!blocks.length) return ''
  return `${blocks.join('\n\n')}\n\n`
}

function auxiliaryBlock(r: FtsRow): string {
  const parts: string[] = []
  if (r.summary_short?.trim()) {
    parts.push(`Кратко: ${r.summary_short.trim()}`)
  }
  if (r.penalty_hint?.trim()) {
    parts.push(`Наказание / санкции: ${r.penalty_hint.trim()}`)
  }
  const meta = flattenDisplayMetaJson(r.display_meta_json)
  if (meta) {
    parts.push(`Доп. метаданные (классификатор): ${meta}`)
  }
  if (!parts.length) return ''
  return `${parts.join('\n')}\n\n`
}

function rowToChunk(db: Database, r: FtsRow, query: string, opts?: RowToPromptChunkOptions): RetrievalChunk {
  const mode: ArticleBodyPromptMode = opts?.articleBodyMode === 'full' ? 'full' : 'snippet'
  const hier = hierarchyBlock(db, r.article_id)
  const aux = auxiliaryBlock(r)
  const core = articleCoreForPrompt(r.body_clean, query, mode)
  let composed = `${hier}${aux}--- Основной текст статьи ---\n${core}`
  const hardCap = mode === 'full' ? CHUNK_BODY_HARD_CAP_FULL : CHUNK_BODY_HARD_CAP
  if (composed.length > hardCap) {
    composed = `${composed.slice(0, hardCap)}…`
  }
  return {
    articleId: r.article_id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    heading: r.heading,
    articleNumber: r.article_number,
    body: composed
  }
}

export type RetrieveOptions = {
  /** Ограничить выдачу статьями с любым из перечисленных тегов (id из таблицы tags). */
  tagIds?: string[]
  /**
   * Не более стольких статей из одного документа (баланс: один кодекс не забирает все слоты контекста).
   * По умолчанию 4.
   */
  maxPerDocument?: number
}

/** Сколько строк запрашивать у FTS за один проход — с запасом из-за отсечения по документу и дубликатам. */
function ftsCandidateLimit(need: number): number {
  return Math.min(220, Math.max(need * 14, 56))
}

/** Полнотекстовый и резервный поиск по статьям для оверлея, базы и ИИ. */
export function retrieveChunksForQuery(
  db: Database,
  query: string,
  limit = 8,
  options?: RetrieveOptions
): RetrievalChunk[] {
  const tagIds = options?.tagIds?.filter((id) => typeof id === 'string' && id.trim().length > 0)
  const raw = query.trim().replace(/\s+/g, ' ')
  if (!raw) return []

  const maxPerDoc = Math.min(30, Math.max(1, options?.maxPerDocument ?? 4))
  const tokens = extractSearchTokens(raw)
  const seen = new Set<string>()
  const docCount = new Map<string, number>()
  const chunks: RetrievalChunk[] = []

  /** Приоритет: явные номера статей из запроса — без лимита «статей на документ» (он ниже для FTS). */
  const pushPriorityRows = (rows: FtsRow[]): void => {
    for (const r of rows) {
      if (seen.has(r.article_id)) continue
      seen.add(r.article_id)
      docCount.set(r.document_id, (docCount.get(r.document_id) ?? 0) + 1)
      chunks.push(rowToChunk(db, r, raw))
      if (chunks.length >= limit) break
    }
  }

  const primaryLoose = pickPrimaryArticleNumberFromQuery(raw)
  const articleTargets = [
    ...new Set([...parseArticleNumbersFromQuery(raw), ...(primaryLoose ? [primaryLoose] : [])])
  ].slice(0, 4)

  for (const num of articleTargets) {
    if (chunks.length >= limit) break
    const exact = priorityExactArticleRows(db, raw, tagIds, num, seen)
    pushPriorityRows(exact)
  }

  const pushRows = (rows: FtsRow[]): void => {
    for (const r of rows) {
      if (seen.has(r.article_id)) continue
      const n = docCount.get(r.document_id) ?? 0
      if (n >= maxPerDoc) continue
      seen.add(r.article_id)
      docCount.set(r.document_id, n + 1)
      chunks.push(rowToChunk(db, r, raw))
      if (chunks.length >= limit) break
    }
  }

  if (tokens.length > 0) {
    const variants = ftsMatchVariants(tokens)
    const fetchN = ftsCandidateLimit(limit)
    for (const m of variants) {
      if (chunks.length >= limit) break
      const rows = runFts(db, m, fetchN, tagIds)
      pushRows(rows)
    }

    if (chunks.length < limit) {
      const more = fallbackLikeMulti(db, tokens, fetchN, seen, tagIds)
      pushRows(more)
    }
  }

  if (chunks.length < limit && raw.length >= 2) {
    const more = fallbackLikePhrase(db, raw, ftsCandidateLimit(limit + seen.size), tagIds).filter(
      (r) => !seen.has(r.article_id)
    )
    pushRows(more)
  }

  if (chunks.length < limit) {
    const refRows = fallbackArticleReferenceRows(db, raw, tagIds, seen, limit - chunks.length)
    pushRows(refRows)
  }

  if (chunks.length < limit) {
    const mentionRows = fallbackBodyMentionArticleNumberRows(db, raw, tagIds, seen, limit - chunks.length)
    pushRows(mentionRows)
  }

  return chunks.slice(0, limit)
}

/** Сниппет для списка результатов IPC (после подбора статей). */
export function snippetForArticleBody(body: string, query: string): string {
  const tokens = extractSearchTokens(query)
  if (tokens.length) return buildMatchSnippet(body, tokens, 280)
  const q = query.trim()
  if (q.length >= 2) return buildMatchSnippet(body, [q], 280)
  return body.slice(0, 280)
}

/* ============================================================
 * Хук для гибридного retrieval (FTS + embeddings) в ai-pipeline.
 * `retrieveKeywordCandidates` возвращает «сырые» строки FTS/LIKE с пометкой источника и rank,
 * без склейки в полный текст для промпта — это делает уже pipeline после слияния и реранкинга.
 * ============================================================ */

export interface KeywordRetrievalOptions extends RetrieveOptions {
  /** Лимит итогового списка после дедупликации. */
  limit?: number
  /**
   * Если задано — номера статей (parseArticleNumbers / exact rows) берутся только из этой строки,
   * а не из полного `query` (FTS/LIKE по-прежнему по `query`).
   */
  articleNumberQuery?: string
}

/** Слой keyword-поиска для гибридного RAG: возвращает кандидатов с источником и позицией. */
export function retrieveKeywordCandidates(
  db: Database,
  query: string,
  options?: KeywordRetrievalOptions
): KeywordCandidate[] {
  const limit = Math.max(1, Math.min(80, options?.limit ?? 30))
  const tagIds = options?.tagIds?.filter((id) => typeof id === 'string' && id.trim().length > 0)
  const raw = query.trim().replace(/\s+/g, ' ')
  if (!raw) return []

  const rawForArticleNums = (options?.articleNumberQuery ?? raw).trim().replace(/\s+/g, ' ')

  const tokens = extractSearchTokens(raw)
  const seen = new Set<string>()
  const out: KeywordCandidate[] = []

  const push = (row: FtsRow, source: KeywordCandidate['source']): void => {
    if (seen.has(row.article_id)) return
    seen.add(row.article_id)
    out.push({ row, source, rank: out.filter((c) => c.source === source).length })
  }

  // 1) Явные номера статей.
  const primary = pickPrimaryArticleNumberFromQuery(rawForArticleNums)
  const articleTargets = [
    ...new Set([...parseArticleNumbersFromQuery(rawForArticleNums), ...(primary ? [primary] : [])])
  ].slice(0, 4)
  for (const num of articleTargets) {
    if (out.length >= limit) break
    const exact = priorityExactArticleRows(db, rawForArticleNums, tagIds, num, seen)
    for (const r of exact) {
      if (out.length >= limit) break
      push(r, 'article-num')
    }
  }

  // 2) FTS по нескольким вариантам MATCH.
  if (tokens.length > 0 && out.length < limit) {
    const variants = ftsMatchVariants(tokens)
    const fetchN = ftsCandidateLimit(limit)
    for (const m of variants) {
      if (out.length >= limit) break
      const rows = runFts(db, m, fetchN, tagIds)
      for (const r of rows) {
        if (out.length >= limit) break
        push(r, 'fts')
      }
    }

    if (out.length < limit) {
      const more = fallbackLikeMulti(db, tokens, ftsCandidateLimit(limit), seen, tagIds)
      for (const r of more) {
        if (out.length >= limit) break
        push(r, 'like')
      }
    }
  }

  if (out.length < limit && raw.length >= 2) {
    const phrase = fallbackLikePhrase(db, raw, ftsCandidateLimit(limit + seen.size), tagIds).filter(
      (r) => !seen.has(r.article_id)
    )
    for (const r of phrase) {
      if (out.length >= limit) break
      push(r, 'like')
    }
  }

  if (out.length < limit) {
    const ref = fallbackArticleReferenceRows(db, raw, tagIds, seen, limit - out.length)
    for (const r of ref) {
      if (out.length >= limit) break
      push(r, 'reference')
    }
  }

  if (out.length < limit) {
    const mention = fallbackBodyMentionArticleNumberRows(db, raw, tagIds, seen, limit - out.length)
    for (const r of mention) {
      if (out.length >= limit) break
      push(r, 'mention')
    }
  }

  return out.slice(0, limit)
}

/** Достаёт строки статей по списку id без потери порядка. */
export function loadArticleRowsByIds(db: Database, ids: string[]): Map<string, FtsRow> {
  const out = new Map<string, FtsRow>()
  if (!ids.length) return out
  const placeholders = ids.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT ${ARTICLE_ROW_SELECT}
       FROM articles a JOIN documents d ON d.id = a.document_id
       WHERE a.id IN (${placeholders})`
    )
    .all(...ids) as FtsRow[]
  for (const r of rows) out.set(r.article_id, r)
  return out
}

/** Превращает строку статьи в полный фрагмент для промпта (иерархия + мета + выдержка или полное тело). */
export function rowToPromptChunk(
  db: Database,
  row: FtsRow,
  query: string,
  opts?: RowToPromptChunkOptions
): RetrievalChunk {
  return rowToChunk(db, row, query, opts)
}

/** Короткий сниппет тела статьи под запрос для UI «Что нашлось в базе». */
export function rowToShortSnippet(row: FtsRow, query: string): string {
  const body = row.body_clean ?? ''
  return snippetForArticleBody(body, query)
}
