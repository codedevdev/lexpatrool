/**
 * Выбор стратегии разбиения импортированного текста: таблица (|) или эвристика по строкам.
 */

import { reorderHierarchyArticleBlocks, splitIntoArticles, type SplitArticle } from './article-split'
import { tryParseTableRows } from './article-enrichment'
import { logParse, logParseDump, parseTraceVerbose, previewLines, shouldLogParsePipeline } from './parse-trace'

export function resolveArticleSplits(
  rawText: string,
  title: string,
  splitArticles: boolean
): SplitArticle[] {
  logParse('resolveArticleSplits: старт', {
    documentTitle: title.slice(0, 120),
    rawLength: rawText.length,
    splitArticles: splitArticles !== false
  })
  if (parseTraceVerbose()) {
    logParseDump('resolveArticleSplits: сырой текст для разбора', rawText, 8000)
    logParse('resolveArticleSplits: первые непустые строки', { lines: previewLines(rawText, 35, 200) })
  }

  const table = tryParseTableRows(rawText)
  if (shouldLogParsePipeline()) {
    logParse('resolveArticleSplits: стратегия', {
      режим: table ? 'ТАБЛИЦА (строки с |)' : 'эвристика splitIntoArticles',
      препроцесс:
        'forum plain text: preprocessForumCodecPlainText внутри табличного/строчного разборщика; LEX_PARSE_DIAG=1 — шаги в консоли'
    })
  }
  if (table) {
    const ordered = reorderHierarchyArticleBlocks(table)
    logParse('resolveArticleSplits: итог — режим ТАБЛИЦА (только строки с |)', {
      blocks: ordered.length,
      firstHeadings: ordered.slice(0, 10).map((s) => s.heading.slice(0, 100))
    })
    return ordered
  }

  logParse('resolveArticleSplits: таблица не выбрана → splitIntoArticles (эвристика по строкам)')
  const rawSplits =
    splitArticles !== false ?
      splitIntoArticles(rawText)
    : [{ articleNumber: null, heading: title, body: rawText }]
  const out = reorderHierarchyArticleBlocks(rawSplits)
  logParse('resolveArticleSplits: итог — эвристика', {
    blocks: out.length,
    firstHeadings: out.slice(0, 12).map((s) => s.heading.slice(0, 100)),
    articleNumbers: out.slice(0, 12).map((s) => s.articleNumber)
  })
  return out
}
