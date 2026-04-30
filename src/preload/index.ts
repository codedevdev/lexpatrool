import { contextBridge, ipcRenderer } from 'electron'
import type {
  ImportPayload,
  ReplaceDocumentImportPayload,
  AiProviderConfig,
  AiCompletePayload,
  AiCompleteResult,
  AiChatTurnPayload,
  AiChatCreatePayload,
  AiChatAppendTurnPayload,
  AiConversationSummary,
  AiChatGetResult,
  AiAgentRecord,
  AiEmbeddingsProgress,
  AiEmbeddingsStatus,
  BrowserImportPayload,
  ManualDomParseRulesV1,
  ArticleUpdatePayload,
  ArticleCollectionRecord,
  ArticleCollectionSavePayload,
  BookmarkArticleRecord,
  CheatSheetRecord,
  CheatSheetSavePayload,
  CollectionArticleRecord,
  UserNoteRecord,
  UserNoteSavePayload
} from '../shared/types'

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  update: {
    check: (): Promise<{
      currentVersion: string
      status: 'latest' | 'available' | 'error' | 'skipped'
      latestVersion?: string
      releaseUrl?: string
      downloadUrl?: string
      publishedAt?: string
      message?: string
    }> => ipcRenderer.invoke('update:check'),
    repoLabel: (): Promise<string> => ipcRenderer.invoke('update:repo-label'),
    onAvailable: (
      cb: (p: {
        currentVersion: string
        latestVersion: string
        releaseUrl: string
        downloadUrl: string
        publishedAt?: string
        releaseNotes?: string
      }) => void
    ): (() => void) => {
      const handler = (
        _: unknown,
        p: {
          currentVersion: string
          latestVersion: string
          releaseUrl: string
          downloadUrl: string
          publishedAt?: string
          releaseNotes?: string
        }
      ): void => cb(p)
      ipcRenderer.on('app:update-available', handler)
      return () => ipcRenderer.removeListener('app:update-available', handler)
    }
  },
  mainWindow: {
    setAlwaysOnTop: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('window:set-always-on-top', enabled)
  },
  openReader: (documentId: string, articleId?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:open-reader', documentId, articleId),
  onOpenReader: (
    cb: (payload: { documentId: string; articleId?: string }) => void
  ): (() => void) => {
    const handler = (_: unknown, p: { documentId: string; articleId?: string }): void => cb(p)
    ipcRenderer.on('app:reader-navigate', handler)
    return () => ipcRenderer.removeListener('app:reader-navigate', handler)
  },
  settings: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string): Promise<boolean> => ipcRenderer.invoke('settings:set', key, value)
  },
  hotkeys: {
    get: (): Promise<{
      toggle: string
      search: string
      clickThrough: string
      cheatsOverlay: string
      collectionsOverlay: string
      display: {
        toggle: string
        search: string
        clickThrough: string
        cheatsOverlay: string
        collectionsOverlay: string
      }
      defaultsDisplay: {
        toggle: string
        search: string
        clickThrough: string
        cheatsOverlay: string
        collectionsOverlay: string
      }
      registration: {
        toggle: boolean
        search: boolean
        clickThrough: boolean
        cheatsOverlay: boolean
        collectionsOverlay: boolean
      }
    }> => ipcRenderer.invoke('hotkeys:get'),
    set: (
      partial: Partial<{
        toggle: string
        search: string
        clickThrough: string
        cheatsOverlay: string
        collectionsOverlay: string
      }>
    ): Promise<
      | { ok: true }
      | { ok: false; error: 'duplicate' | 'invalid'; field?: string; detail?: string }
    > => ipcRenderer.invoke('hotkeys:set', partial),
    resetDefaults: (): Promise<{ ok: true }> => ipcRenderer.invoke('hotkeys:reset-defaults')
  },
  notes: {
    list: (): Promise<UserNoteRecord[]> => ipcRenderer.invoke('notes:list'),
    get: (id: string): Promise<UserNoteRecord | null> => ipcRenderer.invoke('notes:get', id),
    save: (payload: UserNoteSavePayload): Promise<{ ok: true; id: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('notes:save', payload),
    delete: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('notes:delete', id),
    onChanged: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('notes:changed', handler)
      return () => ipcRenderer.removeListener('notes:changed', handler)
    }
  },
  bookmarks: {
    list: (): Promise<BookmarkArticleRecord[]> => ipcRenderer.invoke('bookmarks:list'),
    has: (articleId: string): Promise<boolean> => ipcRenderer.invoke('bookmarks:has', articleId),
    add: (
      articleId: string
    ): Promise<{ ok: true; bookmarkId: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('bookmarks:add', articleId),
    remove: (articleId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('bookmarks:remove', articleId)
  },
  categories: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('categories:list')
  },
  stats: {
    summary: (): Promise<{ documentCount: number; articleCount: number }> =>
      ipcRenderer.invoke('stats:summary')
  },
  sources: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('sources:list')
  },
  documents: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('documents:list'),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('document:get', id),
    update: (payload: { id: string; title: string }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('document:update', payload),
    delete: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('document:delete', id)
  },
  article: {
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('article:get', id),
    update: (payload: ArticleUpdatePayload): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('article:update', payload),
    delete: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('article:delete', id)
  },
  search: {
    query: (q: string, opts?: { tagIds?: string[] }): Promise<unknown[]> =>
      ipcRenderer.invoke('search:query', q, opts)
  },
  import: {
    payload: (payload: ImportPayload): Promise<{ sourceId: string; documentId: string }> =>
      ipcRenderer.invoke('import:payload', payload),
    replaceDocument: (
      payload: ReplaceDocumentImportPayload
    ): Promise<
      | { ok: true; documentId: string; stats: { inserted: number; updated: number; deleted: number; previousMarked: number } }
      | { ok: false; error: string }
    > => ipcRenderer.invoke('import:replace-document', payload),
    browserPage: (
      payload: BrowserImportPayload
    ): Promise<
      | { ok: true; sourceId: string; documentId: string }
      | { ok: false; error: string }
    > => ipcRenderer.invoke('browser:import-current', payload)
  },
  parse: {
    html: (html: string, url?: string): Promise<unknown> => ipcRenderer.invoke('parse:html', html, url),
    manualDom: (
      html: string,
      url: string | undefined,
      rules: ManualDomParseRulesV1
    ): Promise<
      | { ok: true; articles: unknown[] }
      | { ok: false; error: string }
    > => ipcRenderer.invoke('parse:manual-dom', html, url, rules),
    resolveArticleSplits: (
      rawText: string,
      title: string,
      articleFilter?: 'all' | 'with_sanctions' | 'without_sanctions'
    ): Promise<unknown[]> =>
      ipcRenderer.invoke('parse:resolve-article-splits', rawText, title, articleFilter),
    autoImportPreview: (
      html: string,
      url: string | undefined,
      title: string,
      forumScope?: 'first' | 'all',
      articleFilter?: 'all' | 'with_sanctions' | 'without_sanctions'
    ): Promise<{
      title: string
      documentTitle: string
      textLength: number
      textSource: string
      excerpt: string | null
      splits: unknown[]
    }> =>
      ipcRenderer.invoke(
        'parse:auto-import-preview',
        html,
        url,
        title,
        forumScope,
        articleFilter
      )
  },
  overlay: {
    show: (): Promise<void> => ipcRenderer.invoke('overlay:show'),
    toggle: (): Promise<void> => ipcRenderer.invoke('overlay:toggle'),
    hide: (): Promise<void> => ipcRenderer.invoke('overlay:hide'),
    dock: (
      where:
        | 'left'
        | 'right'
        | 'top-right'
        | 'center'
        | 'top-left'
        | 'bottom-left'
        | 'bottom-right'
        | 'compact-top-right'
        | 'wide-right'
    ): Promise<void> =>
      ipcRenderer.invoke('overlay:dock', where),
    raise: (): Promise<boolean> => ipcRenderer.invoke('overlay:raise'),
    applyGameProfile: (): Promise<{
      ok: true
      opacity: number
      clickThrough: boolean
      aotLevel: 'off' | 'floating' | 'screen-saver' | 'pop-up-menu'
      interactionMode: 'game' | 'interactive'
      dock: 'left' | 'right' | 'top-right' | 'center' | 'top-left' | 'bottom-left' | 'bottom-right' | 'compact-top-right' | 'wide-right'
      uiPrefs: {
        opacity?: number
        layoutPreset?: 'compact' | 'reading' | 'full'
        focusMode?: boolean
        fontScale?: number
        toolsExpanded?: boolean
        cheatSheetMode?: boolean
        articleListMode?: 'cards' | 'dense'
      }
    }> => ipcRenderer.invoke('overlay:apply-game-profile'),
    setAlwaysOnTopLevel: (level: 'off' | 'floating' | 'screen-saver' | 'pop-up-menu'): Promise<boolean> =>
      ipcRenderer.invoke('overlay:set-always-on-top-level', level),
    getInteractionMode: (): Promise<'game' | 'interactive'> => ipcRenderer.invoke('overlay:get-interaction-mode'),
    setInteractionMode: (mode: 'game' | 'interactive'): Promise<boolean> =>
      ipcRenderer.invoke('overlay:set-interaction-mode', mode),
    pin: (articleId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('overlay:pin-article', articleId),
    unpin: (articleId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('overlay:unpin-article', articleId),
    reorderPins: (orderedArticleIds: string[]): Promise<boolean> =>
      ipcRenderer.invoke('overlay:reorder-pins', orderedArticleIds),
    getPinned: (): Promise<unknown[]> => ipcRenderer.invoke('overlay:get-pinned'),
    setClickThrough: (enabled: boolean): void => ipcRenderer.send('overlay:set-click-through', enabled),
    getClickThrough: (): Promise<boolean> => ipcRenderer.invoke('overlay:get-click-through'),
    toggleClickThrough: (): Promise<boolean> => ipcRenderer.invoke('overlay:toggle-click-through'),
    setOpacity: (opacity: number): void => ipcRenderer.send('overlay:set-opacity', opacity),
    onPinsUpdated: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('overlay:pins-updated', handler)
      return () => ipcRenderer.removeListener('overlay:pins-updated', handler)
    },
    onFocusSearch: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('overlay:focus-search', handler)
      return () => ipcRenderer.removeListener('overlay:focus-search', handler)
    },
    onClickThroughChanged: (cb: (enabled: boolean) => void): (() => void) => {
      const handler = (_: unknown, enabled: boolean): void => cb(enabled)
      ipcRenderer.on('overlay:click-through-changed', handler)
      return () => ipcRenderer.removeListener('overlay:click-through-changed', handler)
    },
    onApplyUiPrefs: (
      cb: (prefs: {
        opacity?: number
        layoutPreset?: 'compact' | 'reading' | 'full'
        focusMode?: boolean
        fontScale?: number
        toolsExpanded?: boolean
        cheatSheetMode?: boolean
        articleListMode?: 'cards' | 'dense'
      }) => void
    ): (() => void) => {
      const handler = (
        _: unknown,
        prefs: {
          opacity?: number
          layoutPreset?: 'compact' | 'reading' | 'full'
          focusMode?: boolean
          fontScale?: number
          toolsExpanded?: boolean
          cheatSheetMode?: boolean
          articleListMode?: 'cards' | 'dense'
        }
      ): void => cb(prefs)
      ipcRenderer.on('overlay:apply-ui-prefs', handler)
      return () => ipcRenderer.removeListener('overlay:apply-ui-prefs', handler)
    }
  },
  toolOverlay: {
    show: (which: 'cheats' | 'collections'): Promise<void> => ipcRenderer.invoke('toolOverlay:show', which),
    hide: (which: 'cheats' | 'collections'): Promise<void> => ipcRenderer.invoke('toolOverlay:hide', which),
    toggle: (which: 'cheats' | 'collections'): Promise<void> => ipcRenderer.invoke('toolOverlay:toggle', which),
    raise: (which: 'cheats' | 'collections'): Promise<boolean> => ipcRenderer.invoke('toolOverlay:raise', which),
    dock: (which: 'cheats' | 'collections', where: 'left' | 'right' | 'top-right' | 'center'): Promise<void> =>
      ipcRenderer.invoke('toolOverlay:dock', which, where)
  },
  ai: {
    complete: (payload: AiCompletePayload): Promise<AiCompleteResult> =>
      ipcRenderer.invoke('ai:complete', payload),
    chatTurn: (payload: AiChatTurnPayload): Promise<AiCompleteResult> =>
      ipcRenderer.invoke('ai:chatTurn', payload),
    embeddings: {
      status: (cfg: AiProviderConfig): Promise<AiEmbeddingsStatus> =>
        ipcRenderer.invoke('ai:embeddings:status', cfg),
      rebuild: (cfg: AiProviderConfig): Promise<AiEmbeddingsProgress> =>
        ipcRenderer.invoke('ai:embeddings:rebuild', cfg),
      cancel: (): Promise<boolean> => ipcRenderer.invoke('ai:embeddings:cancel'),
      clear: (): Promise<boolean> => ipcRenderer.invoke('ai:embeddings:clear'),
      onProgress: (cb: (p: AiEmbeddingsProgress) => void): (() => void) => {
        const handler = (_: unknown, p: AiEmbeddingsProgress): void => cb(p)
        ipcRenderer.on('ai:embeddings:progress', handler)
        return () => ipcRenderer.removeListener('ai:embeddings:progress', handler)
      }
    }
  },
  aiChat: {
    list: (): Promise<AiConversationSummary[]> => ipcRenderer.invoke('aiChat:list'),
    create: (payload: AiChatCreatePayload): Promise<{ id: string }> => ipcRenderer.invoke('aiChat:create', payload),
    get: (id: string): Promise<AiChatGetResult | null> => ipcRenderer.invoke('aiChat:get', id),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('aiChat:delete', id),
    rename: (payload: { id: string; title: string }): Promise<boolean> =>
      ipcRenderer.invoke('aiChat:rename', payload),
    appendTurn: (payload: AiChatAppendTurnPayload): Promise<void> => ipcRenderer.invoke('aiChat:appendTurn', payload)
  },
  aiAgents: {
    list: (): Promise<AiAgentRecord[]> => ipcRenderer.invoke('aiAgents:list'),
    save: (row: Partial<AiAgentRecord> & { name: string }): Promise<{ id: string }> =>
      ipcRenderer.invoke('aiAgents:save', row),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('aiAgents:delete', id)
  },
  backup: {
    save: (): Promise<{ ok: boolean; path?: string; error?: string }> => ipcRenderer.invoke('db:backup'),
    restore: (): Promise<
      | { ok: true; path: string; exportedAt: string | null }
      | { ok: false; error?: string; cancelled?: boolean }
    > => ipcRenderer.invoke('db:restore')
  },
  shell: {
    openExternal: (url: string): void => ipcRenderer.send('app:open-external', url)
  },
  seed: {
    run: (): Promise<boolean> => ipcRenderer.invoke('seed:run')
  },
  collections: {
    list: (): Promise<ArticleCollectionRecord[]> => ipcRenderer.invoke('collections:list'),
    save: (row: ArticleCollectionSavePayload): Promise<{ ok: true; id: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('collections:save', row),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('collections:delete', id),
    getArticles: (collectionId: string): Promise<CollectionArticleRecord[]> =>
      ipcRenderer.invoke('collections:getArticles', collectionId),
    addArticle: (
      collectionId: string,
      articleId: string
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('collections:addArticle', collectionId, articleId),
    removeArticle: (collectionId: string, articleId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('collections:removeArticle', collectionId, articleId),
    reorderArticles: (collectionId: string, orderedArticleIds: string[]): Promise<boolean> =>
      ipcRenderer.invoke('collections:reorderArticles', collectionId, orderedArticleIds),
    onChanged: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('collections:changed', handler)
      return () => ipcRenderer.removeListener('collections:changed', handler)
    }
  },
  tags: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('tags:list')
  },
  articleTags: {
    get: (articleId: string): Promise<unknown[]> => ipcRenderer.invoke('articleTags:get', articleId),
    set: (articleId: string, tagNames: string[]): Promise<{ ok: true } | { ok: false; error?: string }> =>
      ipcRenderer.invoke('articleTags:set', articleId, tagNames)
  },
  seeAlso: {
    list: (fromArticleId: string): Promise<unknown[]> => ipcRenderer.invoke('seeAlso:list', fromArticleId),
    add: (
      fromArticleId: string,
      toArticleId: string
    ): Promise<{ ok: true; id: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('seeAlso:add', fromArticleId, toArticleId),
    remove: (linkId: string): Promise<boolean> => ipcRenderer.invoke('seeAlso:remove', linkId)
  },
  reader: {
    pushRecent: (articleId: string): Promise<boolean> => ipcRenderer.invoke('reader:pushRecent', articleId),
    listRecent: (limit?: number): Promise<BookmarkArticleRecord[]> => ipcRenderer.invoke('reader:listRecent', limit)
  },
  cheatSheets: {
    list: (): Promise<CheatSheetRecord[]> => ipcRenderer.invoke('cheatSheets:list'),
    get: (id: string): Promise<CheatSheetRecord | null> => ipcRenderer.invoke('cheatSheets:get', id),
    save: (row: CheatSheetSavePayload): Promise<{ ok: true; id: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('cheatSheets:save', row),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('cheatSheets:delete', id),
    onChanged: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('cheatSheets:changed', handler)
      return () => ipcRenderer.removeListener('cheatSheets:changed', handler)
    }
  }
}

contextBridge.exposeInMainWorld('lawHelper', api)

export type LexPatrolApi = typeof api
