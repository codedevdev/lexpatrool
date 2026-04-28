import type { Database } from 'better-sqlite3'
import { buildMatchSnippet, extractSearchTokens } from '../shared/search-tokens'

export interface RetrievalChunk {
  articleId: string
  documentId: string
  documentTitle: string
  heading: string
  articleNumber: string | null
  body: string
}

type FtsRow = {
  article_id: string
  document_id: string
  document_title: string
  heading: string
  article_number: string | null
  body_clean: string
}

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

  // Все слова должны встретиться (не обязательно рядом).
  out.push(quoted.join(' AND '))

  // То же + префикс у последнего слова (ношение → ношения…).
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

  // Хотя бы одно слово — если AND даёт пусто (разная морфология в тексте).
  out.push(quoted.join(' OR '))

  // Однословные префиксы по каждому токену (узко, но ловит начало слова).
  if (tokens.every((t) => t.length >= 3)) {
    out.push(tokens.map((t) => `${t.replace(/"/g, '')}*`).join(' OR '))
  }

  return [...new Set(out)]
}

function runFts(db: Database, match: string, limit: number): FtsRow[] {
  try {
    const rows = db
      .prepare(
        `SELECT a.id AS article_id, a.document_id, d.title AS document_title, a.heading, a.article_number, a.body_clean
         FROM articles_fts
         JOIN articles a ON a.id = articles_fts.article_id
         JOIN documents d ON d.id = a.document_id
         WHERE articles_fts MATCH ?
         ORDER BY bm25(articles_fts)
         LIMIT ?`
      )
      .all(match, limit) as FtsRow[]
    return rows
  } catch {
    try {
      const rows = db
        .prepare(
          `SELECT a.id AS article_id, a.document_id, d.title AS document_title, a.heading, a.article_number, a.body_clean
           FROM articles_fts
           JOIN articles a ON a.id = articles_fts.article_id
           JOIN documents d ON d.id = a.document_id
           WHERE articles_fts MATCH ?
           ORDER BY rank
           LIMIT ?`
        )
        .all(match, limit) as FtsRow[]
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
  exclude: Set<string>
): FtsRow[] {
  if (!tokens.length || limit <= 0) return []

  const safe = tokens.map((t) => t.replace(/%/g, '').replace(/_/g, '')).filter((t) => t.length >= 2)
  if (!safe.length) return []

  const cond = safe.map(() => '(a.body_clean LIKE ? COLLATE NOCASE OR a.heading LIKE ? COLLATE NOCASE)').join(' AND ')
  const params: string[] = []
  for (const t of safe) {
    const p = `%${t}%`
    params.push(p, p)
  }

  const sql = `SELECT a.id AS article_id, a.document_id, d.title AS document_title, a.heading, a.article_number, a.body_clean
     FROM articles a
     JOIN documents d ON d.id = a.document_id
     WHERE (${cond})
     LIMIT ?`

  let rows = db.prepare(sql).all(...params, limit + exclude.size) as FtsRow[]
  rows = rows.filter((r) => !exclude.has(r.article_id)).slice(0, limit)
  return rows
}

function fallbackLikePhrase(db: Database, phrase: string, limit: number): FtsRow[] {
  const q = phrase.trim()
  if (q.length < 2) return []
  const like = `%${q.replace(/%/g, '').replace(/_/g, '')}%`
  if (like === '%%') return []

  return db
    .prepare(
      `SELECT a.id AS article_id, a.document_id, d.title AS document_title, a.heading, a.article_number, a.body_clean
       FROM articles a
       JOIN documents d ON d.id = a.document_id
       WHERE a.body_clean LIKE ? COLLATE NOCASE OR a.heading LIKE ? COLLATE NOCASE
       LIMIT ?`
    )
    .all(like, like, limit) as FtsRow[]
}

function rowToChunk(r: FtsRow): RetrievalChunk {
  return {
    articleId: r.article_id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    heading: r.heading,
    articleNumber: r.article_number,
    body: r.body_clean.slice(0, 12000)
  }
}

/** Полнотекстовый и резервный поиск по статьям для оверлея, базы и ИИ. */
export function retrieveChunksForQuery(db: Database, query: string, limit = 8): RetrievalChunk[] {
  const raw = query.trim().replace(/\s+/g, ' ')
  if (!raw) return []

  const tokens = extractSearchTokens(raw)
  const seen = new Set<string>()
  const chunks: RetrievalChunk[] = []

  const pushRows = (rows: FtsRow[]): void => {
    for (const r of rows) {
      if (seen.has(r.article_id)) continue
      seen.add(r.article_id)
      chunks.push(rowToChunk(r))
      if (chunks.length >= limit) break
    }
  }

  if (tokens.length > 0) {
    const variants = ftsMatchVariants(tokens)
    for (const m of variants) {
      if (chunks.length >= limit) break
      const rows = runFts(db, m, limit)
      pushRows(rows)
    }

    if (chunks.length < limit) {
      const more = fallbackLikeMulti(db, tokens, limit - chunks.length, seen)
      pushRows(more)
    }
  }

  if (chunks.length < limit && raw.length >= 2) {
    const more = fallbackLikePhrase(db, raw, limit - chunks.length + seen.size).filter((r) => !seen.has(r.article_id))
    pushRows(more.slice(0, limit - chunks.length))
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
