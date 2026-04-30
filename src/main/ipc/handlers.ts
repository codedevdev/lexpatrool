import { app, ipcMain, dialog, globalShortcut, BrowserWindow } from 'electron'
import { setMainWindowAlwaysOnTop } from '../window-always-on-top'
import type { BrowserWindow as ElectronBrowserWindow } from 'electron'
import { writeFileSync, readFileSync } from 'fs'
import type { Database } from 'better-sqlite3'

function mergeAgentConfig(
  db: Database,
  base: AiProviderConfig,
  agentId?: string | null
): { cfg: AiProviderConfig; extra: string } {
  if (!agentId) return { cfg: base, extra: '' }
  const row = db
    .prepare('SELECT system_prompt_extra FROM ai_agents WHERE id = ?')
    .get(agentId) as { system_prompt_extra: string } | undefined
  if (!row) return { cfg: base, extra: '' }
  return { cfg: base, extra: row.system_prompt_extra ?? '' }
}
import { v4 as uuid } from 'uuid'
import type {
  ImportPayload,
  ReplaceDocumentImportPayload,
  AiProviderConfig,
  AiCompletePayload,
  AiChatTurnPayload,
  AiChatCreatePayload,
  AiChatAppendTurnPayload,
  AiConversationSummary,
  AiCitation,
  AiAgentRecord,
  AiEmbeddingsProgress,
  BrowserImportPayload,
  ManualDomParseRulesV1,
  ArticleUpdatePayload,
  ArticleCollectionSavePayload,
  CheatSheetSavePayload,
  UserNoteSavePayload
} from '../../shared/types'
import { extractManualDom } from '../../parsers/manual-dom-extract'
import { parseHtmlWithReadability } from '../../parsers/readability-import'
import { resolveArticleSplits } from '../../parsers/resolve-article-splits'
import type { SplitArticle } from '../../parsers/article-split'
import { logParse, logParseDump, parseTraceVerbose } from '../../parsers/parse-trace'
import {
  filterArticleSplits,
  type ArticleImportFilter
} from '../../parsers/article-import-filter'
import { insertArticlesFromSplits, replaceDocumentArticlesFromSplits } from '../article-splits-persist'
import { retrieveChunksForQuery, snippetForArticleBody } from '../../services/retrieval'
import { runAiPipeline } from '../../services/ai-pipeline'
import {
  clearEmbeddingsIndex,
  getEmbeddingsStatus,
  rebuildArticleEmbeddings
} from '../../services/embeddings'
import type { OverlayController, OverlayDockPosition, OverlayInteractionMode } from '../overlay-window'
import type { ToolOverlayController } from '../tool-overlay-window'
import {
  applyOverlayGlobalShortcuts,
  DEFAULT_HOTKEYS,
  getHotkeyRegistrationStatus,
  HOTKEY_FIELDS,
  humanizeAccelerator,
  readHotkeys,
  saveHotkeys,
  validateAccelerator,
  type HotkeyConfig
} from '../global-shortcuts'
import { seedIfEmpty } from '../seed'
import { checkForUpdates, getUpdateRepoLabel } from '../update-check'
import { LEX_BACKUP_TABLE_ORDER } from '../backup-tables'
import { parseBackupJson, restoreDatabaseFromBackupData } from '../backup-restore'

/** Ограничение размера истории в теле IPC и в контексте модели (хвост диалога). */
const AI_CHAT_MAX_HISTORY_MESSAGES = 40

const DEFAULT_AI_CHAT_TITLE = 'Новый диалог'
const OVERLAY_UI_PREFS_KEY = 'overlay_ui_prefs'

type OverlayAotLevel = 'off' | 'floating' | 'screen-saver' | 'pop-up-menu'
type OverlayArticleListMode = 'cards' | 'dense'
type OverlayLayoutPreset = 'compact' | 'reading' | 'full'

interface OverlayUiPrefs {
  opacity?: number
  layoutPreset?: OverlayLayoutPreset
  focusMode?: boolean
  fontScale?: number
  toolsExpanded?: boolean
  cheatSheetMode?: boolean
  articleListMode?: OverlayArticleListMode
}

const GAME_OVERLAY_PROFILE: {
  opacity: number
  clickThrough: boolean
  aotLevel: OverlayAotLevel
  interactionMode: OverlayInteractionMode
  dock: OverlayDockPosition
  uiPrefs: Required<OverlayUiPrefs>
} = {
  opacity: 0.9,
  clickThrough: true,
  aotLevel: 'pop-up-menu',
  interactionMode: 'game',
  dock: 'compact-top-right',
  uiPrefs: {
    opacity: 0.9,
    layoutPreset: 'compact',
    focusMode: true,
    fontScale: 1,
    toolsExpanded: false,
    cheatSheetMode: true,
    articleListMode: 'dense'
  }
}

function readOverlayUiPrefs(db: Database): OverlayUiPrefs {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(OVERLAY_UI_PREFS_KEY) as
    | { value: string }
    | undefined
  if (!row?.value) return {}
  try {
    const parsed = JSON.parse(row.value) as OverlayUiPrefs
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeSetting(db: Database, key: string, value: string): void {
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    key,
    value
  )
}

function deriveConversationTitleFromFirstMessage(text: string): string {
  const line = text.trim().split(/\r?\n/u)[0]?.trim() ?? ''
  if (!line) return DEFAULT_AI_CHAT_TITLE
  return line.length > 80 ? `${line.slice(0, 77)}…` : line
}

export interface IpcContext {
  getMainWindow: () => ElectronBrowserWindow | null
  getDb: () => Database
  overlay: OverlayController
  cheatToolOverlay: ToolOverlayController
  collectionToolOverlay: ToolOverlayController
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Превью разбиения должно показывать ровно те блоки, которые попадут в БД при выбранном
 * фильтре. Передаваемое из renderer значение нормализуем к ArticleImportFilter.
 */
function applyArticleFilterPreview(
  splits: SplitArticle[],
  raw: unknown
): SplitArticle[] {
  const f =
    raw === 'with_sanctions' || raw === 'without_sanctions' || raw === 'all'
      ? (raw as ArticleImportFilter)
      : 'all'
  if (f === 'all') return splits
  return filterArticleSplits(splits, f)
}

function ensureTagByName(db: Database, name: string): string | null {
  const n = name.trim()
  if (!n) return null
  const row = db.prepare('SELECT id FROM tags WHERE LOWER(name) = LOWER(?)').get(n) as { id: string } | undefined
  if (row) return row.id
  const id = uuid()
  try {
    db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(id, n)
    return id
  } catch {
    const again = db.prepare('SELECT id FROM tags WHERE LOWER(name) = LOWER(?)').get(n) as { id: string } | undefined
    return again?.id ?? null
  }
}

export function registerIpcHandlers(ctx: IpcContext): void {
  const { getDb, overlay, cheatToolOverlay, collectionToolOverlay, getMainWindow } = ctx

  function reloadAppRenderersAfterDbRestore(): void {
    const mw = getMainWindow()
    if (mw && !mw.isDestroyed()) mw.webContents.reload()
    overlay.reloadIfOpen()
    cheatToolOverlay.reloadIfOpen()
    collectionToolOverlay.reloadIfOpen()
    applyOverlayGlobalShortcuts(overlay, cheatToolOverlay, collectionToolOverlay, getDb())
  }

  function broadcastRendererEvent(channel: 'collections:changed' | 'cheatSheets:changed' | 'notes:changed'): void {
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        if (!w.isDestroyed()) w.webContents.send(channel)
      } catch {
        /* ignore */
      }
    }
  }

  function broadcastCollectionsChanged(): void {
    broadcastRendererEvent('collections:changed')
  }

  function broadcastCheatSheetsChanged(): void {
    broadcastRendererEvent('cheatSheets:changed')
  }

  function broadcastNotesChanged(): void {
    broadcastRendererEvent('notes:changed')
  }

  ipcMain.handle('app:get-version', async () => {
    return app.getVersion()
  })

  ipcMain.handle('update:check', async () => checkForUpdates(app.getVersion()))

  ipcMain.handle('update:repo-label', async () => getUpdateRepoLabel())

  ipcMain.handle('db:backup', async () => {
    const win = ctx.getMainWindow()
    const opts = {
      title: 'Сохранить резервную копию',
      defaultPath: 'lexpatrol-backup.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const { filePath } =
      win != null && !win.isDestroyed()
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts)
    if (!filePath) return { ok: false }
    const db = getDb()
    const dump: Record<string, unknown[]> = {}
    for (const t of LEX_BACKUP_TABLE_ORDER) {
      dump[t] = db.prepare(`SELECT * FROM ${t}`).all()
    }
    try {
      writeFileSync(filePath, JSON.stringify({ version: 1, exportedAt: nowIso(), data: dump }, null, 2), 'utf-8')
      return { ok: true, path: filePath }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[LexPatrol] db:backup', e)
      return { ok: false, error: message }
    }
  })

  ipcMain.handle(
    'db:restore',
    async (): Promise<
      | { ok: true; path: string; exportedAt: string | null }
      | { ok: false; error?: string; cancelled?: boolean }
    > => {
      const win = getMainWindow()
      const { canceled, filePaths } =
        win != null && !win.isDestroyed()
          ? await dialog.showOpenDialog(win, {
              title: 'Импорт резервной копии',
              filters: [{ name: 'JSON', extensions: ['json'] }],
              properties: ['openFile']
            })
          : await dialog.showOpenDialog({
              title: 'Импорт резервной копии',
              filters: [{ name: 'JSON', extensions: ['json'] }],
              properties: ['openFile']
            })
      if (canceled) return { ok: false, cancelled: true }
      const filePath = filePaths[0]
      if (!filePath) return { ok: false, cancelled: true }
      let raw: string
      try {
        raw = readFileSync(filePath, 'utf-8')
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        return { ok: false, error: `Не удалось прочитать файл: ${message}` }
      }
      const parsed = parseBackupJson(raw)
      if (!parsed.ok) return { ok: false, error: parsed.error }
      try {
        restoreDatabaseFromBackupData(getDb(), parsed.data)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.error('[LexPatrol] db:restore', e)
        return { ok: false, error: `Импорт не выполнен: ${message}` }
      }
      reloadAppRenderersAfterDbRestore()
      return { ok: true, path: filePath, exportedAt: parsed.exportedAt }
    }
  )

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

  ipcMain.handle('overlay:get-interaction-mode', () => overlay.getInteractionMode())

  ipcMain.handle('overlay:set-interaction-mode', (_e, mode: string) => {
    const ok = mode === 'game' || mode === 'interactive'
    if (ok) overlay.setInteractionMode(mode as OverlayInteractionMode)
    return ok
  })

  ipcMain.handle('overlay:apply-game-profile', () => {
    const db = getDb()
    const uiPrefs: OverlayUiPrefs = {
      ...readOverlayUiPrefs(db),
      ...GAME_OVERLAY_PROFILE.uiPrefs
    }

    overlay.setAlwaysOnTopLevel(GAME_OVERLAY_PROFILE.aotLevel)
    overlay.setInteractionMode(GAME_OVERLAY_PROFILE.interactionMode)
    overlay.setClickThrough(GAME_OVERLAY_PROFILE.clickThrough)
    overlay.setOpacity(GAME_OVERLAY_PROFILE.opacity)

    writeSetting(db, 'overlay_click_through', GAME_OVERLAY_PROFILE.clickThrough ? '1' : '0')
    writeSetting(db, 'overlay_opacity', String(GAME_OVERLAY_PROFILE.opacity))
    writeSetting(db, OVERLAY_UI_PREFS_KEY, JSON.stringify(uiPrefs))

    overlay.dock(GAME_OVERLAY_PROFILE.dock)
    overlay.bringToFront()
    overlay.send('overlay:click-through-changed', GAME_OVERLAY_PROFILE.clickThrough)
    overlay.send('overlay:apply-ui-prefs', uiPrefs)
    setTimeout(() => overlay.send('overlay:apply-ui-prefs', uiPrefs), 250)

    return {
      ok: true as const,
      opacity: GAME_OVERLAY_PROFILE.opacity,
      clickThrough: GAME_OVERLAY_PROFILE.clickThrough,
      aotLevel: GAME_OVERLAY_PROFILE.aotLevel,
      interactionMode: GAME_OVERLAY_PROFILE.interactionMode,
      dock: GAME_OVERLAY_PROFILE.dock,
      uiPrefs
    }
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

  ipcMain.handle('stats:summary', () => {
    const db = getDb()
    const documents = db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number }
    const articles = db.prepare('SELECT COUNT(*) AS c FROM articles').get() as { c: number }
    return { documentCount: documents.c, articleCount: articles.c }
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
        `SELECT a.*, d.title AS document_title, d.id AS document_id, d.article_import_filter AS document_article_import_filter, s.url AS source_url
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
    const db = getDb()
    const row = db.prepare('SELECT source_id FROM documents WHERE id = ?').get(id) as
      | { source_id: string | null }
      | undefined
    const del = db.transaction(() => {
      const r = db.prepare('DELETE FROM documents WHERE id = ?').run(id)
      if (r.changes === 0) return false
      if (row?.source_id) {
        const left = db.prepare('SELECT COUNT(*) AS c FROM documents WHERE source_id = ?').get(row.source_id) as {
          c: number
        }
        if (left.c === 0) db.prepare('DELETE FROM sources WHERE id = ?').run(row.source_id)
      }
      return true
    })()
    return { ok: del }
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
    if (payload.clearPreviousRevision) {
      sets.push('previous_body_clean = NULL')
      sets.push('previous_captured_at = NULL')
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

  ipcMain.handle('search:query', (_e, q: string, opts?: { tagIds?: string[] }) => {
    const db = getDb()
    const tagIds =
      opts && Array.isArray(opts.tagIds)
        ? opts.tagIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        : undefined
    const chunks = retrieveChunksForQuery(db, q, 25, tagIds?.length ? { tagIds } : undefined)
    return chunks.map((c, i) => ({
      article_id: c.articleId,
      document_id: c.documentId,
      document_title: c.documentTitle,
      heading: c.heading,
      article_number: c.articleNumber,
      snippet: snippetForArticleBody(c.body, q),
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
    const articleFilter = payload.articleFilter ?? null
    db.prepare(
      `INSERT INTO documents (id, source_id, title, slug, created_at, updated_at, raw_html, raw_text, category_id, article_import_filter)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      docId,
      sourceId,
      title,
      slugify(title),
      t,
      t,
      rawHtml,
      rawText,
      payload.categoryId ?? null,
      articleFilter
    )

    const splits = resolveArticleSplits(rawText, title, payload.splitArticles !== false)
    insertArticlesFromSplits(db, docId, splits, rawText, payload.articleFilter)

    return { sourceId, documentId: docId }
  })

  ipcMain.handle('import:replace-document', (_e, payload: ReplaceDocumentImportPayload) => {
    const db = getDb()
    const docId = payload.documentId?.trim()
    if (!docId) return { ok: false as const, error: 'no_document' as const }
    const doc = db.prepare('SELECT id, source_id FROM documents WHERE id = ?').get(docId) as
      | { id: string; source_id: string | null }
      | undefined
    if (!doc) return { ok: false as const, error: 'document_not_found' as const }
    if (!doc.source_id) return { ok: false as const, error: 'no_source' as const }

    let rawHtml = payload.rawHtml ?? null
    let rawText = payload.rawText ?? ''
    let title = payload.title?.trim() || 'Импорт'

    if (rawHtml) {
      const r = parseHtmlWithReadability(rawHtml, payload.url)
      title = r.title || title
      rawText = r.text || rawText
    }

    logParse('import:replace-document', {
      documentId: docId,
      rawTextLength: rawText.length,
      title: title.slice(0, 100)
    })

    const t = nowIso()
    const articleFilter = payload.articleFilter ?? null

    db.prepare(
      `UPDATE sources SET title = ?, url = ?, source_type = ?, tags_json = ?, category_id = ?, code_family = ?,
         raw_html = ?, raw_text = ?, refreshed_at = ?
       WHERE id = ?`
    ).run(
      title,
      payload.url ?? null,
      payload.sourceType,
      JSON.stringify(payload.tags ?? []),
      payload.categoryId ?? null,
      payload.codeFamily ?? null,
      rawHtml,
      rawText,
      t,
      doc.source_id
    )

    db.prepare(
      `UPDATE documents SET title = ?, slug = ?, updated_at = ?, raw_html = ?, raw_text = ?, category_id = ?, article_import_filter = ?
       WHERE id = ?`
    ).run(title, slugify(title), t, rawHtml, rawText, payload.categoryId ?? null, articleFilter, docId)

    const splits = resolveArticleSplits(rawText, title, payload.splitArticles !== false)
    const stats = replaceDocumentArticlesFromSplits(db, docId, splits, rawText, payload.articleFilter)
    return { ok: true as const, documentId: docId, stats }
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
    const result = await runAiPipeline({
      db,
      cfg,
      agentExtra: extra,
      question: userQuestion
    })
    return {
      text: result.text,
      citations: result.citations,
      notice: result.notice,
      retrieved: result.retrieved,
      pipeline: result.pipeline
    }
  })

  ipcMain.handle('ai:chatTurn', async (_e, payload: AiChatTurnPayload) => {
    const db = getDb()
    const { cfg: baseCfg, history: rawHistory, message: userMessage, agentId } = payload
    const trimmed = userMessage.trim()
    if (!trimmed) throw new Error('Пустое сообщение')

    const history = rawHistory.slice(-AI_CHAT_MAX_HISTORY_MESSAGES)
    const { cfg, extra } = mergeAgentConfig(db, baseCfg, agentId)

    const explicitPinned = Array.isArray(payload.pinnedArticleIds)
      ? payload.pinnedArticleIds.filter((s) => typeof s === 'string' && s.length > 0)
      : []
    const excludePinned = Array.isArray(payload.excludePinnedIds)
      ? payload.excludePinnedIds.filter((s) => typeof s === 'string' && s.length > 0)
      : []
    const pinnedSet = new Set(explicitPinned)
    for (const id of excludePinned) pinnedSet.delete(id)

    const result = await runAiPipeline({
      db,
      cfg,
      agentExtra: extra,
      question: trimmed,
      history,
      pinnedArticleIds: [...pinnedSet],
      excludePinnedIds: excludePinned
    })
    return {
      text: result.text,
      citations: result.citations,
      notice: result.notice,
      retrieved: result.retrieved,
      pipeline: result.pipeline
    }
  })

  /* --------------------- ai:embeddings:* --------------------- */
  let embeddingsRebuildAbort = false

  ipcMain.handle('ai:embeddings:status', (_e, cfg: AiProviderConfig) => {
    return getEmbeddingsStatus(getDb(), cfg)
  })

  ipcMain.handle('ai:embeddings:cancel', () => {
    embeddingsRebuildAbort = true
    return true
  })

  ipcMain.handle('ai:embeddings:clear', () => {
    clearEmbeddingsIndex(getDb())
    return true
  })

  ipcMain.handle('ai:embeddings:rebuild', async (_e, cfg: AiProviderConfig) => {
    const db = getDb()
    embeddingsRebuildAbort = false
    const sendProgress = (p: AiEmbeddingsProgress): void => {
      try {
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.webContents.send('ai:embeddings:progress', p)
        }
      } catch {
        /* окно может быть уничтожено — не критично */
      }
    }
    try {
      const final = await rebuildArticleEmbeddings(db, cfg, {
        isCancelled: () => embeddingsRebuildAbort,
        onProgress: sendProgress
      })
      return final
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const r: AiEmbeddingsProgress = { phase: 'error', processed: 0, total: 0, message }
      sendProgress(r)
      return r
    }
  })

  ipcMain.handle('aiChat:list', () => {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT id, title, created_at, updated_at, provider, model, agent_id
         FROM ai_conversations ORDER BY updated_at DESC LIMIT 200`
      )
      .all() as AiConversationSummary[]
    return rows
  })

  ipcMain.handle('aiChat:create', (_e, payload: AiChatCreatePayload) => {
    const db = getDb()
    const id = uuid()
    const t = nowIso()
    const { cfg, agentId } = payload
    const title = payload.title?.trim() || DEFAULT_AI_CHAT_TITLE
    db.prepare(
      `INSERT INTO ai_conversations (id, title, created_at, updated_at, provider, model, agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, title, t, t, cfg.provider, cfg.model, agentId ?? null)
    return { id }
  })

  ipcMain.handle('aiChat:get', (_e, conversationId: string) => {
    const db = getDb()
    const conv = db
      .prepare(
        `SELECT id, title, created_at, updated_at, provider, model, agent_id FROM ai_conversations WHERE id = ?`
      )
      .get(conversationId) as AiConversationSummary | undefined
    if (!conv) return null
    const rows = db
      .prepare(
        `SELECT id, conversation_id, role, content, citations_json, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC`
      )
      .all(conversationId) as {
      id: string
      conversation_id: string
      role: string
      content: string
      citations_json: string | null
      created_at: string
    }[]
    const messages = rows.map((m) => {
      let citations: AiCitation[] | null = null
      if (m.citations_json) {
        try {
          citations = JSON.parse(m.citations_json) as AiCitation[]
        } catch {
          citations = null
        }
      }
      return {
        id: m.id,
        conversation_id: m.conversation_id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        citations,
        created_at: m.created_at
      }
    })
    return { conversation: conv, messages }
  })

  ipcMain.handle('aiChat:delete', (_e, id: string) => {
    getDb().prepare('DELETE FROM ai_conversations WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle('aiChat:rename', (_e, payload: { id: string; title: string }) => {
    const title = payload.title.trim()
    if (!title) return false
    const t = nowIso()
    getDb()
      .prepare('UPDATE ai_conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, t, payload.id)
    return true
  })

  ipcMain.handle('aiChat:appendTurn', (_e, payload: AiChatAppendTurnPayload) => {
    const db = getDb()
    const { conversationId, userContent, assistantContent, citations, agentId } = payload
    const conv = db
      .prepare('SELECT id, title FROM ai_conversations WHERE id = ?')
      .get(conversationId) as { id: string; title: string } | undefined
    if (!conv) throw new Error('Диалог не найден')

    const uid = uuid()
    const aid = uuid()
    const base = Date.now()
    const tUser = new Date(base).toISOString()
    const tAsst = new Date(base + 1).toISOString()
    const tUp = nowIso()
    const citesJson = JSON.stringify(citations ?? [])
    const nextTitle =
      conv.title.trim() === DEFAULT_AI_CHAT_TITLE ? deriveConversationTitleFromFirstMessage(userContent) : conv.title

    const run = db.transaction(() => {
      db.prepare(
        `INSERT INTO ai_messages (id, conversation_id, role, content, citations_json, created_at) VALUES (?, ?, 'user', ?, NULL, ?)`
      ).run(uid, conversationId, userContent, tUser)
      db.prepare(
        `INSERT INTO ai_messages (id, conversation_id, role, content, citations_json, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)`
      ).run(aid, conversationId, assistantContent, citesJson, tAsst)
      db.prepare(`UPDATE ai_conversations SET updated_at = ?, title = ?, agent_id = ? WHERE id = ?`).run(
        tUp,
        nextTitle,
        agentId ?? null,
        conversationId
      )
    })
    run()
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

  ipcMain.handle('overlay:dock', (_e, where: OverlayDockPosition) => {
    overlay.dock(where)
  })

  const pickToolOverlay = (which: unknown): ToolOverlayController | null => {
    if (which === 'cheats') return cheatToolOverlay
    if (which === 'collections') return collectionToolOverlay
    return null
  }

  ipcMain.handle('toolOverlay:show', (_e, which: unknown) => {
    pickToolOverlay(which)?.show()
  })
  ipcMain.handle('toolOverlay:hide', (_e, which: unknown) => {
    pickToolOverlay(which)?.hide()
  })
  ipcMain.handle('toolOverlay:toggle', (_e, which: unknown) => {
    pickToolOverlay(which)?.toggle()
  })
  ipcMain.handle('toolOverlay:raise', (_e, which: unknown) => {
    pickToolOverlay(which)?.bringToFront()
    return true
  })
  ipcMain.handle('toolOverlay:dock', (_e, which: unknown, where: 'left' | 'right' | 'top-right' | 'center') => {
    pickToolOverlay(which)?.dock(where)
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

  ipcMain.handle(
    'parse:resolve-article-splits',
    (_e, rawText: string, title: string, articleFilter?: ArticleImportFilter) => {
      const splits = resolveArticleSplits(rawText, title ?? '', true)
      return applyArticleFilterPreview(splits, articleFilter)
    }
  )

  ipcMain.handle(
    'parse:auto-import-preview',
    (
      _e,
      html: string,
      url: string | undefined,
      title: string,
      forumScope?: 'first' | 'all',
      articleFilter?: ArticleImportFilter
    ) => {
      const scope = forumScope === 'all' ? 'all' : 'first'
      const r = parseHtmlWithReadability(html, url, { forumScope: scope })
      const docTitle = (title ?? '').trim() || r.title || 'Импорт'
      const splits = resolveArticleSplits(r.text, docTitle, true)
      const filtered = applyArticleFilterPreview(splits, articleFilter)
      return {
        title: r.title,
        documentTitle: docTitle,
        textLength: r.text.length,
        textSource: r.textSource ?? 'readability',
        excerpt: r.excerpt,
        splits: filtered
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

    const articleFilter = payload.articleFilter ?? null
    const replaceId =
      typeof payload.replaceDocumentId === 'string' ? payload.replaceDocumentId.trim() : ''

    if (replaceId) {
      const doc = db
        .prepare('SELECT id, source_id FROM documents WHERE id = ?')
        .get(replaceId) as { id: string; source_id: string | null } | undefined
      if (!doc) return { ok: false as const, error: 'document_not_found' as const }
      if (!doc.source_id) return { ok: false as const, error: 'no_source' as const }

      logParse('browser:import-current: обновление документа', {
        documentId: replaceId,
        rawTextLength: rawText.length,
        title: title.slice(0, 100)
      })

      db.prepare(
        `UPDATE sources SET title = ?, url = ?, source_type = 'web_page', raw_html = ?, raw_text = ?, refreshed_at = ?, metadata_json = ?
         WHERE id = ?`
      ).run(title, payload.url ?? null, payload.html, rawText, t, JSON.stringify(meta), doc.source_id)

      db.prepare(
        `UPDATE documents SET title = ?, slug = ?, updated_at = ?, raw_html = ?, raw_text = ?, article_import_filter = ?
         WHERE id = ?`
      ).run(title, slugify(title), t, payload.html, rawText, articleFilter, replaceId)

      replaceDocumentArticlesFromSplits(db, replaceId, splits, rawText, articleFilter ?? undefined)

      return { ok: true as const, sourceId: doc.source_id, documentId: replaceId }
    }

    const sourceId = uuid()
    db.prepare(
      `INSERT INTO sources (id, title, url, source_type, imported_at, tags_json, metadata_json, raw_html, raw_text)
       VALUES (?, ?, ?, 'web_page', ?, '[]', ?, ?, ?)`
    ).run(sourceId, title, payload.url, t, JSON.stringify(meta), payload.html, rawText)

    const docId = uuid()
    db.prepare(
      `INSERT INTO documents (id, source_id, title, slug, created_at, updated_at, raw_html, raw_text, article_import_filter)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(docId, sourceId, title, slugify(title), t, t, payload.html, rawText, articleFilter)

    insertArticlesFromSplits(db, docId, splits, rawText, articleFilter ?? undefined)

    return { ok: true as const, sourceId, documentId: docId }
  })

  ipcMain.handle('hotkeys:get', () => {
    const h = readHotkeys(getDb())
    const d = DEFAULT_HOTKEYS
    return {
      toggle: h.toggle,
      search: h.search,
      clickThrough: h.clickThrough,
      cheatsOverlay: h.cheatsOverlay,
      collectionsOverlay: h.collectionsOverlay,
      display: {
        toggle: humanizeAccelerator(h.toggle),
        search: humanizeAccelerator(h.search),
        clickThrough: humanizeAccelerator(h.clickThrough),
        cheatsOverlay: humanizeAccelerator(h.cheatsOverlay),
        collectionsOverlay: humanizeAccelerator(h.collectionsOverlay)
      },
      defaultsDisplay: {
        toggle: humanizeAccelerator(d.toggle),
        search: humanizeAccelerator(d.search),
        clickThrough: humanizeAccelerator(d.clickThrough),
        cheatsOverlay: humanizeAccelerator(d.cheatsOverlay),
        collectionsOverlay: humanizeAccelerator(d.collectionsOverlay)
      },
      registration: getHotkeyRegistrationStatus()
    }
  })

  ipcMain.handle('hotkeys:set', (_e, partial: Partial<HotkeyConfig>) => {
    const db = getDb()
    const cur = readHotkeys(db)
    const merged: HotkeyConfig = {
      toggle: typeof partial.toggle === 'string' ? partial.toggle.trim() : cur.toggle,
      search: typeof partial.search === 'string' ? partial.search.trim() : cur.search,
      clickThrough: typeof partial.clickThrough === 'string' ? partial.clickThrough.trim() : cur.clickThrough,
      cheatsOverlay:
        typeof partial.cheatsOverlay === 'string' ? partial.cheatsOverlay.trim() : cur.cheatsOverlay,
      collectionsOverlay:
        typeof partial.collectionsOverlay === 'string'
          ? partial.collectionsOverlay.trim()
          : cur.collectionsOverlay
    }
    const vals = HOTKEY_FIELDS.map((k) => merged[k])
    if (new Set(vals).size !== vals.length) {
      return { ok: false as const, error: 'duplicate' as const }
    }
    globalShortcut.unregisterAll()
    for (const label of HOTKEY_FIELDS) {
      const r = validateAccelerator(merged[label])
      if (!r.ok) {
        applyOverlayGlobalShortcuts(overlay, cheatToolOverlay, collectionToolOverlay, db)
        return { ok: false as const, error: 'invalid' as const, field: label, detail: r.error }
      }
    }
    try {
      saveHotkeys(db, merged)
      return { ok: true as const }
    } catch (e) {
      console.error('[LexPatrol] hotkeys:set saveHotkeys', e)
      throw e
    } finally {
      applyOverlayGlobalShortcuts(overlay, cheatToolOverlay, collectionToolOverlay, db)
    }
  })

  ipcMain.handle('hotkeys:reset-defaults', () => {
    const db = getDb()
    saveHotkeys(db, DEFAULT_HOTKEYS)
    applyOverlayGlobalShortcuts(overlay, cheatToolOverlay, collectionToolOverlay, db)
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

  ipcMain.handle('collections:list', () => {
    return getDb()
      .prepare(
        `SELECT c.*,
          (SELECT COUNT(*) FROM article_collection_items i WHERE i.collection_id = c.id) AS article_count
         FROM article_collections c
         ORDER BY c.sort_order ASC, c.name ASC`
      )
      .all()
  })

  ipcMain.handle(
    'collections:save',
    (_e, row: ArticleCollectionSavePayload) => {
      const db = getDb()
      const name = row.name?.trim()
      if (!name) return { ok: false as const, error: 'name' as const }
      const t = nowIso()
      const id = row.id?.trim() || uuid()
      const existing = db.prepare('SELECT id, sort_order FROM article_collections WHERE id = ?').get(id) as
        | { id: string; sort_order: number }
        | undefined
      const sort =
        row.sort_order ??
        existing?.sort_order ??
        ((db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM article_collections').get() as { m: number }).m + 1)
      if (existing) {
        db.prepare(
          `UPDATE article_collections SET name = ?, description = ?, sort_order = ? WHERE id = ?`
        ).run(name, row.description?.trim() || null, sort, id)
      } else {
        db.prepare(
          `INSERT INTO article_collections (id, name, description, sort_order, created_at) VALUES (?, ?, ?, ?, ?)`
        ).run(id, name, row.description?.trim() || null, sort, t)
      }
      broadcastCollectionsChanged()
      return { ok: true as const, id }
    }
  )

  ipcMain.handle('collections:delete', (_e, id: string) => {
    if (!id?.trim()) return false
    getDb().prepare('DELETE FROM article_collections WHERE id = ?').run(id.trim())
    broadcastCollectionsChanged()
    return true
  })

  ipcMain.handle('collections:getArticles', (_e, collectionId: string) => {
    if (!collectionId?.trim()) return []
    return getDb()
      .prepare(
        `SELECT a.id, a.heading, a.article_number, a.body_clean, a.summary_short, a.penalty_hint, a.display_meta_json,
                d.id AS document_id, d.title AS document_title, d.article_import_filter AS document_article_import_filter,
                i.sort_order
         FROM article_collection_items i
         JOIN articles a ON a.id = i.article_id
         JOIN documents d ON d.id = a.document_id
         WHERE i.collection_id = ?
         ORDER BY i.sort_order ASC`
      )
      .all(collectionId.trim())
  })

  ipcMain.handle('collections:addArticle', (_e, collectionId: string, articleId: string) => {
    const db = getDb()
    const cid = collectionId?.trim()
    const aid = articleId?.trim()
    if (!cid || !aid) return { ok: false as const, error: 'ids' as const }
    const a = db.prepare('SELECT id FROM articles WHERE id = ?').get(aid) as { id: string } | undefined
    if (!a) return { ok: false as const, error: 'article' as const }
    const c = db.prepare('SELECT id FROM article_collections WHERE id = ?').get(cid) as { id: string } | undefined
    if (!c) return { ok: false as const, error: 'collection' as const }
    const ex = db
      .prepare('SELECT 1 FROM article_collection_items WHERE collection_id = ? AND article_id = ?')
      .get(cid, aid) as { 1: number } | undefined
    if (ex) return { ok: true as const }
    const max = db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM article_collection_items WHERE collection_id = ?')
      .get(cid) as { m: number }
    db.prepare(
      `INSERT INTO article_collection_items (collection_id, article_id, sort_order) VALUES (?, ?, ?)`
    ).run(cid, aid, max.m + 1)
    broadcastCollectionsChanged()
    return { ok: true as const }
  })

  ipcMain.handle('collections:removeArticle', (_e, collectionId: string, articleId: string) => {
    const db = getDb()
    const r = db
      .prepare('DELETE FROM article_collection_items WHERE collection_id = ? AND article_id = ?')
      .run(collectionId?.trim(), articleId?.trim())
    if (r.changes > 0) broadcastCollectionsChanged()
    return { ok: r.changes > 0 }
  })

  ipcMain.handle('collections:reorderArticles', (_e, collectionId: string, orderedArticleIds: string[]) => {
    const db = getDb()
    const cid = collectionId?.trim()
    if (!cid) return false
    const ids = Array.isArray(orderedArticleIds) ? orderedArticleIds : []
    const tx = db.transaction(() => {
      ids.forEach((articleId, i) => {
        db.prepare(
          `UPDATE article_collection_items SET sort_order = ? WHERE collection_id = ? AND article_id = ?`
        ).run(i + 1, cid, articleId)
      })
    })
    tx()
    broadcastCollectionsChanged()
    return true
  })

  ipcMain.handle('tags:list', () => {
    return getDb().prepare('SELECT * FROM tags ORDER BY name ASC').all()
  })

  ipcMain.handle('articleTags:get', (_e, articleId: string) => {
    if (!articleId?.trim()) return []
    return getDb()
      .prepare(
        `SELECT t.id, t.name FROM tags t
         JOIN article_tag_assignments x ON x.tag_id = t.id
         WHERE x.article_id = ?
         ORDER BY t.name ASC`
      )
      .all(articleId.trim())
  })

  ipcMain.handle('articleTags:set', (_e, articleId: string, tagNames: string[]) => {
    const db = getDb()
    const aid = articleId?.trim()
    if (!aid) return { ok: false as const }
    const a = db.prepare('SELECT id FROM articles WHERE id = ?').get(aid) as { id: string } | undefined
    if (!a) return { ok: false as const, error: 'article' as const }
    const names = Array.isArray(tagNames) ? tagNames : []
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM article_tag_assignments WHERE article_id = ?').run(aid)
      for (const raw of names) {
        const tid = ensureTagByName(db, String(raw))
        if (!tid) continue
        db.prepare('INSERT OR IGNORE INTO article_tag_assignments (article_id, tag_id) VALUES (?, ?)').run(aid, tid)
      }
    })
    tx()
    return { ok: true as const }
  })

  ipcMain.handle('seeAlso:list', (_e, fromArticleId: string) => {
    if (!fromArticleId?.trim()) return []
    return getDb()
      .prepare(
        `SELECT s.id, s.to_article_id AS article_id, s.sort_order,
                a.heading, a.article_number, d.title AS document_title, d.id AS document_id
         FROM article_see_also s
         JOIN articles a ON a.id = s.to_article_id
         JOIN documents d ON d.id = a.document_id
         WHERE s.from_article_id = ?
         ORDER BY s.sort_order ASC, a.sort_order ASC`
      )
      .all(fromArticleId.trim())
  })

  ipcMain.handle('seeAlso:add', (_e, fromArticleId: string, toArticleId: string) => {
    const db = getDb()
    const from = fromArticleId?.trim()
    const to = toArticleId?.trim()
    if (!from || !to || from === to) return { ok: false as const, error: 'ids' as const }
    const fromRow = db.prepare('SELECT id FROM articles WHERE id = ?').get(from) as { id: string } | undefined
    const toRow = db.prepare('SELECT id FROM articles WHERE id = ?').get(to) as { id: string } | undefined
    if (!fromRow || !toRow) return { ok: false as const, error: 'missing' as const }
    const ex = db
      .prepare('SELECT id FROM article_see_also WHERE from_article_id = ? AND to_article_id = ?')
      .get(from, to) as { id: string } | undefined
    if (ex) return { ok: true as const, id: ex.id }
    const max = db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM article_see_also WHERE from_article_id = ?')
      .get(from) as { m: number }
    const id = uuid()
    db.prepare(
      `INSERT INTO article_see_also (id, from_article_id, to_article_id, sort_order) VALUES (?, ?, ?, ?)`
    ).run(id, from, to, max.m + 1)
    return { ok: true as const, id }
  })

  ipcMain.handle('seeAlso:remove', (_e, linkId: string) => {
    if (!linkId?.trim()) return false
    const r = getDb().prepare('DELETE FROM article_see_also WHERE id = ?').run(linkId.trim())
    return r.changes > 0
  })

  ipcMain.handle('reader:pushRecent', (_e, articleId: string) => {
    const aid = articleId?.trim()
    if (!aid) return false
    const db = getDb()
    const a = db.prepare('SELECT id FROM articles WHERE id = ?').get(aid) as { id: string } | undefined
    if (!a) return false
    const t = nowIso()
    db.prepare(
      `INSERT INTO reader_recents (article_id, opened_at) VALUES (?, ?)
       ON CONFLICT(article_id) DO UPDATE SET opened_at = excluded.opened_at`
    ).run(aid, t)
    return true
  })

  ipcMain.handle('reader:listRecent', (_e, limit = 20) => {
    const lim = typeof limit === 'number' && limit > 0 ? Math.min(50, limit) : 20
    return getDb()
      .prepare(
        `SELECT r.opened_at, a.id, a.heading, a.article_number, d.id AS document_id, d.title AS document_title
         FROM reader_recents r
         JOIN articles a ON a.id = r.article_id
         JOIN documents d ON d.id = a.document_id
         ORDER BY r.opened_at DESC
         LIMIT ?`
      )
      .all(lim)
  })

  ipcMain.handle('cheatSheets:list', () => {
    return getDb()
      .prepare('SELECT id, title, body, sort_order, created_at, updated_at FROM cheat_sheets ORDER BY sort_order ASC, title ASC')
      .all()
  })

  ipcMain.handle('cheatSheets:get', (_e, id: string) => {
    if (!id?.trim()) return null
    return getDb().prepare('SELECT * FROM cheat_sheets WHERE id = ?').get(id.trim())
  })

  ipcMain.handle(
    'cheatSheets:save',
    (_e, row: CheatSheetSavePayload) => {
      const db = getDb()
      const title = row.title?.trim()
      const body = typeof row.body === 'string' ? row.body : ''
      if (!title) return { ok: false as const, error: 'title' as const }
      const t = nowIso()
      const id = row.id?.trim() || uuid()
      const existing = db.prepare('SELECT id, sort_order FROM cheat_sheets WHERE id = ?').get(id) as
        | { id: string; sort_order: number }
        | undefined
      const sort =
        row.sort_order ??
        existing?.sort_order ??
        ((db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM cheat_sheets').get() as { m: number }).m + 1)
      if (existing) {
        db.prepare(`UPDATE cheat_sheets SET title = ?, body = ?, sort_order = ?, updated_at = ? WHERE id = ?`).run(
          title,
          body,
          sort,
          t,
          id
        )
      } else {
        db.prepare(
          `INSERT INTO cheat_sheets (id, title, body, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, title, body, sort, t, t)
      }
      broadcastCheatSheetsChanged()
      return { ok: true as const, id }
    }
  )

  ipcMain.handle('cheatSheets:delete', (_e, id: string) => {
    if (!id?.trim()) return false
    const r = getDb().prepare('DELETE FROM cheat_sheets WHERE id = ?').run(id.trim())
    if (r.changes > 0) broadcastCheatSheetsChanged()
    return r.changes > 0
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
      payload: UserNoteSavePayload
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
      broadcastNotesChanged()
      return { ok: true as const, id }
    }
  )

  ipcMain.handle('notes:delete', (_e, id: string) => {
    if (typeof id !== 'string' || !id.trim()) return { ok: false as const }
    const r = getDb().prepare('DELETE FROM notes WHERE id = ?').run(id.trim())
    if (r.changes > 0) broadcastNotesChanged()
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
