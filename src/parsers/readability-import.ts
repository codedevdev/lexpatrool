import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'
import { findAllForumMessageBodies, findForumImportRoot } from './forum-import-selectors'
import { elementPlainTextPreservingBreaks } from './html-element-plain-text'
import { logParse } from './parse-trace'

export type ForumExtractScope = 'first' | 'all'

export interface ReadabilityResult {
  title: string
  text: string
  html: string
  excerpt: string | null
  /** Откуда взят основной текст (для отладки импорта с форумов). */
  textSource?: 'readability' | 'forum_first_post' | 'forum_all_posts'
}

function bbHtmlToText(innerHtml: string): string {
  const turndown = new TurndownService({ headingStyle: 'atx' })
  const innerDom = new JSDOM(`<div>${innerHtml}</div>`)
  const md = turndown.turndown(innerDom.window.document.body?.innerHTML ?? innerHtml).trim()
  const plain = innerDom.window.document.body?.textContent?.replace(/\u00a0/g, ' ').trim() ?? ''
  return md.length >= plain.length * 0.5 ? md : plain
}

/**
 * Текст поста(ов) XenForo с переводами строк (как в ручном DOM), для эвристик статей.
 * `all` — все сообщения темы подряд, разделитель `---` между постами.
 */
function tryExtractXenForoForumText(html: string, scope: ForumExtractScope): string | null {
  const dom = new JSDOM(html)
  const doc = dom.window.document

  if (scope === 'all') {
    const bodies = findAllForumMessageBodies(doc)
    if (bodies.length > 0) {
      const parts = bodies
        .map((b) => elementPlainTextPreservingBreaks(b))
        .filter((t) => t.trim().length > 0)
      const text = parts.join('\n\n---\n\n')
      if (text.length >= 80) {
        logParse('readability-import: XenForo — склеены посты темы (plain + переносы)', {
          posts: parts.length,
          textLen: text.length
        })
        return text
      }
      logParse('readability-import: XenForo all — слишком короткий текст после склейки', {
        posts: parts.length,
        len: text.length
      })
      return null
    }
    logParse('readability-import: XenForo all — не найдены посты темы', {})
    return null
  }

  const root = findForumImportRoot(doc)
  if (!root) {
    logParse('readability-import: XenForo — не удалось найти корень импорта', {})
    return null
  }

  const text = elementPlainTextPreservingBreaks(root)
  if (text.length < 80) {
    logParse('readability-import: XenForo — слишком короткий текст после разбора', {
      len: text.length
    })
    return null
  }

  logParse('readability-import: XenForo — извлечён блок первого поста (plain + переносы)', {
    textLen: text.length
  })
  return text
}

/**
 * Достаточно: форумный фрагмент не короче Readability; при равенстве оставляем Readability.
 */
function shouldPreferForumText(readabilityLen: number, forumLen: number): boolean {
  return forumLen > readabilityLen
}

export interface ParseHtmlWithReadabilityOptions {
  /** По умолчанию только первый пост темы; `all` — все сообщения подряд. */
  forumScope?: ForumExtractScope
}

/** Extract main content from HTML (forum/page) for user-reviewed import — no network calls. */
export function parseHtmlWithReadability(
  html: string,
  url?: string,
  options?: ParseHtmlWithReadabilityOptions
): ReadabilityResult {
  const forumScope: ForumExtractScope = options?.forumScope ?? 'first'
  const dom = new JSDOM(html, { url: url || 'https://local.invalid/' })
  const reader = new Readability(dom.window.document)
  const article = reader.parse()
  const turndown = new TurndownService({ headingStyle: 'atx' })

  if (!article) {
    const text = dom.window.document.body?.textContent?.trim() ?? ''
    const forum = tryExtractXenForoForumText(html, forumScope)
    const chosen = forum && shouldPreferForumText(text.length, forum.length) ? forum : text
    if (forum && chosen === forum) {
      logParse('readability-import: без Readability.parse — взят текст форума (XenForo)', {
        forumLen: forum.length,
        fallbackLen: text.length,
        forumScope
      })
    }
    const src: ReadabilityResult['textSource'] =
      chosen === forum ? (forumScope === 'all' ? 'forum_all_posts' : 'forum_first_post') : 'readability'
    return {
      title: dom.window.document.title || 'Импорт',
      text: chosen,
      html: html,
      excerpt: null,
      textSource: src
    }
  }

  const innerHtml = article.content || ''
  const innerDom = new JSDOM(innerHtml)
  const md = turndown.turndown(innerDom.window.document.body?.innerHTML ?? innerHtml)

  const baseText = (article.textContent?.trim() || md).trim()
  const forumText = tryExtractXenForoForumText(html, forumScope)

  let text = baseText
  let textSource: ReadabilityResult['textSource'] = 'readability'
  let outHtml = innerHtml

  if (forumText && shouldPreferForumText(baseText.length, forumText.length)) {
    text = forumText
    textSource = forumScope === 'all' ? 'forum_all_posts' : 'forum_first_post'
    outHtml =
      forumScope === 'all'
        ? `<div class="lex-forum-all-posts">${forumText}</div>`
        : `<div class="lex-forum-first-post">${forumText}</div>`
    logParse('readability-import: выбран текст XenForo вместо Readability', {
      readabilityLen: baseText.length,
      forumLen: forumText.length,
      forumScope
    })
  }

  return {
    title: article.title || 'Без названия',
    text,
    html: outHtml,
    excerpt: article.excerpt ?? null,
    textSource
  }
}
