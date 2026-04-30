import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { articleDisplayTitle } from '@shared/article-display'
import type {
  ArticleCollectionRecord,
  BookmarkArticleRecord,
  CollectionArticleRecord,
  SearchHit
} from '@shared/types'

export function CollectionDetailPage(): JSX.Element {
  const { collectionId } = useParams<{ collectionId: string }>()
  const cid = collectionId?.trim() ?? ''

  const [meta, setMeta] = useState<ArticleCollectionRecord | null>(null)
  const [articles, setArticles] = useState<CollectionArticleRecord[]>([])
  const [bookmarks, setBookmarks] = useState<BookmarkArticleRecord[]>([])
  const [loadAttempted, setLoadAttempted] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [ftsQuery, setFtsQuery] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [articleFilter, setArticleFilter] = useState('')
  const [editingMeta, setEditingMeta] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
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
    const list = await window.lawHelper.collections.list()
    const arr = Array.isArray(list) ? list : []
    const m = arr.find((c) => c.id === cid) ?? null
    setMeta(m)
    if (m) {
      setEditName(m.name)
      setEditDesc(m.description ?? '')
    }
    if (m) {
      const raw = await window.lawHelper.collections.getArticles(cid)
      setArticles(Array.isArray(raw) ? raw : [])
    } else {
      setArticles([])
    }
    const bm = await window.lawHelper.bookmarks.list()
    setBookmarks(Array.isArray(bm) ? bm : [])
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

  async function addArticleFromBookmark(row: BookmarkArticleRecord): Promise<void> {
    if (!cid || inCollection(row.article_id)) return
    const r = await window.lawHelper.collections.addArticle(cid, row.article_id)
    if (r.ok) {
      setHint('Статья из закладок добавлена.')
      void refreshAll({ soft: true })
    } else {
      setHint('Не удалось добавить статью из закладок.')
    }
  }

  async function saveMeta(): Promise<void> {
    if (!meta) return
    const n = editName.trim()
    if (!n) {
      setHint('Название подборки не может быть пустым.')
      return
    }
    const r = await window.lawHelper.collections.save({
      id: meta.id,
      name: n,
      description: editDesc.trim() || null,
      sort_order: meta.sort_order
    })
    if (r.ok) {
      setEditingMeta(false)
      setHint('Описание подборки обновлено.')
      void refreshAll({ soft: true })
    } else {
      setHint('Не удалось сохранить описание.')
    }
  }

  async function moveArticle(articleId: string, direction: -1 | 1): Promise<void> {
    if (!cid) return
    const index = articles.findIndex((x) => x.id === articleId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= articles.length) return
    const ids = articles.map((a) => a.id)
    const tmp = ids[index]!
    ids[index] = ids[nextIndex]!
    ids[nextIndex] = tmp
    const ok = await window.lawHelper.collections.reorderArticles(cid, ids)
    if (ok) {
      setArticles((cur) => ids.map((id) => cur.find((a) => a.id === id)).filter((x): x is CollectionArticleRecord => Boolean(x)))
      setHint('Порядок статей обновлён.')
    } else {
      setHint('Не удалось изменить порядок статей.')
    }
  }

  const visibleArticles = articles.filter((a) => {
    const s = articleFilter.trim().toLowerCase()
    if (!s) return true
    return `${a.heading}\n${a.article_number ?? ''}\n${a.document_title}`.toLowerCase().includes(s)
  })

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
          {editingMeta ? (
            <div className="mt-2 grid max-w-2xl gap-2 sm:grid-cols-2">
              <input
                className="rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <input
                className="rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Описание"
              />
            </div>
          ) : (
            <>
              <h1 className="mt-1 text-2xl font-semibold text-white">{meta.name}</h1>
              {meta.description ? <p className="mt-2 max-w-2xl text-sm text-app-muted">{meta.description}</p> : null}
            </>
          )}
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
          {editingMeta ? (
            <button
              type="button"
              onClick={() => void saveMeta()}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim"
            >
              Сохранить
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditingMeta(true)}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-app-muted hover:bg-white/5"
            >
              Редактировать
            </button>
          )}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white">Быстро из закладок</h2>
            <p className="mt-1 text-xs text-app-muted">Полезно, когда сначала отмечаете статьи в читателе, а потом собираете сменную подборку.</p>
          </div>
        </div>
        {bookmarks.length === 0 ? (
          <p className="mt-3 text-sm text-app-muted">Закладок пока нет.</p>
        ) : (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {bookmarks.slice(0, 8).map((b) => {
              const already = inCollection(b.article_id)
              return (
                <li key={b.id} className="rounded-lg border border-white/5 bg-surface-raised/50 p-3">
                  <div className="line-clamp-2 text-sm text-white">
                    {articleDisplayTitle(b.article_number, b.heading)}
                  </div>
                  <div className="mt-1 line-clamp-1 text-xs text-app-muted">{b.document_title}</div>
                  <button
                    type="button"
                    disabled={already}
                    onClick={() => void addArticleFromBookmark(b)}
                    className="mt-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/20 disabled:border-white/10 disabled:bg-transparent disabled:text-white/35"
                  >
                    {already ? 'Уже в подборке' : 'Добавить'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="glass rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-white">Состав подборки</h2>
          <input
            className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-1.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-accent/40 sm:w-72"
            placeholder="Фильтр внутри подборки…"
            value={articleFilter}
            onChange={(e) => setArticleFilter(e.target.value)}
          />
        </div>
        {articles.length === 0 ? (
          <p className="mt-3 text-sm text-app-muted">Пока пусто — добавьте статьи из читателя или через поиск выше.</p>
        ) : visibleArticles.length === 0 ? (
          <p className="mt-3 text-sm text-app-muted">В составе нет совпадений по фильтру.</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/5">
            {visibleArticles.map((a) => (
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
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void moveArticle(a.id, -1)}
                    disabled={articles.findIndex((x) => x.id === a.id) === 0}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-app-muted hover:bg-white/5 disabled:opacity-30"
                  >
                    Вверх
                  </button>
                  <button
                    type="button"
                    onClick={() => void moveArticle(a.id, 1)}
                    disabled={articles.findIndex((x) => x.id === a.id) === articles.length - 1}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-app-muted hover:bg-white/5 disabled:opacity-30"
                  >
                    Вниз
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeArticle(a.id)}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-app-muted hover:bg-white/5"
                  >
                    Убрать
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
