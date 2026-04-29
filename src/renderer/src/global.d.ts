import type {
  ImportPayload,
  ReplaceDocumentImportPayload,
  AiProviderConfig,
  AiCompletePayload,
  AiAgentRecord,
  BrowserImportPayload,
  ManualDomParseRulesV1,
  ArticleUpdatePayload
} from '@shared/types'
import type React from 'react'

export {}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          partition?: string
          allowpopups?: string | boolean
        },
        HTMLElement
      >
    }
  }
  interface Window {
    lawHelper: {
      getVersion: () => Promise<string>
      update: {
        check: () => Promise<{
          currentVersion: string
          status: 'latest' | 'available' | 'error' | 'skipped'
          latestVersion?: string
          releaseUrl?: string
          downloadUrl?: string
          publishedAt?: string
          message?: string
        }>
        repoLabel: () => Promise<string>
        onAvailable: (
          cb: (p: {
            currentVersion: string
            latestVersion: string
            releaseUrl: string
            downloadUrl: string
            publishedAt?: string
            releaseNotes?: string
          }) => void
        ) => () => void
      }
      mainWindow: { setAlwaysOnTop: (enabled: boolean) => Promise<boolean> }
      openReader: (documentId: string, articleId?: string) => Promise<{ ok: boolean }>
      onOpenReader: (cb: (payload: { documentId: string; articleId?: string }) => void) => () => void
      settings: {
        get: (key: string) => Promise<string | null>
        set: (key: string, value: string) => Promise<boolean>
      }
      hotkeys: {
        get: () => Promise<{
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
        }>
        set: (
          partial: Partial<{
            toggle: string
            search: string
            clickThrough: string
            cheatsOverlay: string
            collectionsOverlay: string
          }>
        ) => Promise<
          | { ok: true }
          | { ok: false; error: 'duplicate' | 'invalid'; field?: string; detail?: string }
        >
        resetDefaults: () => Promise<{ ok: true }>
      }
      notes: {
        list: () => Promise<unknown[]>
        get: (id: string) => Promise<unknown>
        save: (payload: {
          id?: string
          article_id?: string | null
          scenario_key?: string | null
          title?: string | null
          body: string
        }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
        delete: (id: string) => Promise<{ ok: boolean }>
      }
      bookmarks: {
        list: () => Promise<unknown[]>
        has: (articleId: string) => Promise<boolean>
        add: (
          articleId: string
        ) => Promise<{ ok: true; bookmarkId: string } | { ok: false; error: string }>
        remove: (articleId: string) => Promise<{ ok: boolean }>
      }
      categories: { list: () => Promise<unknown[]> }
      stats: {
        summary: () => Promise<{ documentCount: number; articleCount: number }>
      }
      sources: { list: () => Promise<unknown[]> }
      documents: {
        list: () => Promise<unknown[]>
        get: (id: string) => Promise<unknown>
        update: (payload: { id: string; title: string }) => Promise<{ ok: boolean }>
        delete: (id: string) => Promise<{ ok: boolean }>
      }
      article: {
        get: (id: string) => Promise<unknown>
        update: (payload: ArticleUpdatePayload) => Promise<{ ok: boolean; error?: string }>
        delete: (id: string) => Promise<{ ok: boolean; error?: string }>
      }
      search: { query: (q: string, opts?: { tagIds?: string[] }) => Promise<unknown[]> }
      import: {
        payload: (payload: ImportPayload) => Promise<{ sourceId: string; documentId: string }>
        replaceDocument: (
          payload: ReplaceDocumentImportPayload
        ) => Promise<
          | {
              ok: true
              documentId: string
              stats: { inserted: number; updated: number; deleted: number; previousMarked: number }
            }
          | { ok: false; error: string }
        >
        browserPage: (
          payload: BrowserImportPayload
        ) => Promise<{ ok: true; sourceId: string; documentId: string } | { ok: false; error: string }>
      }
      parse: {
        html: (html: string, url?: string) => Promise<unknown>
        manualDom: (
          html: string,
          url: string | undefined,
          rules: ManualDomParseRulesV1
        ) => Promise<{ ok: true; articles: unknown[] } | { ok: false; error: string }>
        resolveArticleSplits: (rawText: string, title: string) => Promise<unknown[]>
        autoImportPreview: (
          html: string,
          url: string | undefined,
          title: string,
          forumScope?: 'first' | 'all'
        ) => Promise<{
          title: string
          documentTitle: string
          textLength: number
          textSource: string
          excerpt: string | null
          splits: unknown[]
        }>
      }
      overlay: {
        show: () => Promise<void>
        toggle: () => Promise<void>
        hide: () => Promise<void>
        raise: () => Promise<boolean>
        setAlwaysOnTopLevel: (
          level: 'off' | 'floating' | 'screen-saver' | 'pop-up-menu'
        ) => Promise<boolean>
        dock: (where: 'left' | 'right' | 'top-right' | 'center') => Promise<void>
        pin: (articleId: string) => Promise<
          { ok: true } | { ok: false; error?: 'invalid_id' | 'article_not_found' | 'database_error' }
        >
        unpin: (articleId: string) => Promise<
          { ok: true } | { ok: false; error?: 'invalid_id' | 'database_error' }
        >
        reorderPins: (orderedArticleIds: string[]) => Promise<boolean>
        getPinned: () => Promise<unknown[]>
        setClickThrough: (enabled: boolean) => void
        getClickThrough: () => Promise<boolean>
        toggleClickThrough: () => Promise<boolean>
        setOpacity: (opacity: number) => void
        onPinsUpdated: (cb: () => void) => () => void
        onFocusSearch: (cb: () => void) => () => void
        onClickThroughChanged: (cb: (enabled: boolean) => void) => () => void
      }
      toolOverlay: {
        show: (which: 'cheats' | 'collections') => Promise<void>
        hide: (which: 'cheats' | 'collections') => Promise<void>
        toggle: (which: 'cheats' | 'collections') => Promise<void>
        raise: (which: 'cheats' | 'collections') => Promise<boolean>
        dock: (which: 'cheats' | 'collections', where: 'left' | 'right' | 'top-right' | 'center') => Promise<void>
      }
      ai: {
        complete: (payload: AiCompletePayload) => Promise<{ text: string; citations: unknown[] }>
      }
      aiAgents: {
        list: () => Promise<AiAgentRecord[]>
        save: (row: Partial<AiAgentRecord> & { name: string }) => Promise<{ id: string }>
        delete: (id: string) => Promise<boolean>
      }
      backup: { save: () => Promise<{ ok: boolean; path?: string; error?: string }> }
      shell: { openExternal: (url: string) => void }
      seed: { run: () => Promise<boolean> }
      collections: {
        list: () => Promise<unknown[]>
        save: (row: {
          id?: string
          name: string
          description?: string | null
          sort_order?: number
        }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
        delete: (id: string) => Promise<boolean>
        getArticles: (collectionId: string) => Promise<unknown[]>
        addArticle: (
          collectionId: string,
          articleId: string
        ) => Promise<{ ok: true } | { ok: false; error: string }>
        removeArticle: (collectionId: string, articleId: string) => Promise<{ ok: boolean }>
        reorderArticles: (collectionId: string, orderedArticleIds: string[]) => Promise<boolean>
      }
      tags: { list: () => Promise<unknown[]> }
      articleTags: {
        get: (articleId: string) => Promise<unknown[]>
        set: (articleId: string, tagNames: string[]) => Promise<{ ok: true } | { ok: false; error?: string }>
      }
      seeAlso: {
        list: (fromArticleId: string) => Promise<unknown[]>
        add: (
          fromArticleId: string,
          toArticleId: string
        ) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
        remove: (linkId: string) => Promise<boolean>
      }
      reader: {
        pushRecent: (articleId: string) => Promise<boolean>
        listRecent: (limit?: number) => Promise<unknown[]>
      }
      cheatSheets: {
        list: () => Promise<unknown[]>
        get: (id: string) => Promise<unknown>
        save: (row: {
          id?: string
          title: string
          body: string
          sort_order?: number
        }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
        delete: (id: string) => Promise<boolean>
      }
    }
  }
}
