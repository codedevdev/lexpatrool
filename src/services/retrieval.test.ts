import { v4 as uuid } from 'uuid'
import { describe, expect, it } from 'vitest'
import { createTestDatabase } from '../test-utils/memory-db'
import {
  loadArticleRowsByIds,
  retrieveChunksForQuery,
  retrieveKeywordCandidates,
  rowToShortSnippet,
  snippetForArticleBody
} from './retrieval'

function insertDocWithArticle(
  db: ReturnType<typeof createTestDatabase>,
  title: string,
  heading: string,
  body: string,
  articleNumber: string | null
): { docId: string; articleId: string } {
  const now = new Date().toISOString()
  const catId = uuid()
  db.prepare(`INSERT INTO categories (id, name, parent_id, color, sort_order) VALUES (?, ?, NULL, ?, 0)`).run(
    catId,
    'T',
    '#000'
  )
  const sourceId = uuid()
  db.prepare(
    `INSERT INTO sources (id, title, url, source_type, imported_at, tags_json, category_id, code_family, metadata_json)
     VALUES (?, ?, NULL, 'paste_text', ?, '[]', ?, 'internal_rules', '{}')`
  ).run(sourceId, 'S', now, catId)
  const docId = uuid()
  db.prepare(
    `INSERT INTO documents (id, source_id, title, slug, created_at, updated_at, category_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(docId, sourceId, title, slugify(title), now, now, catId)
  const articleId = uuid()
  db.prepare(
    `INSERT INTO articles (id, document_id, article_number, heading, level, sort_order, body_clean, path_json)
     VALUES (?, ?, ?, ?, 1, 1, ?, '[]')`
  ).run(articleId, docId, articleNumber, heading, body)
  return { docId, articleId }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-').slice(0, 48)
}

describe('retrieveChunksForQuery', () => {
  it('возвращает пустой массив для пустого запроса', () => {
    const db = createTestDatabase()
    try {
      expect(retrieveChunksForQuery(db, '   ', 5)).toEqual([])
    } finally {
      db.close()
    }
  })

  it('находит статью по уникальному слову в теле', () => {
    const db = createTestDatabase()
    try {
      const w = 'уникальное_слово_fts_тест'
      insertDocWithArticle(db, 'Doc A', 'Статья 1', `Текст про ${w} и ещё`, '1')
      const rows = retrieveChunksForQuery(db, w, 5)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0]!.body.toLowerCase()).toContain(w.toLowerCase())
    } finally {
      db.close()
    }
  })

  it('ограничивает выдачу только статьями с выбранными тегами', () => {
    const db = createTestDatabase()
    try {
      const w = 'тегфильтр_xyz'
      const a = insertDocWithArticle(db, 'D1', 'H1', w, null)
      const b = insertDocWithArticle(db, 'D2', 'H2', w, null)
      const tagId = uuid()
      db.prepare(`INSERT INTO tags (id, name) VALUES (?, ?)`).run(tagId, 'police')
      db.prepare(`INSERT INTO article_tag_assignments (article_id, tag_id) VALUES (?, ?)`).run(a.articleId, tagId)

      const withTag = retrieveChunksForQuery(db, w, 8, { tagIds: [tagId] })
      const ids = new Set(withTag.map((c) => c.articleId))
      expect(ids.has(a.articleId)).toBe(true)
      expect(ids.has(b.articleId)).toBe(false)
    } finally {
      db.close()
    }
  })
})

describe('retrieveKeywordCandidates', () => {
  it('возвращает пустой список для пустого запроса', () => {
    const db = createTestDatabase()
    try {
      expect(retrieveKeywordCandidates(db, '')).toEqual([])
    } finally {
      db.close()
    }
  })

  it('помечает источник fts для текстового совпадения', () => {
    const db = createTestDatabase()
    try {
      const w = 'кандидат_fts_abc'
      insertDocWithArticle(db, 'Кодекс X', 'Ст. 10', `Описание ${w}`, '10')
      const c = retrieveKeywordCandidates(db, w, { limit: 10 })
      expect(c.some((x) => x.source === 'fts' || x.source === 'like')).toBe(true)
    } finally {
      db.close()
    }
  })

  it('поднимает article-num кандидатов по номеру из запроса', () => {
    const db = createTestDatabase()
    try {
      insertDocWithArticle(db, 'УК', 'Статья 8.1. Кража', 'Описание состава преступления', '8.1')
      const c = retrieveKeywordCandidates(db, 'статья 8.1 кража', { limit: 12 })
      expect(c.some((x) => x.source === 'article-num')).toBe(true)
    } finally {
      db.close()
    }
  })
})

describe('loadArticleRowsByIds', () => {
  it('возвращает карту по id статей', () => {
    const db = createTestDatabase()
    try {
      const { articleId } = insertDocWithArticle(db, 'D', 'H', 'тело', '5')
      const m = loadArticleRowsByIds(db, [articleId])
      expect(m.get(articleId)?.heading).toBe('H')
    } finally {
      db.close()
    }
  })
})

describe('snippetForArticleBody', () => {
  it('строит сниппет по токенам запроса', () => {
    const body = 'очень длинный текст про кражу имущества'
    expect(snippetForArticleBody(body, 'кражу')).toContain('кражу')
  })
})

describe('rowToShortSnippet', () => {
  it('делегирует в snippetForArticleBody', () => {
    const row = {
      article_id: 'a',
      document_id: 'd',
      document_title: 'T',
      heading: 'H',
      article_number: '1',
      body_clean: 'текст про санкции',
      summary_short: null,
      penalty_hint: null,
      display_meta_json: null,
      parent_article_id: null
    }
    expect(rowToShortSnippet(row, 'санкции')).toContain('санкции')
  })
})
