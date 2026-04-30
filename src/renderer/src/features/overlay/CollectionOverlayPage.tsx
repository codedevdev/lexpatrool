import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { articleDisplayTitle } from '@shared/article-display'
import type { ArticleCollectionRecord, CollectionArticleRecord } from '@shared/types'
import { ToolOverlayFrame } from './ToolOverlayFrame'

export function CollectionOverlayPage(): JSX.Element {
  const [collections, setCollections] = useState<ArticleCollectionRecord[]>([])
  const [collectionId, setCollectionId] = useState<string>('')
  const [articles, setArticles] = useState<CollectionArticleRecord[]>([])
  const [activeArticleId, setActiveArticleId] = useState<string>('')
  const [q, setQ] = useState('')
  const [articleQ, setArticleQ] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const collectionIdRef = useRef('')
  const collectionSearchRef = useRef<HTMLInputElement | null>(null)
  const articleSearchRef = useRef<HTMLInputElement | null>(null)

  const reloadArticlesFor = useCallback(async (id: string) => {
    if (!id) {
      setArticles([])
      setActiveArticleId('')
      return
    }
    const raw = await window.lawHelper.collections.getArticles(id)
    const rows = Array.isArray(raw) ? raw : []
    setArticles(rows)
    setActiveArticleId((cur) => {
      if (cur && rows.some((a) => a.id === cur)) return cur
      return rows[0]?.id ?? ''
    })
  }, [])

  const refreshCollections = useCallback(async () => {
    const list = await window.lawHelper.collections.list()
    const arr = Array.isArray(list) ? list : []
    setCollections(arr)
    setCollectionId((cur) => {
      if (cur && arr.some((c) => c.id === cur)) return cur
      return arr[0]?.id ?? ''
    })
  }, [])

  collectionIdRef.current = collectionId

  useEffect(() => {
    void refreshCollections()
  }, [refreshCollections])

  useEffect(() => {
    const off = window.lawHelper.collections.onChanged(() => {
      void refreshCollections()
      void reloadArticlesFor(collectionIdRef.current)
    })
    return () => off()
  }, [refreshCollections, reloadArticlesFor])

  useEffect(() => {
    void reloadArticlesFor(collectionId)
  }, [collectionId, reloadArticlesFor])

  const filteredCols = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return collections
    return collections.filter((c) => `${c.name}\n${c.description ?? ''}`.toLowerCase().includes(s))
  }, [collections, q])

  const filteredArticles = useMemo(() => {
    const s = articleQ.trim().toLowerCase()
    if (!s) return articles
    return articles.filter((a) => `${a.heading}\n${a.article_number ?? ''}\n${a.document_title}`.toLowerCase().includes(s))
  }, [articles, articleQ])

  useEffect(() => {
    if (filteredCols.length === 0) return
    if (!filteredCols.some((c) => c.id === collectionId)) setCollectionId(filteredCols[0]!.id)
  }, [filteredCols, collectionId])

  const activeCol = collections.find((c) => c.id === collectionId)
  const activeArticle = filteredArticles.find((a) => a.id === activeArticleId) ?? filteredArticles[0] ?? null
  const activeArticleIndex = filteredArticles.findIndex((a) => a.id === activeArticle?.id)

  useEffect(() => {
    if (filteredArticles.length === 0) {
      setActiveArticleId('')
      return
    }
    if (!filteredArticles.some((a) => a.id === activeArticleId)) {
      setActiveArticleId(filteredArticles[0]!.id)
    }
  }, [activeArticleId, filteredArticles])

  const selectCollectionRelative = useCallback(
    (delta: number): void => {
      if (filteredCols.length === 0) return
      const current = Math.max(0, filteredCols.findIndex((c) => c.id === collectionId))
      const next = (current + delta + filteredCols.length) % filteredCols.length
      setCollectionId(filteredCols[next]!.id)
      setArticleQ('')
    },
    [collectionId, filteredCols]
  )

  const selectArticleRelative = useCallback(
    (delta: number): void => {
      if (filteredArticles.length === 0) return
      const current = Math.max(0, activeArticleIndex)
      const next = (current + delta + filteredArticles.length) % filteredArticles.length
      setActiveArticleId(filteredArticles[next]!.id)
    },
    [activeArticleIndex, filteredArticles]
  )

  const openActiveArticle = useCallback((): void => {
    if (!activeArticle) return
    void window.lawHelper.openReader(activeArticle.document_id, activeArticle.id)
  }, [activeArticle])

  const copyActiveLabel = useCallback(async (): Promise<void> => {
    if (!activeArticle) return
    const label = `${activeCol?.name ? `${activeCol.name}: ` : ''}${articleDisplayTitle(
      activeArticle.article_number,
      activeArticle.heading
    )}`
    try {
      await navigator.clipboard.writeText(label)
      setStatus('название скопировано')
      window.setTimeout(() => setStatus(null), 1300)
    } catch {
      /* ignore */
    }
  }, [activeArticle, activeCol?.name])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        articleSearchRef.current?.focus()
        articleSearchRef.current?.select()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        collectionSearchRef.current?.focus()
        collectionSearchRef.current?.select()
        return
      }
      if (typing) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        selectArticleRelative(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        selectArticleRelative(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        selectCollectionRelative(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        selectCollectionRelative(-1)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        openActiveArticle()
      } else if (e.key.toLowerCase() === 'c') {
        e.preventDefault()
        void copyActiveLabel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [copyActiveLabel, openActiveArticle, selectArticleRelative, selectCollectionRelative])

  return (
    <ToolOverlayFrame
      which="collections"
      title="LexPatrol · подборки"
      subtitle={
        activeCol
          ? `${activeCol.name} · ${filteredArticles.length}/${articles.length} ст.${status ? ` · ${status}` : ''}`
          : 'сценарии и статьи поверх игры'
      }
      footerHint="Ctrl+F — статьи · Ctrl+P — подборки · ←/→ — подборка · ↑/↓ — статья · Enter — открыть · C — копировать"
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex shrink-0 gap-2">
          <input
            ref={collectionSearchRef}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/35 px-2 py-1.5 text-[11px] text-white outline-none placeholder:text-white/25 focus:border-accent/40"
            placeholder="Фильтр подборок…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="button"
            title="Предыдущая подборка"
            disabled={filteredCols.length < 2}
            onClick={() => selectCollectionRelative(-1)}
            className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] text-white/80 hover:bg-white/10 disabled:opacity-30"
          >
            ←
          </button>
          <button
            type="button"
            title="Следующая подборка"
            disabled={filteredCols.length < 2}
            onClick={() => selectCollectionRelative(1)}
            className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] text-white/80 hover:bg-white/10 disabled:opacity-30"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                await refreshCollections()
                await reloadArticlesFor(collectionIdRef.current)
              })()
            }}
            className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] text-white/80 hover:bg-white/10"
          >
            ↻
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,36%)_1fr]">
          <ul className="lex-overlay-scroll min-h-0 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/25 p-1">
            {filteredCols.length === 0 ? (
              <li className="px-2 py-4 text-center text-[11px] text-white/45">
                {collections.length === 0 ? 'Нет подборок — создайте в LexPatrol → Подборки.' : 'Нет подборок по фильтру.'}
              </li>
            ) : (
              filteredCols.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setCollectionId(c.id)}
                    className={`w-full rounded-md px-2 py-2 text-left text-[11px] transition ${
                      c.id === collectionId ? 'bg-accent/25 text-white' : 'text-app-muted hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className="block font-medium">{c.name}</span>
                    {c.description ? <span className="mt-0.5 block truncate text-[9px] text-white/35">{c.description}</span> : null}
                    {typeof c.article_count === 'number' ? (
                      <span className="mt-0.5 block text-[9px] text-white/40">{c.article_count} ст.</span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="flex min-h-0 flex-col rounded-lg border border-white/[0.06] bg-black/20">
            <div className="shrink-0 border-b border-white/[0.06] px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[10px] font-medium text-white/90">{activeCol?.name ?? '—'}</div>
                  {activeCol?.description ? (
                    <div className="mt-0.5 truncate text-[9px] text-white/45">{activeCol.description}</div>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={!activeArticle}
                    onClick={openActiveArticle}
                    className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 text-[9px] text-accent hover:bg-accent/20 disabled:opacity-30"
                  >
                    Открыть
                  </button>
                  <button
                    type="button"
                    disabled={!activeArticle}
                    onClick={() => void copyActiveLabel()}
                    className="rounded border border-white/10 px-2 py-0.5 text-[9px] text-white/70 hover:bg-white/10 disabled:opacity-30"
                  >
                    Copy
                  </button>
                </div>
              </div>
              {activeCol?.description ? (
                <div className="sr-only">{activeCol.description}</div>
              ) : null}
              <input
                ref={articleSearchRef}
                className="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-white outline-none placeholder:text-white/25 focus:border-accent/40"
                placeholder="Фильтр статей…"
                value={articleQ}
                onChange={(e) => setArticleQ(e.target.value)}
              />
            </div>
            <ul className="lex-overlay-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1">
              {articles.length === 0 ? (
                <li className="px-2 py-4 text-center text-[11px] text-white/45">
                  {collectionId ? 'В подборке пока нет статей.' : 'Выберите подборку.'}
                </li>
              ) : filteredArticles.length === 0 ? (
                <li className="px-2 py-4 text-center text-[11px] text-white/45">Нет статей по фильтру.</li>
              ) : (
                filteredArticles.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className={`w-full rounded-md border px-2 py-2 text-left transition ${
                        activeArticle?.id === a.id
                          ? 'border-accent/35 bg-accent/10'
                          : 'border-transparent hover:border-white/10 hover:bg-white/[0.04]'
                      }`}
                      onClick={() => setActiveArticleId(a.id)}
                      onDoubleClick={() => void window.lawHelper.openReader(a.document_id, a.id)}
                    >
                      <div className="flex items-center justify-between gap-2 text-[10px] text-accent/85">
                        <span className="truncate">{a.document_title}</span>
                        {activeArticle?.id === a.id ? <span className="shrink-0 text-[9px] text-white/40">Enter</span> : null}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-white/90">
                        {articleDisplayTitle(a.article_number, a.heading)}
                      </div>
                      {(a.summary_short || a.penalty_hint) ? (
                        <div className="mt-1 line-clamp-2 text-[9px] text-white/40">
                          {a.penalty_hint || a.summary_short}
                        </div>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </div>
    </ToolOverlayFrame>
  )
}
