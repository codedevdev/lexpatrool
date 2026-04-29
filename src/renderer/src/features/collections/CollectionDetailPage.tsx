import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { articleDisplayTitle } from '@shared/article-display'

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

type SearchHit = {
  article_id: string
  document_id: string
  document_title: string
  heading: string
  snippet: string
}

export function CollectionDetailPage(): JSX.Element {
  const { collectionId } = useParams<{ collectionId: string }>()
  const cid = collectionId?.trim() ?? ''

  const [meta, setMeta] = useState<CollectionRow | null>(null)
  const [articles, setArticles] = useState<CollArticle[]>([])
  const [loadAttempted, setLoadAttempted] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [ftsQuery, setFtsQuery] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const qLive = useRef(q)
  qLive.current = q

  const refreshAll = useCallback(async (opts?: { soft?: boolean }) => {
    if (!cid) {
      setMeta(null)
      setArticles([])
      setLoadAttempted(true)
      return
    }
    if (!opts?.soft) setLoadAttempted(false)
    const list = (await window.lawHelper.collections.list()) as CollectionRow[]
    const arr = Array.isArray(list) ? list : []
    const m = arr.find((c) => c.id === cid) ?? null
    setMeta(m)
    if (m) {
      const raw = await window.lawHelper.collections.getArticles(cid)
      const rows = raw as CollArticle[]
      setArticles(Array.isArray(rows) ? rows : [])
    } else {
      setArticles([])
    }
    setLoadAttempted(true)
  }, [cid])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    const off = window.lawHelper.collections.onChanged(() => void refreshAll({ soft: true }))
    return () => off()
  }, [refreshAll])

  useEffect(() => {
    const qt = q.trim()
    if (!qt) {
      setHits([])
      setFtsQuery('')
      return
    }
    const t = setTimeout(() => {
      const sent = qLive.current.trim()
      if (!sent) return
      void window.lawHelper.search.query(qLive.current).then((h) => {
        if (qLive.current.trim() !== sent) return
        setHits(Array.isArray(h) ? (h as SearchHit[]) : [])
        setFtsQuery(sent)
      })
    }, 220)
    return () => clearTimeout(t)
  }, [q])

  const inCollection = useCallback(
    (articleId: string) => articles.some((a) => a.id === articleId),
    [articles]
  )

  async function addHit(hit: SearchHit): Promise<void> {
    if (!cid) return
    setHint(null)
    const r = await window.lawHelper.collections.addArticle(cid, hit.article_id)
    if (!r.ok) {
      setHint('Не удалось добавить статью.')
      return
    }
    setHint('Статья добавлена в подборку.')
    void refreshAll({ soft: true })
    window.setTimeout(() => setHint(null), 2500)
  }

  async function removeArticle(articleId: string): Promise<void> {
    if (!cid) return
    await window.lawHelper.collections.removeArticle(cid, articleId)
    void refreshAll({ soft: true })
  }

  if (!cid) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-app-muted">Не указана подборка.</p>
        <Link className="text-accent hover:underline" to="/collections">
          К списку подборок
        </Link>
      </div>
    )
  }

  if (!loadAttempted) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-app-muted">Загрузка…</p>
      </div>
    )
  }

  if (!meta) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-app-muted">Подборка не найдена.</p>
        <Link className="text-accent hover:underline" to="/collections">
          К списку подборок
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs text-app-muted">
            <Link className="text-accent hover:underline" to="/collections">
              Подборки
            </Link>
            <span className="text-white/30"> · </span>
            <span>{meta.name}</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-white">{meta.name}</h1>
          {meta.description ? <p className="mt-2 max-w-2xl text-sm text-app-muted">{meta.description}</p> : null}
          <p className="mt-2 text-xs text-white/40">
            Статей в подборке: {typeof meta.article_count === 'number' ? meta.article_count : articles.length}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void window.lawHelper.toolOverlay.toggle('collections')}
            className="rounded-xl border border-accent/35 bg-accent/15 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/25"
          >
            Окно подборок
          </button>
        </div>
      </header>

      {hint ? <p className="text-sm text-amber-200/90">{hint}</p> : null}

      <section className="glass rounded-2xl p-5">
        <h2 className="text-sm font-medium text-white">Добавить через поиск по базе</h2>
        <p className="mt-1 text-xs text-app-muted">
          Введите запрос — ниже появятся статьи из полнотекстового поиска. Уже входящие в подборку отмечены.
        </p>
        <input
          className="mt-3 w-full max-w-xl rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
          placeholder="Поиск по заголовкам и тексту статей…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {hits.length > 0 && ftsQuery === q.trim() ? (
          <ul className="mt-4 max-h-[min(50vh,28rem)] space-y-2 overflow-y-auto overscroll-contain pr-1">
            {hits.map((h) => {
              const already = inCollection(h.article_id)
              return (
                <li
                  key={h.article_id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-white/5 bg-surface-raised/60 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      className="text-accent hover:underline"
                      to={`/reader/${h.document_id}/${h.article_id}`}
                    >
                      {h.document_title} — {h.heading}
                    </Link>
                    <p className="mt-1 text-xs text-app-muted line-clamp-2">{h.snippet}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {already ? (
                      <span className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-app-muted">
                        Уже в подборке
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void addHit(h)}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-dim"
                      >
                        Добавить сюда
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : q.trim() && ftsQuery === q.trim() && hits.length === 0 ? (
          <p className="mt-3 text-sm text-app-muted">Нет совпадений по этому запросу.</p>
        ) : q.trim() && ftsQuery !== q.trim() ? (
          <p className="mt-3 text-sm text-app-muted">Ищем…</p>
        ) : null}
      </section>

      <section className="glass rounded-2xl p-5">
        <h2 className="text-sm font-medium text-white">Состав подборки</h2>
        {articles.length === 0 ? (
          <p className="mt-3 text-sm text-app-muted">Пока пусто — добавьте статьи из читателя или через поиск выше.</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/5">
            {articles.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link
                    className="text-white hover:text-accent"
                    to={`/reader/${a.document_id}/${a.id}`}
                  >
                    {articleDisplayTitle(a.article_number, a.heading)}
                  </Link>
                  <div className="text-xs text-app-muted">{a.document_title}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void removeArticle(a.id)}
                  className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-app-muted hover:bg-white/5"
                >
                  Убрать из подборки
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
