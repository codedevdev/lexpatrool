/**
 * Выбор стратегии разбиения импортированного текста: таблица (|) или эвристика по строкам.
 */

import { splitIntoArticles, type SplitArticle } from './article-split'
import { tryParseTableRows } from './article-enrichment'
import { logParse, logParseDump, parseTraceVerbose, previewLines } from './parse-trace'

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
  if (table) {
    logParse('resolveArticleSplits: итог — режим ТАБЛИЦА (только строки с |)', {
      blocks: table.length,
      firstHeadings: table.slice(0, 10).map((s) => s.heading.slice(0, 100))
    })
    return table
  }

  logParse('resolveArticleSplits: таблица не выбрана → splitIntoArticles (эвристика по строкам)')
  const out =
    splitArticles !== false ?
      splitIntoArticles(rawText)
    : [{ articleNumber: null, heading: title, body: rawText }]
  logParse('resolveArticleSplits: итог — эвристика', {
    blocks: out.length,
    firstHeadings: out.slice(0, 12).map((s) => s.heading.slice(0, 100)),
    articleNumbers: out.slice(0, 12).map((s) => s.articleNumber)
  })
  return out
}
