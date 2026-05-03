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
          critical?: boolean
          setupAsset?: { name: string; size: number; browser_download_url: string }
        }>
        repoLabel: () => Promise<string>
        download: () => Promise<{ ok: true } | { ok: false; message: string }>
        cancelDownload: () => Promise<{ ok: true }>
        getPhase: () => Promise<{ phase: string; reason: string | null }>
        apply: (payload: {
          silent: boolean
          route?: string
          reader?: { documentId: string; articleId?: string }
        }) => Promise<{ ok: true } | { ok: false; message: string }>
        snoozeStatus: (latestVersion: string) => Promise<{ count: number; exhausted: boolean }>
        snooze: (latestVersion: string) => Promise<{ ok: true; count: number; blocked: boolean } | { ok: false; count: number; blocked: boolean }>
        inAppAvailable: () => Promise<{ supported: boolean }>
        onPhase: (cb: (p: { phase: string; reason: string | null }) => void) => () => void
        onProgress: (
          cb: (p: {
            received: number
            total: number | null
            percent: number | null
            bytesPerSecond: number | null
          }) => void
        ) => () => void
        onAfterUpdate: (
          cb: (p: {
            oldVersion: string
            newVersion: string
            releaseUrl: string
            route?: string
            reader?: { documentId: string; articleId?: string }
          }) => void
        ) => () => void
        onAvailable: (
          cb: (p: {
            currentVersion: string
            latestVersion: string
            releaseUrl: string
            downloadUrl: string
            publishedAt?: string
            releaseNotes?: string
            critical?: boolean
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
          registration: {
            toggle: boolean
            search: boolean
            clickThrough: boolean
            cheatsOverlay: boolean
            collectionsOverlay: boolean
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
        list: () => Promise<UserNoteRecord[]>
        get: (id: string) => Promise<UserNoteRecord | null>
        save: (payload: UserNoteSavePayload) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
        delete: (id: string) => Promise<{ ok: boolean }>
        onChanged: (cb: () => void) => () => void
      }
      bookmarks: {
        list: () => Promise<BookmarkArticleRecord[]>
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
        resolveArticleSplits: (
          rawText: string,
          title: string,
          articleFilter?: 'all' | 'with_sanctions' | 'without_sanctions'
        ) => Promise<unknown[]>
        autoImportPreview: (
          html: string,
          url: string | undefined,
          title: string,
          forumScope?: 'first' | 'all',
          articleFilter?: 'all' | 'with_sanctions' | 'without_sanctions'
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
        applyGameProfile: () => Promise<{
          ok: true
          opacity: number
          clickThrough: boolean
          aotLevel: 'off' | 'floating' | 'screen-saver' | 'pop-up-menu'
          interactionMode: 'game' | 'interactive'
          dock:
            | 'left'
            | 'right'
            | 'top-right'
            | 'center'
            | 'top-left'
            | 'bottom-left'
            | 'bottom-right'
            | 'compact-top-right'
            | 'wide-right'
          uiPrefs: {
            opacity?: number
            layoutPreset?: 'compact' | 'reading' | 'full'
            focusMode?: boolean
            fontScale?: number
            overlayBrightness?: number
            cheatSheetMode?: boolean
            articleListMode?: 'cards' | 'dense'
          }
        }>
        setAlwaysOnTopLevel: (
          level: 'off' | 'floating' | 'screen-saver' | 'pop-up-menu'
        ) => Promise<boolean>
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
        ) => Promise<void>
        applyLayoutPreset: (preset: 'compact' | 'reading' | 'full') => Promise<{ ok: true }>
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
        getInteractionMode: () => Promise<'game' | 'interactive'>
        setInteractionMode: (mode: 'game' | 'interactive') => Promise<boolean>
        onPinsUpdated: (cb: () => void) => () => void
        onFocusSearch: (cb: () => void) => () => void
        onClickThroughChanged: (cb: (enabled: boolean) => void) => () => void
        onApplyUiPrefs: (
          cb: (prefs: {
            opacity?: number
            layoutPreset?: 'compact' | 'reading' | 'full'
            focusMode?: boolean
            fontScale?: number
            overlayBrightness?: number
            cheatSheetMode?: boolean
            articleListMode?: 'cards' | 'dense'
          }) => void
        ) => () => void
      }
      toolOverlay: {
        show: (which: 'cheats' | 'collections') => Promise<void>
        hide: (which: 'cheats' | 'collections') => Promise<void>
        toggle: (which: 'cheats' | 'collections') => Promise<void>
        raise: (which: 'cheats' | 'collections') => Promise<boolean>
        dock: (which: 'cheats' | 'collections', where: 'left' | 'right' | 'top-right' | 'center') => Promise<void>
      }
      ai: {
        complete: (payload: AiCompletePayload) => Promise<AiCompleteResult>
        chatTurn: (payload: AiChatTurnPayload) => Promise<AiCompleteResult>
        embeddings: {
          status: (cfg: AiProviderConfig) => Promise<AiEmbeddingsStatus>
          rebuild: (cfg: AiProviderConfig) => Promise<AiEmbeddingsProgress>
          cancel: () => Promise<boolean>
          clear: () => Promise<boolean>
          onProgress: (cb: (p: AiEmbeddingsProgress) => void) => () => void
        }
      }
      aiChat: {
        list: () => Promise<AiConversationSummary[]>
        create: (payload: AiChatCreatePayload) => Promise<{ id: string }>
        get: (id: string) => Promise<AiChatGetResult | null>
        delete: (id: string) => Promise<boolean>
        rename: (payload: { id: string; title: string }) => Promise<boolean>
        appendTurn: (payload: AiChatAppendTurnPayload) => Promise<void>
      }
      aiAgents: {
        list: () => Promise<AiAgentRecord[]>
        save: (row: Partial<AiAgentRecord> & { name: string }) => Promise<{ id: string }>
        delete: (id: string) => Promise<boolean>
      }
      backup: {
        save: () => Promise<{ ok: boolean; path?: string; error?: string }>
        restore: () => Promise<
          | { ok: true; path: string; exportedAt: string | null }
          | { ok: false; error?: string; cancelled?: boolean }
        >
      }
      shell: { openExternal: (url: string) => void }
      seed: { run: () => Promise<boolean> }
      collections: {
        list: () => Promise<ArticleCollectionRecord[]>
        save: (row: ArticleCollectionSavePayload) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
        delete: (id: string) => Promise<boolean>
        getArticles: (collectionId: string) => Promise<CollectionArticleRecord[]>
        addArticle: (
          collectionId: string,
          articleId: string
        ) => Promise<{ ok: true } | { ok: false; error: string }>
        removeArticle: (collectionId: string, articleId: string) => Promise<{ ok: boolean }>
        reorderArticles: (collectionId: string, orderedArticleIds: string[]) => Promise<boolean>
        onChanged: (cb: () => void) => () => void
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
        listRecent: (limit?: number) => Promise<BookmarkArticleRecord[]>
      }
      cheatSheets: {
        list: () => Promise<CheatSheetRecord[]>
        get: (id: string) => Promise<CheatSheetRecord | null>
        save: (row: CheatSheetSavePayload) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
        delete: (id: string) => Promise<boolean>
        onChanged: (cb: () => void) => () => void
      }
    }
  }
}
