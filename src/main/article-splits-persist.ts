import { v4 as uuid } from 'uuid'
import type { Database } from 'better-sqlite3'
import type { SplitArticle } from '../parsers/article-split'
import { isPartHeading } from '../parsers/article-split'
import { filterArticleSplits, type ArticleImportFilter } from '../parsers/article-import-filter'
import { attachArticleToStack, type ArticleStackEntry } from '../parsers/article-hierarchy'
import { stripRedundantLeadingNumber } from '../shared/article-display'
import { enrichArticle, metaToJson } from '../parsers/article-enrichment'
import { logParse } from '../parsers/parse-trace'

export function insertArticlesFromSplits(
  db: Database,
  docId: string,
  splits: SplitArticle[],
  rawText: string,
  articleFilter: ArticleImportFilter | undefined
): void {
  const filterMode = articleFilter ?? 'all'
  const filtered = filterArticleSplits(splits, filterMode)
  if (filterMode === 'with_sanctions' && filtered.length === 0 && splits.length > 0) {
    logParse('insertArticlesFromSplits: with_sanctions — ни один блок не содержит маркеров санкций', {
      blocks: splits.length
    })
  } else if (filtered.length !== splits.length) {
    logParse('insertArticlesFromSplits: фильтр articleFilter', {
      filterMode,
      before: splits.length,
      after: filtered.length
    })
  }
  const stack: ArticleStackEntry[] = []

  for (let i = 0; i < filtered.length; i++) {
    const s = filtered[i]!
    const heading = stripRedundantLeadingNumber(s.articleNumber, s.heading)
    const isPart = isPartHeading(heading)
    const num = s.articleNumber?.trim() ?? ''

    let parentId: string | null = null
    let level = 1

    if (isPart) {
      const top = stack[stack.length - 1]
      parentId = top?.id ?? null
      level = top ? stack.length + 1 : 1
    } else if (num) {
      const r = attachArticleToStack(stack, num)
      parentId = r.parentId
      level = r.level
    } else {
      stack.length = 0
    }

    const aid = uuid()

    if (!isPart && num) {
      stack.push({ id: aid, articleNumber: num })
    }

    const e = enrichArticle(heading, s.body, {
      referenceImport: filterMode === 'without_sanctions'
    })
    db.prepare(
      `INSERT INTO articles (id, document_id, article_number, heading, level, sort_order, body_clean, body_raw, path_json, summary_short, penalty_hint, display_meta_json, parent_article_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      aid,
      docId,
      s.articleNumber,
      heading,
      level,
      i + 1,
      s.body,
      rawText,
      JSON.stringify([heading]),
      e.summaryShort,
      e.penaltyHint,
      metaToJson(e.meta),
      parentId
    )
  }
}

function normHeading(h: string): string {
  return h.trim().replace(/\s+/g, ' ')
}

export function replaceDocumentArticlesFromSplits(
  db: Database,
  docId: string,
  splits: SplitArticle[],
  rawText: string,
  articleFilter: ArticleImportFilter | undefined
): { inserted: number; updated: number; deleted: number; previousMarked: number } {
  const filterMode = articleFilter ?? 'all'
  const filtered = filterArticleSplits(splits, filterMode)

  type OldRow = {
    id: string
    article_number: string | null
    heading: string
    body_clean: string
    sort_order: number
  }
  const olds = db
    .prepare(
      `SELECT id, article_number, heading, body_clean, sort_order FROM articles WHERE document_id = ? ORDER BY sort_order ASC`
    )
    .all(docId) as OldRow[]

  const used = new Set<string>()
  const byNumber = new Map<string, OldRow[]>()
  for (const o of olds) {
    const k = (o.article_number ?? '').trim()
    if (!k) continue
    const arr = byNumber.get(k) ?? []
    arr.push(o)
    byNumber.set(k, arr)
  }

  let inserted = 0
  let updated = 0
  let previousMarked = 0

  const stack: ArticleStackEntry[] = []

  const takeByNumber = (n: string): OldRow | undefined => {
    const k = n.trim()
    if (!k) return undefined
    const arr = byNumber.get(k)
    if (!arr?.length) return undefined
    const o = arr.shift()!
    if (arr.length) byNumber.set(k, arr)
    else byNumber.delete(k)
    return o
  }

  for (let i = 0; i < filtered.length; i++) {
    const s = filtered[i]!
    const heading = stripRedundantLeadingNumber(s.articleNumber, s.heading)
    const isPart = isPartHeading(heading)
    const num = s.articleNumber?.trim() ?? ''

    let parentId: string | null = null
    let level = 1

    if (isPart) {
      const top = stack[stack.length - 1]
      parentId = top?.id ?? null
      level = top ? stack.length + 1 : 1
    } else if (num) {
      const r = attachArticleToStack(stack, num)
      parentId = r.parentId
      level = r.level
    } else {
      stack.length = 0
    }

    let oldRow: OldRow | undefined
    if (num) {
      oldRow = takeByNumber(num)
    }
    if (!oldRow) {
      oldRow = olds.find((o) => !used.has(o.id) && normHeading(o.heading) === normHeading(heading))
    }

    const targetId = oldRow ? oldRow.id : uuid()
    if (oldRow) used.add(oldRow.id)

    const e = enrichArticle(heading, s.body, {
      referenceImport: filterMode === 'without_sanctions'
    })

    if (oldRow) {
      const bodyChanged = oldRow.body_clean !== s.body
      if (bodyChanged) previousMarked++
      const prevBody = bodyChanged ? oldRow.body_clean : null
      const prevAt = bodyChanged ? new Date().toISOString() : null

      if (bodyChanged) {
        db.prepare(
          `UPDATE articles SET
            article_number = ?, heading = ?, level = ?, sort_order = ?, body_clean = ?, body_raw = ?,
            path_json = ?, summary_short = ?, penalty_hint = ?, display_meta_json = ?, parent_article_id = ?,
            previous_body_clean = ?, previous_captured_at = ?
           WHERE id = ?`
        ).run(
          s.articleNumber,
          heading,
          level,
          i + 1,
          s.body,
          rawText,
          JSON.stringify([heading]),
          e.summaryShort,
          e.penaltyHint,
          metaToJson(e.meta),
          parentId,
          prevBody,
          prevAt,
          targetId
        )
      } else {
        db.prepare(
          `UPDATE articles SET
            article_number = ?, heading = ?, level = ?, sort_order = ?, body_clean = ?, body_raw = ?,
            path_json = ?, summary_short = ?, penalty_hint = ?, display_meta_json = ?, parent_article_id = ?
           WHERE id = ?`
        ).run(
          s.articleNumber,
          heading,
          level,
          i + 1,
          s.body,
          rawText,
          JSON.stringify([heading]),
          e.summaryShort,
          e.penaltyHint,
          metaToJson(e.meta),
          parentId,
          targetId
        )
      }
      updated++
    } else {
      db.prepare(
        `INSERT INTO articles (id, document_id, article_number, heading, level, sort_order, body_clean, body_raw, path_json, summary_short, penalty_hint, display_meta_json, parent_article_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        targetId,
        docId,
        s.articleNumber,
        heading,
        level,
        i + 1,
        s.body,
        rawText,
        JSON.stringify([heading]),
        e.summaryShort,
        e.penaltyHint,
        metaToJson(e.meta),
        parentId
      )
      inserted++
    }

    if (!isPart && num) {
      stack.push({ id: targetId, articleNumber: num })
    }
  }

  let deleted = 0
  for (const o of olds) {
    if (!used.has(o.id)) {
      db.prepare(`DELETE FROM articles WHERE id = ?`).run(o.id)
      deleted++
    }
  }

  return { inserted, updated, deleted, previousMarked }
}
