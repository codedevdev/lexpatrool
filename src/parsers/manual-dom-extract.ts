/**
 * Извлечение статей из HTML по пользовательским CSS / XPath (JSDOM, как в Chromium).
 */

import { JSDOM } from 'jsdom'
import type { DomSelector, ManualDomParseRulesV1 } from '../shared/types'
import type { SplitArticle } from './article-split'
import { elementPlainTextPreservingBreaks } from './html-element-plain-text'

/** Одна строка подписи, номера колонки и т.п. — схлопываем пробелы. */
function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function queryOne(sel: DomSelector, context: Document | Element): Element | null {
  if (sel.kind === 'css') {
    return context.querySelector(sel.expr)
  }
  const doc = context instanceof Document ? context : context.ownerDocument!
  const win = doc.defaultView!
  const r = doc.evaluate(sel.expr, context, null, win.XPathResult.FIRST_ORDERED_NODE_TYPE, null)
  const n = r.singleNodeValue
  if (n && n.nodeType === 1) return n as Element
  return null
}

function queryAll(sel: DomSelector, context: Document | Element): Element[] {
  if (sel.kind === 'css') {
    return Array.from(context.querySelectorAll(sel.expr))
  }
  const doc = context instanceof Document ? context : context.ownerDocument!
  const win = doc.defaultView!
  const r = doc.evaluate(sel.expr, context, null, win.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
  const out: Element[] = []
  for (let i = 0; i < r.snapshotLength; i++) {
    const n = r.snapshotItem(i)
    if (n && n.nodeType === 1) out.push(n as Element)
  }
  return out
}

export function extractManualDom(html: string, rules: ManualDomParseRulesV1): SplitArticle[] {
  const dom = new JSDOM(html, { contentType: 'text/html' })
  const document = dom.window.document

  if (rules.version !== 1) {
    throw new Error('Неподдерживаемая версия правил')
  }

  if (rules.strategy === 'single') {
    const root = queryOne(rules.containerSelector, document)
    if (!root) {
      throw new Error('Контейнер не найден — проверьте селектор (single)')
    }
    const bodyRoot = rules.body ? queryOne(rules.body, root) : root
    const body = bodyRoot ? elementPlainTextPreservingBreaks(bodyRoot) : ''
    if (!body) {
      throw new Error('Пустой текст в выбранном контейнере')
    }
    return [
      {
        articleNumber: null,
        heading: 'Импорт (single)',
        body
      }
    ]
  }

  let rows = queryAll(rules.rowSelector, document)
  if (!rows.length) {
    throw new Error('Не найдено ни одной строки — проверьте селектор строк (rows)')
  }
  const cap = rules.maxRows
  if (typeof cap === 'number' && cap > 0 && rows.length > cap) {
    rows = rows.slice(0, cap)
  }

  const out: SplitArticle[] = []
  rows.forEach((row, i) => {
    const numStr = rules.articleNumber
      ? normalizeText(queryOne(rules.articleNumber, row)?.textContent ?? '')
      : ''
    const headingText = rules.heading ? normalizeText(queryOne(rules.heading, row)?.textContent ?? '') : ''

    let body = ''
    if (rules.body) {
      const br = queryOne(rules.body, row)
      body = br ? elementPlainTextPreservingBreaks(br) : ''
    } else {
      body = elementPlainTextPreservingBreaks(row)
    }

    if (!body && !headingText && !numStr) return

    const heading =
      headingText || (numStr ? `Статья ${numStr}` : `Фрагмент ${i + 1}`)

    const bodyFinal = body || headingText || numStr || ''

    out.push({
      articleNumber: numStr ? numStr : null,
      heading,
      body: bodyFinal
    })
  })

  if (!out.length) {
    throw new Error('Все строки оказались пустыми — уточните селекторы колонок')
  }

  return out
}
