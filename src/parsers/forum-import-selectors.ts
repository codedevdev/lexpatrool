/**
 * XenForo / похожие темы: общие селекторы для авто-импорта и подсветки во встроенном браузере.
 */

export const XENFORO_POST_SELECTORS: readonly string[] = [
  '.block-body [data-content^="post-"]',
  'article.message--post',
  'article.message--article',
  '.message.message--post',
  '.message--post.js-post',
  '[data-content="post-1"]',
  '#js-post-1',
  '#thread-view .message:first-of-type',
  '.block-body .message:first-of-type',
  '.message-list .message:first-of-type',
  '.block-body > .block-row:first-of-type .message',
  'article.message:first-of-type'
]

/** Тело сообщения: сначала широкие контейнеры, потом .bbWrapper. */
export function pickMessageBody(root: Element): Element | null {
  return (
    root.querySelector('.message-body.js-selectToQuote') ??
    root.querySelector('.message-body') ??
    root.querySelector('.js-postBody') ??
    root.querySelector('.message-content') ??
    root.querySelector('.message-body .bbWrapper') ??
    root.querySelector('.js-postBody .bbWrapper') ??
    root.querySelector('.message-content .bbWrapper') ??
    root.querySelector('.bbWrapper') ??
    null
  )
}

export function getThreadRoot(doc: Document): Element {
  return (
    doc.querySelector('#thread-view') ??
    doc.querySelector('.p-body-main') ??
    doc.querySelector('[data-template="thread_view"]') ??
    doc.body
  )
}

/** Все сообщения темы (порядок — как в DOM), не только первое. */
export const XENFORO_THREAD_POST_LIST_SELECTORS: readonly string[] = [
  'article.message--post',
  'article.message--article',
  '.message-list .message.message--post',
  '.block-body .message.message--post'
]

/** Битовые маски DOM — в Node/Electron нет глобального `Node`, только в браузере. */
const DOCUMENT_POSITION_PRECEDING = 0x2
const DOCUMENT_POSITION_FOLLOWING = 0x4

function sortElementsDocumentOrder(a: Element, b: Element): number {
  const pos = a.compareDocumentPosition(b)
  if (pos & DOCUMENT_POSITION_FOLLOWING) return -1
  if (pos & DOCUMENT_POSITION_PRECEDING) return 1
  return 0
}

/**
 * Тела сообщений всех постов темы (XenForo / похожая вёрстка), по порядку сверху вниз.
 */
export function findAllForumMessageBodies(doc: Document): Element[] {
  const threadRoot = getThreadRoot(doc)
  let postRoots: Element[] = []

  for (const sel of XENFORO_THREAD_POST_LIST_SELECTORS) {
    try {
      const n = threadRoot.querySelectorAll(sel)
      if (n.length) {
        postRoots = Array.from(n) as Element[]
        break
      }
    } catch {
      /* invalid selector */
    }
  }

  if (!postRoots.length) {
    const seen = new Set<Element>()
    const markers = threadRoot.querySelectorAll('[data-content^="post-"]')
    markers.forEach((el) => {
      const root =
        el.closest('article.message--post, article.message--article') ??
        el.closest('.message.message--post') ??
        null
      const node = (root ?? el) as Element
      if (node.nodeType === 1 && !seen.has(node)) {
        seen.add(node)
        postRoots.push(node)
      }
    })
  }

  postRoots.sort(sortElementsDocumentOrder)

  const bodies: Element[] = []
  const seenBodies = new Set<Element>()
  for (const post of postRoots) {
    const bb = pickMessageBody(post)
    if (!bb || seenBodies.has(bb)) continue
    const innerHtml = bb.innerHTML?.trim() ?? ''
    const plainLen = (bb.textContent ?? '').replace(/\s+/g, ' ').trim().length
    if (innerHtml.length < 15 || plainLen < 10) continue
    seenBodies.add(bb)
    bodies.push(bb)
  }
  return bodies
}

/**
 * Узел, из которого берётся текст для импорта (тот же выбор, что и в readability-import).
 */
export function findForumImportRoot(doc: Document): Element | null {
  let post: Element | null = null
  for (const sel of XENFORO_POST_SELECTORS) {
    try {
      post = doc.querySelector(sel)
    } catch {
      post = null
    }
    if (post) break
  }

  const threadRoot = getThreadRoot(doc)

  if (post) {
    const bb = pickMessageBody(post)
    const innerHtml = bb?.innerHTML?.trim() ?? ''
    if (innerHtml.length >= 80) {
      const plainLen = (bb?.textContent ?? '').replace(/\s+/g, ' ').trim().length
      if (plainLen >= 80) return bb
    }
  }

  const wrappers = threadRoot.querySelectorAll('.bbWrapper')
  let best: Element | null = null
  let bestPlain = 0
  wrappers.forEach((el) => {
    const n = (el.textContent ?? '').replace(/\s+/g, ' ').length
    if (n > bestPlain) {
      bestPlain = n
      best = el
    }
  })

  if (best && bestPlain >= 400) {
    return best
  }

  return null
}
