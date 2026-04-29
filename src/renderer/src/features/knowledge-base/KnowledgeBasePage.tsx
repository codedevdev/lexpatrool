import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { extractSearchTokens } from '@shared/search-tokens'

/** Строка из query — стабильная зависимость, без лишних синков при смене объекта searchParams. */
function useSearchQueryParam(key: string): string {
  const [searchParams] = useSearchParams()
  return searchParams.get(key) ?? ''
}

interface DocRow {
  id: string
  title: string
  updated_at: string
  source_title?: string | null
}

export function KnowledgeBasePage(): JSX.Element {
  const qFromUrl = useSearchQueryParam('q')
  const [q, setQ] = useState(() => qFromUrl)
  const [docs, setDocs] = useState<DocRow[]>([])
  const [hits, setHits] = useState<
    {
      article_id: string
      document_id: string
      document_title: string
      heading: string
      snippet: string
    }[]
  >([])

  /** Запрос, для которого загружен массив `hits` (чтобы не смешивать старые FTS с новой строкой поиска). */
  const [ftsQuery, setFtsQuery] = useState('')
  const qLive = useRef(q)
  qLive.current = q

  useEffect(() => {
    setQ(qFromUrl)
  }, [qFromUrl])

  useEffect(() => {
    void window.lawHelper.documents.list().then((rows) => setDocs(rows as DocRow[]))
  }, [])

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
        setHits(
          h as {
            article_id: string
            document_id: string
            document_title: string
            heading: string
            snippet: string
          }[]
        )
        setFtsQuery(sent)
      })
    }, 200)
    return () => clearTimeout(t)
  }, [q])

  const filtered = useMemo(() => {
    if (!q.trim()) return docs
    const qt = q.trim()
    const tokens = extractSearchTokens(q)
    const titleMatches = (d: DocRow): boolean => {
      if (!tokens.length) {
        const s = qt.toLowerCase()
        return d.title.toLowerCase().includes(s)
      }
      const t = d.title.toLowerCase()
      return tokens.some((tok) => t.includes(tok.toLowerCase()))
    }
    const idsFromFts =
      ftsQuery === qt ? new Set(hits.map((h) => h.document_id)) : new Set<string>()
    const matched = docs.filter((d) => titleMatches(d) || idsFromFts.has(d.id))
    return [...matched].sort((a, b) => {
      const ah = idsFromFts.has(a.id) ? 0 : 1
      const bh = idsFromFts.has(b.id) ? 0 : 1
      if (ah !== bh) return ah - bh
      return a.title.localeCompare(b.title, 'ru')
    })
  }, [docs, q, hits, ftsQuery])

  async function removeDoc(id: string, title: string): Promise<void> {
    if (!confirm(`Удалить документ «${title}» и все его статьи из базы? Это необратимо.`)) return
    const r = await window.lawHelper.documents.delete(id)
    if (r.ok) {
      setDocs((prev) => prev.filter((d) => d.id !== id))
      setHits((prev) => prev.filter((h) => h.document_id !== id))
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">База знаний</h1>
          <p className="mt-2 text-sm text-app-muted">
            Поиск по заголовкам и полному тексту статей, которые вы добавили в базу.
          </p>
        </div>
        <input
          className="w-full max-w-md rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent md:w-80"
          placeholder="Поиск по заголовкам и тексту…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </header>

      {hits.length > 0 && (
        <section className="glass rounded-2xl p-5">
          <h2 className="text-sm font-medium text-white">Совпадения по тексту</h2>
          <ul className="mt-3 max-h-[min(42vh,22rem)] space-y-3 overflow-y-auto overscroll-contain pr-1">
            {hits.map((h) => (
              <li key={h.article_id} className="rounded-lg border border-white/5 bg-surface-raised/60 p-3">
                <Link className="text-accent hover:underline" to={`/reader/${h.document_id}/${h.article_id}`}>
                  {h.document_title} — {h.heading}
                </Link>
                <p className="mt-1 text-xs text-app-muted line-clamp-2">{h.snippet}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="glass rounded-2xl p-5">
        <h2 className="text-sm font-medium text-white">Все документы</h2>
        {q.trim() ? (
          <p className="mt-1 text-xs text-app-muted">
            Показаны документы, у которых в названии есть запрос, или внутри которых полнотекстовый поиск нашёл совпадения
            по статьям.
          </p>
        ) : null}
        {q.trim() && filtered.length === 0 ? (
          <p className="mt-3 text-sm text-app-muted">
            Нет документов по этому запросу (ни по названию, ни по тексту статей внутри).
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/5">
            {filtered.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link className="text-white hover:text-accent" to={`/reader/${d.id}`}>
                    {d.title}
                  </Link>
                  <div className="text-xs text-app-muted">{d.source_title ?? 'Локальный импорт'}</div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className="text-xs text-app-muted">{new Date(d.updated_at).toLocaleString()}</span>
                  <Link
                    className="rounded-lg border border-white/10 px-2 py-1 text-xs text-app-muted hover:bg-white/5"
                    to={`/import?replace=${encodeURIComponent(d.id)}`}
                    title="Обновить вставкой текста или HTML"
                  >
                    Обновить
                  </Link>
                  <Link
                    className="rounded-lg border border-accent/35 bg-accent/10 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/20"
                    to={`/browser?replace=${encodeURIComponent(d.id)}`}
                    title="Обновить страницей из встроенного браузера"
                  >
                    Браузер
                  </Link>
                  <button
                    type="button"
                    title="Удалить документ из базы"
                    onClick={() => void removeDoc(d.id, d.title)}
                    className="rounded-lg border border-red-500/30 px-2 py-1 text-xs text-red-300/90 hover:bg-red-500/10"
                  >
                    Удалить
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
