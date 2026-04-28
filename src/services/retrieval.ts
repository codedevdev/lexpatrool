import type { Database } from 'better-sqlite3'

export interface RetrievalChunk {
  articleId: string
  documentId: string
  documentTitle: string
  heading: string
  articleNumber: string | null
  body: string
}

/** Keyword retrieval for RAG-style prompts when embeddings are unavailable. */
export function retrieveChunksForQuery(db: Database, query: string, limit = 8): RetrievalChunk[] {
  const q = query.trim()
  if (!q) return []

  const ftsQuery = q
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w.replace(/"/g, '')}"`)
    .join(' AND ')

  let fts: {
    article_id: string
    document_id: string
    document_title: string
    heading: string
    article_number: string | null
    body_clean: string
  }[] = []

  try {
    fts = db
      .prepare(
        `SELECT a.id AS article_id, a.document_id, d.title AS document_title, a.heading, a.article_number, a.body_clean
         FROM articles_fts
         JOIN articles a ON a.id = articles_fts.article_id
         JOIN documents d ON d.id = a.document_id
         WHERE articles_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(ftsQuery || q, limit) as typeof fts
  } catch {
    fts = []
  }

  if (fts.length) {
    return fts.map((r) => ({
      articleId: r.article_id,
      documentId: r.document_id,
      documentTitle: r.document_title,
      heading: r.heading,
      articleNumber: r.article_number,
      body: r.body_clean.slice(0, 4000)
    }))
  }

  const like = `%${q.replace(/%/g, '')}%`
  const fallback = db
    .prepare(
      `SELECT a.id AS article_id, a.document_id, d.title AS document_title, a.heading, a.article_number, a.body_clean
       FROM articles a
       JOIN documents d ON d.id = a.document_id
       WHERE a.body_clean LIKE ? OR a.heading LIKE ?
       LIMIT ?`
    )
    .all(like, like, limit) as {
      article_id: string
      document_id: string
      document_title: string
      heading: string
      article_number: string | null
      body_clean: string
    }[]

  return fallback.map((r) => ({
    articleId: r.article_id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    heading: r.heading,
    articleNumber: r.article_number,
    body: r.body_clean.slice(0, 4000)
  }))
}
