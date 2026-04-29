import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

type SearchHit = {
  article_id: string
  document_id: string
  document_title: string
  heading: string
  snippet: string
}

type RecentRow = {
  id: string
  document_id: string
  document_title: string
  heading: string
  article_number: string | null
  opened_at: string
}

export function CommandPalette(): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [recent, setRecent] = useState<RecentRow[]>([])
  const navigate = useNavigate()

  const loadRecent = useCallback(async () => {
    const rows = (await window.lawHelper.reader.listRecent(12)) as RecentRow[]
    setRecent(Array.isArray(rows) ? rows : [])
  }, [])

  useEffect(() => {
    if (!open) return
    void loadRecent()
  }, [open, loadRecent])

  useEffect(() => {
    const t = setTimeout(() => {
      const s = q.trim()
      if (s.length < 2) {
        setHits([])
        return
      }
      void window.lawHelper.search.query(s).then((raw) => setHits(raw as SearchHit[]))
    }, 220)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      const inField = tag === 'INPUT' || tag === 'TEXTAREA'
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        if (inField && !open) return
        e.preventDefault()
        setOpen((o) => !o)
        if (open) setQ('')
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
        setQ('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const title = useMemo(() => (open ? 'Переход по базе' : ''), [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/55 px-3 py-16 backdrop-blur-sm"
      role="dialog"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          setOpen(false)
          setQ('')
        }
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#0c1016] shadow-2xl">
        <div className="border-b border-white/10 px-3 py-2 text-[10px] uppercase tracking-wide text-app-muted">
          Ctrl+K · поиск и недавние
        </div>
        <input
          autoFocus
          className="w-full border-0 bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-white/30"
          placeholder="Поиск по статьям…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="max-h-[min(50vh,20rem)] overflow-y-auto border-t border-white/5 lex-app-scroll">
          {q.trim().length < 2 && recent.length > 0 ? (
            <div>
              <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-white/40">
                Недавно
              </div>
              <ul>
                {recent.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5"
                      onClick={() => {
                        navigate(`/reader/${r.document_id}/${r.id}`)
                        setOpen(false)
                        setQ('')
                      }}
                    >
                      <div className="truncate text-white/95">{r.heading}</div>
                      <div className="truncate text-xs text-app-muted">{r.document_title}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {hits.length > 0 ? (
            <ul>
              {hits.slice(0, 14).map((h) => (
                <li key={h.article_id}>
                  <button
                    type="button"
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5"
                    onClick={() => {
                      navigate(`/reader/${h.document_id}/${h.article_id}`)
                      setOpen(false)
                      setQ('')
                    }}
                  >
                    <div className="truncate text-white/95">{h.heading}</div>
                    <div className="truncate text-xs text-app-muted">{h.document_title}</div>
                  </button>
                </li>
              ))}
            </ul>
          ) : q.trim().length >= 2 ? (
            <p className="px-4 py-6 text-center text-sm text-app-muted">Ничего не найдено</p>
          ) : null}
        </div>
        <div className="border-t border-white/5 px-3 py-2 text-[10px] text-white/35">Esc — закрыть</div>
      </div>
    </div>
  )
}
