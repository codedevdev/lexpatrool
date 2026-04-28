import { contextBridge, ipcRenderer } from 'electron'
import type {
  ImportPayload,
  AiProviderConfig,
  AiCompletePayload,
  AiAgentRecord,
  BrowserImportPayload,
  ManualDomParseRulesV1,
  ArticleUpdatePayload
} from '../shared/types'

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
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
      display: { toggle: string; search: string; clickThrough: string }
    }> => ipcRenderer.invoke('hotkeys:get'),
    set: (
      partial: Partial<{ toggle: string; search: string; clickThrough: string }>
    ): Promise<
      | { ok: true }
      | { ok: false; error: 'duplicate' | 'invalid'; field?: string; detail?: string }
    > => ipcRenderer.invoke('hotkeys:set', partial),
    resetDefaults: (): Promise<{ ok: true }> => ipcRenderer.invoke('hotkeys:reset-defaults')
  },
  notes: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('notes:list'),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('notes:get', id),
    save: (payload: {
      id?: string
      article_id?: string | null
      scenario_key?: string | null
      title?: string | null
      body: string
    }): Promise<{ ok: true; id: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('notes:save', payload),
    delete: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('notes:delete', id)
  },
  bookmarks: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('bookmarks:list'),
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
    query: (q: string): Promise<unknown[]> => ipcRenderer.invoke('search:query', q)
  },
  import: {
    payload: (payload: ImportPayload): Promise<{ sourceId: string; documentId: string }> =>
      ipcRenderer.invoke('import:payload', payload),
    browserPage: (payload: BrowserImportPayload): Promise<{ sourceId: string; documentId: string }> =>
      ipcRenderer.invoke('browser:import-current', payload)
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
    resolveArticleSplits: (rawText: string, title: string): Promise<unknown[]> =>
      ipcRenderer.invoke('parse:resolve-article-splits', rawText, title),
    autoImportPreview: (
      html: string,
      url: string | undefined,
      title: string,
      forumScope?: 'first' | 'all'
    ): Promise<{
      title: string
      documentTitle: string
      textLength: number
      textSource: string
      excerpt: string | null
      splits: unknown[]
    }> => ipcRenderer.invoke('parse:auto-import-preview', html, url, title, forumScope)
  },
  overlay: {
    show: (): Promise<void> => ipcRenderer.invoke('overlay:show'),
    toggle: (): Promise<void> => ipcRenderer.invoke('overlay:toggle'),
    hide: (): Promise<void> => ipcRenderer.invoke('overlay:hide'),
    dock: (where: 'left' | 'right' | 'top-right' | 'center'): Promise<void> =>
      ipcRenderer.invoke('overlay:dock', where),
    raise: (): Promise<boolean> => ipcRenderer.invoke('overlay:raise'),
    setAlwaysOnTopLevel: (level: 'off' | 'floating' | 'screen-saver' | 'pop-up-menu'): Promise<boolean> =>
      ipcRenderer.invoke('overlay:set-always-on-top-level', level),
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
    }
  },
  ai: {
    complete: (payload: AiCompletePayload): Promise<{ text: string; citations: unknown[] }> =>
      ipcRenderer.invoke('ai:complete', payload)
  },
  aiAgents: {
    list: (): Promise<AiAgentRecord[]> => ipcRenderer.invoke('aiAgents:list'),
    save: (row: Partial<AiAgentRecord> & { name: string }): Promise<{ id: string }> =>
      ipcRenderer.invoke('aiAgents:save', row),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('aiAgents:delete', id)
  },
  backup: {
    save: (): Promise<{ ok: boolean; path?: string }> => ipcRenderer.invoke('db:backup')
  },
  shell: {
    openExternal: (url: string): void => ipcRenderer.send('app:open-external', url)
  },
  seed: {
    run: (): Promise<boolean> => ipcRenderer.invoke('seed:run')
  }
}

contextBridge.exposeInMainWorld('lawHelper', api)

export type LexPatrolApi = typeof api
