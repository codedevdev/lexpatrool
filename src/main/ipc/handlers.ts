import { ipcMain, dialog, globalShortcut } from 'electron'
import { setMainWindowAlwaysOnTop } from '../window-always-on-top'
import type { BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import type { Database } from 'better-sqlite3'

type AiAgentRow = {
  id: string
  system_prompt_extra: string
  temperature: number | null
  max_tokens: number | null
  model: string | null
  provider: string | null
  base_url: string | null
  api_key: string | null
}

function mergeAgentConfig(
  db: Database,
  base: AiProviderConfig,
  agentId?: string | null
): { cfg: AiProviderConfig; extra: string } {
  if (!agentId) return { cfg: base, extra: '' }
  const row = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(agentId) as AiAgentRow | undefined
  if (!row) return { cfg: base, extra: '' }
  const cfg: AiProviderConfig = { ...base }
  if (row.model?.trim()) cfg.model = row.model
  if (row.temperature != null && !Number.isNaN(row.temperature)) cfg.temperature = row.temperature
  if (row.max_tokens != null && row.max_tokens > 0) cfg.maxTokens = row.max_tokens
  const p = row.provider?.trim()
  if (p && ['openai', 'anthropic', 'gemini', 'ollama', 'openai_compatible'].includes(p)) {
    cfg.provider = p as AiProviderConfig['provider']
  }
  if (row.base_url?.trim()) cfg.baseUrl = row.base_url
  if (row.api_key?.trim()) cfg.apiKey = row.api_key
  return { cfg, extra: row.system_prompt_extra ?? '' }
}
import { v4 as uuid } from 'uuid'
import type {
  ImportPayload,
  AiProviderConfig,
  AiCompletePayload,
  AiAgentRecord,
  BrowserImportPayload,
  ManualDomParseRulesV1,
  ArticleUpdatePayload
} from '../../shared/types'
import { extractManualDom } from '../../parsers/manual-dom-extract'
import { parseHtmlWithReadability } from '../../parsers/readability-import'
import { filterArticleSplits, type ArticleImportFilter } from '../../parsers/article-import-filter'
import { resolveArticleSplits } from '../../parsers/resolve-article-splits'
import { attachArticleToStack, type ArticleStackEntry } from '../../parsers/article-hierarchy'
import { splitIntoArticles, isPartHeading, type SplitArticle } from '../../parsers/article-split'
import { stripRedundantLeadingNumber } from '../../shared/article-display'
import { enrichArticle, metaToJson } from '../../parsers/article-enrichment'
import { logParse, logParseDump, parseTraceVerbose } from '../../parsers/parse-trace'
import { retrieveChunksForQuery } from '../../services/retrieval'
import {
  buildSystemPrompt,
  completeChat,
  parseCitationsFromAnswer,
  type AiMessage
} from '../../services/ai-gateway'
import type { OverlayController } from '../overlay-window'
import {
  applyOverlayGlobalShortcuts,
  DEFAULT_HOTKEYS,
  humanizeAccelerator,
  readHotkeys,
  saveHotkeys,
  validateAccelerator,
  type HotkeyConfig
} from '../global-shortcuts'
import { seedIfEmpty } from '../seed'

export interface IpcContext {
  getMainWindow: () => BrowserWindow | null
  getDb: () => Database
  overlay: OverlayController
  openExternal: (url: string) => void
}

function nowIso(): string {
  return new Date().toISOString()
}

function insertArticlesFromSplits(
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

    const e = enrichArticle(heading, s.body)
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

export function registerIpcHandlers(ctx: IpcContext): void {
  const { getDb, overlay, getMainWindow } = ctx

  ipcMain.handle('app:get-version', async () => {
    const { app } = await import('electron')
    return app.getVersion()
  })

  ipcMain.handle('db:backup', async () => {
    const win = ctx.getMainWindow()
    const { filePath } = await dialog.showSaveDialog(win ?? undefined, {
      title: 'Сохранить резервную копию',
      defaultPath: 'lexpatrol-backup.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (!filePath) return { ok: false }
    const db = getDb()
    const tables = [
      'categories',
      'sources',
      'documents',
      'sections',
      'articles',
      'clauses',
      'tags',
      'document_tags',
      'bookmarks',
      'notes',
      'retrieval_chunks',
      'ai_conversations',
      'ai_messages',
      'app_settings',
      'overlay_pins',
      'import_jobs',
      'ai_agents'
    ] as const
    const dump: Record<string, unknown[]> = {}
    for (const t of tables) {
      dump[t] = db.prepare(`SELECT * FROM ${t}`).all()
    }
    writeFileSync(filePath, JSON.stringify({ version: 1, exportedAt: nowIso(), data: dump }, null, 2), 'utf-8')
    return { ok: true, path: filePath }
  })

  ipcMain.handle('settings:get', (_e, key: string) => {
    const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  })

  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    getDb()
      .prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value)
    return true
  })

  ipcMain.handle('window:set-always-on-top', (_e, enabled: boolean) => {
    const w = getMainWindow()
    setMainWindowAlwaysOnTop(w, Boolean(enabled))
    getDb()
      .prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run('main_window_always_on_top', enabled ? '1' : '0')
    return true
  })

  ipcMain.handle('overlay:set-always-on-top-level', (_e, level: string) => {
    const ok = ['off', 'floating', 'screen-saver', 'pop-up-menu'].includes(level)
    if (ok) {
      overlay.setAlwaysOnTopLevel(level as 'off' | 'floating' | 'screen-saver' | 'pop-up-menu')
    }
    return ok
  })

  ipcMain.handle('categories:list', () => {
    return getDb().prepare('SELECT * FROM categories ORDER BY sort_order ASC, name ASC').all()
  })

  ipcMain.handle('sources:list', () => {
    return getDb()
      .prepare(
        `SELECT s.*, c.name AS category_name FROM sources s
         LEFT JOIN categories c ON c.id = s.category_id
         ORDER BY s.imported_at DESC`
      )
      .all()
  })

  ipcMain.handle('documents:list', () => {
    return getDb()
      .prepare(
        `SELECT d.*, s.title AS source_title FROM documents d
         LEFT JOIN sources s ON s.id = d.source_id
         ORDER BY d.updated_at DESC`
      )
      .all()
  })

  ipcMain.handle('document:get', (_e, id: string) => {
    const doc = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id)
    const articles = getDb()
      .prepare('SELECT * FROM articles WHERE document_id = ? ORDER BY sort_order ASC')
      .all(id)
    return { document: doc, articles }
  })

  ipcMain.handle('article:get', (_e, id: string) => {
    const row = getDb()
      .prepare(
        `SELECT a.*, d.title AS document_title, d.id AS document_id, s.url AS source_url
         FROM articles a
         JOIN documents d ON d.id = a.document_id
         LEFT JOIN sources s ON s.id = d.source_id
         WHERE a.id = ?`
      )
      .get(id)
    return row
  })

  ipcMain.handle('document:update', (_e, payload: { id: string; title: string }) => {
    const title = payload.title?.trim()
    if (!title) return { ok: false as const, error: 'empty' }
    const r = getDb()
      .prepare(`UPDATE documents SET title = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(title, payload.id)
    return { ok: r.changes > 0 }
  })

  ipcMain.handle('document:delete', (_e, id: string) => {
    const r = getDb().prepare('DELETE FROM documents WHERE id = ?').run(id)
    return { ok: r.changes > 0 }
  })

  ipcMain.handle('article:update', (_e, payload: ArticleUpdatePayload) => {
    const db = getDb()
    const existing = db.prepare('SELECT document_id FROM articles WHERE id = ?').get(payload.id) as
      | { document_id: string }
      | undefined
    if (!existing) return { ok: false as const, error: 'not_found' }

    if (payload.display_meta_json !== undefined) {
      try {
        JSON.parse(payload.display_meta_json)
      } catch {
        return { ok: false as const, error: 'invalid_meta_json' }
      }
    }

    const sets: string[] = []
    const vals: unknown[] = []
    if (payload.heading !== undefined) {
      sets.push('heading = ?')
      vals.push(payload.heading)
    }
    if (payload.article_number !== undefined) {
      sets.push('article_number = ?')
      vals.push(payload.article_number)
    }
    if (payload.body_clean !== undefined) {
      sets.push('body_clean = ?')
      vals.push(payload.body_clean)
    }
    if (payload.summary_short !== undefined) {
      sets.push('summary_short = ?')
      vals.push(payload.summary_short)
    }
    if (payload.penalty_hint !== undefined) {
      sets.push('penalty_hint = ?')
      vals.push(payload.penalty_hint)
    }
    if (payload.display_meta_json !== undefined) {
      sets.push('display_meta_json = ?')
      vals.push(payload.display_meta_json)
    }
    if (sets.length === 0) return { ok: true as const }

    vals.push(payload.id)
    db.prepare(`UPDATE articles SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    db.prepare(`UPDATE documents SET updated_at = datetime('now') WHERE id = ?`).run(existing.document_id)
    return { ok: true as const }
  })

  ipcMain.handle('article:delete', (_e, id: string) => {
    const db = getDb()
    const row = db.prepare('SELECT document_id FROM articles WHERE id = ?').get(id) as { document_id: string } | undefined
    if (!row) return { ok: false as const, error: 'not_found' }
    const r = db.prepare('DELETE FROM articles WHERE id = ?').run(id)
    if (r.changes === 0) return { ok: false as const, error: 'not_found' }
    db.prepare(`UPDATE documents SET updated_at = datetime('now') WHERE id = ?`).run(row.document_id)
    return { ok: true as const }
  })

  ipcMain.handle('search:query', (_e, q: string) => {
    const db = getDb()
    return retrieveChunksForQuery(db, q, 25).map((c, i) => ({
      article_id: c.articleId,
      document_id: c.documentId,
      document_title: c.documentTitle,
      heading: c.heading,
      article_number: c.articleNumber,
      snippet: c.body.slice(0, 280),
      rank: i
    }))
  })

  ipcMain.handle('import:payload', (_e, payload: ImportPayload) => {
    const db = getDb()
    const t = nowIso()

    let rawHtml = payload.rawHtml ?? null
    let rawText = payload.rawText ?? ''
    let title = payload.title?.trim() || 'Импорт'

    if (rawHtml) {
      const r = parseHtmlWithReadability(rawHtml, payload.url)
      title = r.title || title
      rawText = r.text || rawText
    }

    logParse('import:payload: к разбору', {
      usedReadability: Boolean(payload.rawHtml?.trim()),
      rawTextLength: rawText.length,
      title: title.slice(0, 100)
    })
    if (parseTraceVerbose() && rawHtml) {
      logParseDump('import:payload: HTML (вход Readability)', rawHtml, 6000)
    }

    const sourceId = uuid()
    db.prepare(
      `INSERT INTO sources (id, title, url, source_type, imported_at, tags_json, category_id, code_family, metadata_json, raw_html, raw_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sourceId,
      title,
      payload.url ?? null,
      payload.sourceType,
      t,
      JSON.stringify(payload.tags ?? []),
      payload.categoryId ?? null,
      payload.codeFamily ?? null,
      JSON.stringify({ manual: true }),
      rawHtml,
      rawText
    )

    const docId = uuid()
    db.prepare(
      `INSERT INTO documents (id, source_id, title, slug, created_at, updated_at, raw_html, raw_text, category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      docId,
      sourceId,
      title,
      slugify(title),
      t,
      t,
      rawHtml,
      rawText,
      payload.categoryId ?? null
    )

    const splits = resolveArticleSplits(rawText, title, payload.splitArticles !== false)
    insertArticlesFromSplits(db, docId, splits, rawText, payload.articleFilter)

    return { sourceId, documentId: docId }
  })

  ipcMain.handle('overlay:pin-article', (_e, articleId: unknown) => {
    if (typeof articleId !== 'string' || !articleId.trim()) {
      return { ok: false as const, error: 'invalid_id' }
    }
    try {
      const db = getDb()
      const article = db.prepare('SELECT id FROM articles WHERE id = ?').get(articleId) as { id: string } | undefined
      if (!article) {
        console.warn('[LexPatrol] overlay:pin-article: article not in DB', articleId)
        return { ok: false as const, error: 'article_not_found' }
      }
      const exists = db.prepare('SELECT id FROM overlay_pins WHERE article_id = ?').get(articleId) as
        | { id: string }
        | undefined
      if (exists) return { ok: true as const }
      const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM overlay_pins').get() as { m: number }
      db.prepare('INSERT INTO overlay_pins (id, article_id, sort_order) VALUES (?, ?, ?)').run(
        uuid(),
        articleId,
        max.m + 1
      )
      overlay.send('overlay:pins-updated')
      return { ok: true as const }
    } catch (e) {
      console.error('[LexPatrol] overlay:pin-article', e)
      return { ok: false as const, error: 'database_error' }
    }
  })

  ipcMain.handle('overlay:unpin-article', (_e, articleId: unknown) => {
    if (typeof articleId !== 'string' || !articleId.trim()) {
      return { ok: false as const, error: 'invalid_id' }
    }
    try {
      getDb().prepare('DELETE FROM overlay_pins WHERE article_id = ?').run(articleId)
      overlay.send('overlay:pins-updated')
      return { ok: true as const }
    } catch (e) {
      console.error('[LexPatrol] overlay:unpin-article', e)
      return { ok: false as const, error: 'database_error' }
    }
  })

  ipcMain.handle('overlay:get-pinned', () => {
    try {
      return overlay.getPinnedArticles()
    } catch (e) {
      console.error('[LexPatrol] overlay:get-pinned', e)
      return []
    }
  })

  ipcMain.on('overlay:set-click-through', (_e, enabled: boolean) => {
    const on = Boolean(enabled)
    overlay.setClickThrough(on)
    try {
      getDb()
        .prepare(
          `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
        .run('overlay_click_through', on ? '1' : '0')
    } catch {
      /* ignore */
    }
  })

  ipcMain.handle('overlay:get-click-through', () => overlay.getClickThrough())

  ipcMain.handle('overlay:toggle-click-through', () => {
    overlay.toggleClickThrough()
    return overlay.getClickThrough()
  })

  ipcMain.on('overlay:set-opacity', (_e, opacity: number) => {
    if (typeof opacity === 'number') overlay.setOpacity(opacity)
  })

  ipcMain.handle('overlay:show', () => {
    overlay.show()
  })

  ipcMain.handle('overlay:toggle', () => {
    overlay.toggle()
  })

  ipcMain.handle('overlay:raise', () => {
    overlay.bringToFront()
    return true
  })

  /** Открыть статью в главном окне (вызов из оверлея). */
  ipcMain.handle('app:open-reader', (_e, documentId: string, articleId?: string) => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return { ok: false }
    win.show()
    win.focus()
    win.webContents.send('app:reader-navigate', { documentId, articleId })
    return { ok: true }
  })

  ipcMain.handle('ai:complete', async (_e, payload: AiCompletePayload) => {
    const db = getDb()
    const { cfg: baseCfg, question: userQuestion, agentId } = payload
    const { cfg, extra } = mergeAgentConfig(db, baseCfg, agentId)
    const chunks = retrieveChunksForQuery(db, userQuestion, 10)
    const sys = buildSystemPrompt(Boolean(cfg.allowBroaderContext), chunks, extra)
    const messages: AiMessage[] = [
      { role: 'system', content: sys },
      {
        role: 'user',
        content: `${userQuestion}\n\nВ ответе укажи ссылки на статьи в формате id=<uuid> из контекста.`
      }
    ]
    const result = await completeChat(cfg, messages)
    const citations = parseCitationsFromAnswer(
      result.text,
      chunks.map((c) => ({
        articleId: c.articleId,
        documentTitle: c.documentTitle,
        heading: c.heading,
        articleNumber: c.articleNumber
      }))
    )
    return { ...result, citations }
  })

  ipcMain.handle('aiAgents:list', () => {
    return getDb()
      .prepare('SELECT * FROM ai_agents ORDER BY sort_order ASC, name ASC')
      .all() as AiAgentRecord[]
  })

  ipcMain.handle('aiAgents:save', (_e, row: Partial<AiAgentRecord> & { name: string }) => {
    const db = getDb()
    const t = nowIso()
    const id = row.id && row.id.length > 0 ? row.id : uuid()
    const existing = db.prepare('SELECT id FROM ai_agents WHERE id = ?').get(id) as { id: string } | undefined
    const sort =
      row.sort_order ??
      ((db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM ai_agents').get() as { m: number }).m + 1)
    if (existing) {
      db.prepare(
        `UPDATE ai_agents SET name = ?, description = ?, system_prompt_extra = ?, temperature = ?, max_tokens = ?, model = ?, provider = ?, base_url = ?, api_key = ?, sort_order = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        row.name,
        row.description ?? null,
        row.system_prompt_extra ?? '',
        row.temperature ?? null,
        row.max_tokens ?? null,
        row.model ?? null,
        row.provider ?? null,
        row.base_url ?? null,
        row.api_key ?? null,
        sort,
        t,
        id
      )
    } else {
      db.prepare(
        `INSERT INTO ai_agents (id, name, description, system_prompt_extra, temperature, max_tokens, model, provider, base_url, api_key, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        row.name,
        row.description ?? null,
        row.system_prompt_extra ?? '',
        row.temperature ?? null,
        row.max_tokens ?? null,
        row.model ?? null,
        row.provider ?? null,
        row.base_url ?? null,
        row.api_key ?? null,
        sort,
        t,
        t
      )
    }
    return { id }
  })

  ipcMain.handle('aiAgents:delete', (_e, id: string) => {
    getDb().prepare('DELETE FROM ai_agents WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle('overlay:hide', () => {
    overlay.hide()
  })

  ipcMain.handle('overlay:dock', (_e, where: 'left' | 'right' | 'top-right' | 'center') => {
    overlay.dock(where)
  })

  ipcMain.handle('overlay:reorder-pins', (_e, orderedArticleIds: string[]) => {
    const db = getDb()
    const ids = Array.isArray(orderedArticleIds) ? orderedArticleIds : []
    const tx = db.transaction(() => {
      ids.forEach((articleId, i) => {
        db.prepare('UPDATE overlay_pins SET sort_order = ? WHERE article_id = ?').run(i + 1, articleId)
      })
    })
    tx()
    overlay.send('overlay:pins-updated')
    return true
  })

  ipcMain.handle('parse:html', (_e, html: string, url?: string) => {
    return parseHtmlWithReadability(html, url)
  })

  ipcMain.handle(
    'parse:manual-dom',
    (_e, html: string, _url: string | undefined, rules: ManualDomParseRulesV1) => {
      try {
        const articles = extractManualDom(html, rules)
        return { ok: true as const, articles }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false as const, error: message }
      }
    }
  )

  ipcMain.handle('parse:resolve-article-splits', (_e, rawText: string, title: string) => {
    return resolveArticleSplits(rawText, title ?? '', true)
  })

  ipcMain.handle(
    'parse:auto-import-preview',
    (_e, html: string, url: string | undefined, title: string, forumScope?: 'first' | 'all') => {
      const scope = forumScope === 'all' ? 'all' : 'first'
      const r = parseHtmlWithReadability(html, url, { forumScope: scope })
      const docTitle = (title ?? '').trim() || r.title || 'Импорт'
      const splits = resolveArticleSplits(r.text, docTitle, true)
      return {
        title: r.title,
        documentTitle: docTitle,
        textLength: r.text.length,
        textSource: r.textSource ?? 'readability',
        excerpt: r.excerpt,
        splits
      }
    }
  )

  ipcMain.handle('seed:run', () => {
    seedIfEmpty(getDb())
    return true
  })

  ipcMain.handle('browser:import-current', (_e, payload: BrowserImportPayload) => {
    const db = getDb()
    const t = nowIso()
    const mode = payload.mode ?? 'auto'
    const forumScope = payload.forumScope === 'all' ? 'all' : 'first'
    const readability = parseHtmlWithReadability(payload.html, payload.url, { forumScope })

    let title = (payload.title ?? '').trim() || readability.title || 'Импорт из браузера'
    let rawText: string
    let splits: SplitArticle[]

    if (mode === 'manual' && payload.manualRules) {
      const manualSplits = extractManualDom(payload.html, payload.manualRules)
      rawText = manualSplits.map((s) => s.body).join('\n\n---\n\n')
      if (payload.manualRules.strategy === 'single') {
        splits = resolveArticleSplits(rawText, title, true)
      } else {
        splits = manualSplits
      }
      logParse('browser:import-current: ручной DOM', {
        strategy: payload.manualRules.strategy,
        extractedBlocks: manualSplits.length,
        splitsAfterResolve: splits.length,
        rawTextLength: rawText.length,
        firstHeading: splits[0]?.heading?.slice(0, 100)
      })
    } else {
      rawText = readability.text
      logParse('browser:import-current: авто (Readability / форум XenForo)', {
        url: payload.url?.slice(0, 160),
        htmlLength: payload.html.length,
        readabilityTitle: readability.title?.slice(0, 100),
        textLength: rawText.length,
        textSource: readability.textSource ?? 'readability',
        forumScope,
        textExcerpt: rawText.slice(0, 280)
      })
      if (parseTraceVerbose()) {
        logParseDump('browser:import-current: HTML страницы', payload.html, 8000)
        logParseDump('browser:import-current: итоговый текст для парсера', rawText, 8000)
      }
      splits = resolveArticleSplits(rawText, title, true)
    }

    const meta = {
      browserImport: true,
      importMode: mode,
      ...(mode === 'manual' && payload.manualRules ? { manualRules: payload.manualRules } : {})
    }

    const sourceId = uuid()
    db.prepare(
      `INSERT INTO sources (id, title, url, source_type, imported_at, tags_json, metadata_json, raw_html, raw_text)
       VALUES (?, ?, ?, 'web_page', ?, '[]', ?, ?, ?)`
    ).run(sourceId, title, payload.url, t, JSON.stringify(meta), payload.html, rawText)

    const docId = uuid()
    db.prepare(
      `INSERT INTO documents (id, source_id, title, slug, created_at, updated_at, raw_html, raw_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(docId, sourceId, title, slugify(title), t, t, payload.html, rawText)

    insertArticlesFromSplits(db, docId, splits, rawText, payload.articleFilter)

    return { sourceId, documentId: docId }
  })

  ipcMain.handle('hotkeys:get', () => {
    const h = readHotkeys(getDb())
    return {
      toggle: h.toggle,
      search: h.search,
      clickThrough: h.clickThrough,
      display: {
        toggle: humanizeAccelerator(h.toggle),
        search: humanizeAccelerator(h.search),
        clickThrough: humanizeAccelerator(h.clickThrough)
      }
    }
  })

  ipcMain.handle('hotkeys:set', (_e, partial: Partial<HotkeyConfig>) => {
    const db = getDb()
    const cur = readHotkeys(db)
    const merged: HotkeyConfig = {
      toggle: typeof partial.toggle === 'string' ? partial.toggle.trim() : cur.toggle,
      search: typeof partial.search === 'string' ? partial.search.trim() : cur.search,
      clickThrough: typeof partial.clickThrough === 'string' ? partial.clickThrough.trim() : cur.clickThrough
    }
    const vals = [merged.toggle, merged.search, merged.clickThrough]
    if (new Set(vals).size !== vals.length) {
      return { ok: false as const, error: 'duplicate' as const }
    }
    globalShortcut.unregisterAll()
    for (const label of ['toggle', 'search', 'clickThrough'] as const) {
      const r = validateAccelerator(merged[label])
      if (!r.ok) {
        applyOverlayGlobalShortcuts(overlay, db)
        return { ok: false as const, error: 'invalid' as const, field: label, detail: r.error }
      }
    }
    saveHotkeys(db, merged)
    applyOverlayGlobalShortcuts(overlay, db)
    return { ok: true as const }
  })

  ipcMain.handle('hotkeys:reset-defaults', () => {
    const db = getDb()
    saveHotkeys(db, DEFAULT_HOTKEYS)
    applyOverlayGlobalShortcuts(overlay, db)
    return { ok: true as const }
  })

  ipcMain.handle('bookmarks:list', () => {
    return getDb()
      .prepare(
        `SELECT b.id, b.article_id, b.created_at, a.heading, a.article_number, d.id AS document_id, d.title AS document_title
         FROM bookmarks b
         JOIN articles a ON a.id = b.article_id
         JOIN documents d ON d.id = a.document_id
         ORDER BY b.created_at DESC`
      )
      .all()
  })

  ipcMain.handle('bookmarks:has', (_e, articleId: string) => {
    if (typeof articleId !== 'string' || !articleId.trim()) return false
    const row = getDb()
      .prepare('SELECT 1 AS x FROM bookmarks WHERE article_id = ?')
      .get(articleId.trim()) as { x: number } | undefined
    return Boolean(row)
  })

  ipcMain.handle('bookmarks:add', (_e, articleId: string) => {
    if (typeof articleId !== 'string' || !articleId.trim()) return { ok: false as const, error: 'invalid' as const }
    const id = articleId.trim()
    const db = getDb()
    const a = db.prepare('SELECT id FROM articles WHERE id = ?').get(id) as { id: string } | undefined
    if (!a) return { ok: false as const, error: 'no_article' as const }
    const ex = db.prepare('SELECT id FROM bookmarks WHERE article_id = ?').get(id) as { id: string } | undefined
    if (ex) return { ok: true as const, bookmarkId: ex.id }
    const bid = uuid()
    db.prepare('INSERT INTO bookmarks (id, article_id, created_at) VALUES (?, ?, ?)').run(bid, id, nowIso())
    return { ok: true as const, bookmarkId: bid }
  })

  ipcMain.handle('bookmarks:remove', (_e, articleId: string) => {
    if (typeof articleId !== 'string' || !articleId.trim()) return { ok: false as const }
    const r = getDb().prepare('DELETE FROM bookmarks WHERE article_id = ?').run(articleId.trim())
    return { ok: r.changes > 0 }
  })

  ipcMain.handle('notes:list', () => {
    return getDb()
      .prepare(
        `SELECT n.*, a.heading AS article_heading, a.article_number AS article_number,
                d.id AS document_id, d.title AS document_title
         FROM notes n
         LEFT JOIN articles a ON a.id = n.article_id
         LEFT JOIN documents d ON d.id = a.document_id
         ORDER BY n.updated_at DESC`
      )
      .all()
  })

  ipcMain.handle('notes:get', (_e, id: string) => {
    if (typeof id !== 'string' || !id.trim()) return null
    return getDb()
      .prepare(
        `SELECT n.*, a.heading AS article_heading, a.article_number AS article_number,
                d.id AS document_id, d.title AS document_title
         FROM notes n
         LEFT JOIN articles a ON a.id = n.article_id
         LEFT JOIN documents d ON d.id = a.document_id
         WHERE n.id = ?`
      )
      .get(id.trim())
  })

  ipcMain.handle(
    'notes:save',
    (
      _e,
      payload: { id?: string; article_id?: string | null; scenario_key?: string | null; title?: string | null; body: string }
    ) => {
      const body = typeof payload.body === 'string' ? payload.body.trim() : ''
      if (!body) return { ok: false as const, error: 'empty_body' as const }
      const db = getDb()
      const t = nowIso()
      const id = payload.id?.trim() || uuid()
      const title = payload.title?.trim() || null
      const scenario = payload.scenario_key?.trim() || null
      const aid = payload.article_id?.trim() || null
      if (aid) {
        const a = db.prepare('SELECT id FROM articles WHERE id = ?').get(aid) as { id: string } | undefined
        if (!a) return { ok: false as const, error: 'bad_article' as const }
      }
      const existing = db.prepare('SELECT id FROM notes WHERE id = ?').get(id) as { id: string } | undefined
      if (existing) {
        db.prepare(
          `UPDATE notes SET article_id = ?, scenario_key = ?, title = ?, body = ?, updated_at = ? WHERE id = ?`
        ).run(aid, scenario, title, body, t, id)
      } else {
        db.prepare(`INSERT INTO notes (id, article_id, scenario_key, title, body, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
          id,
          aid,
          scenario,
          title,
          body,
          t
        )
      }
      return { ok: true as const, id }
    }
  )

  ipcMain.handle('notes:delete', (_e, id: string) => {
    if (typeof id !== 'string' || !id.trim()) return { ok: false as const }
    const r = getDb().prepare('DELETE FROM notes WHERE id = ?').run(id.trim())
    return { ok: r.changes > 0 }
  })
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\u0400-\u04FF]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}
