import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { articleDisplayTitle } from '@shared/article-display'
import { ToolOverlayFrame } from './ToolOverlayFrame'

type CollectionRow = {
  id: string
  name: string
  description: string | null
  sort_order: number
  article_count?: number
}

type CollArticle = {
  id: string
  heading: string
  article_number: string | null
  document_id: string
  document_title: string
}

export function CollectionOverlayPage(): JSX.Element {
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [collectionId, setCollectionId] = useState<string>('')
  const [articles, setArticles] = useState<CollArticle[]>([])
  const [q, setQ] = useState('')
  const collectionIdRef = useRef('')

  const reloadArticlesFor = useCallback(async (id: string) => {
    if (!id) {
      setArticles([])
      return
    }
    const raw = await window.lawHelper.collections.getArticles(id)
    const rows = raw as CollArticle[]
    setArticles(Array.isArray(rows) ? rows : [])
  }, [])

  const refreshCollections = useCallback(async () => {
    const list = (await window.lawHelper.collections.list()) as CollectionRow[]
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
    return collections.filter((c) => c.name.toLowerCase().includes(s))
  }, [collections, q])

  useEffect(() => {
    if (filteredCols.length === 0) return
    if (!filteredCols.some((c) => c.id === collectionId)) setCollectionId(filteredCols[0]!.id)
  }, [filteredCols, collectionId])

  const activeCol = collections.find((c) => c.id === collectionId)

  return (
    <ToolOverlayFrame
      which="collections"
      title="LexPatrol · подборки"
      footerHint="Статья — открыть в читателе · список обновляется при добавлении в главном окне · Esc — скрыть"
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex shrink-0 gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/35 px-2 py-1.5 text-[11px] text-white outline-none placeholder:text-white/25 focus:border-accent/40"
            placeholder="Фильтр подборок…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
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
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,40%)_1fr]">
          <ul className="lex-overlay-scroll min-h-0 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/25 p-1">
            {filteredCols.length === 0 ? (
              <li className="px-2 py-4 text-center text-[11px] text-white/45">
                Нет подборок — создайте в LexPatrol → Подборки.
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
              <div className="text-[10px] font-medium text-white/90">{activeCol?.name ?? '—'}</div>
              {activeCol?.description ? (
                <div className="mt-0.5 text-[9px] text-white/45">{activeCol.description}</div>
              ) : null}
            </div>
            <ul className="lex-overlay-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1">
              {articles.length === 0 ? (
                <li className="px-2 py-4 text-center text-[11px] text-white/45">
                  {collectionId ? 'В подборке пока нет статей.' : 'Выберите подборку.'}
                </li>
              ) : (
                articles.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="w-full rounded-md border border-transparent px-2 py-2 text-left transition hover:border-white/10 hover:bg-white/[0.04]"
                      onClick={() => void window.lawHelper.openReader(a.document_id, a.id)}
                    >
                      <div className="text-[10px] text-accent/85">{a.document_title}</div>
                      <div className="mt-0.5 text-[11px] text-white/90">
                        {articleDisplayTitle(a.article_number, a.heading)}
                      </div>
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
