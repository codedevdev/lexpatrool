import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { articleDisplayTitle } from '@shared/article-display'

interface NoteRow {
  id: string
  article_id: string | null
  scenario_key: string | null
  title: string | null
  body: string
  updated_at: string
  article_heading: string | null
  article_number: string | null
  document_id: string | null
  document_title: string | null
}

interface BookmarkRow {
  id: string
  article_id: string
  created_at: string
  heading: string
  article_number: string | null
  document_id: string
  document_title: string
}

interface SearchHitLite {
  article_id: string
  document_id: string
  document_title: string
  heading: string
  article_number: string | null
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function NotesPage(): JSX.Element {
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [scenarioKey, setScenarioKey] = useState('')
  const [body, setBody] = useState('')
  const [articleId, setArticleId] = useState<string | null>(null)
  const [articleLabel, setArticleLabel] = useState<string | null>(null)
  const [articleQuery, setArticleQuery] = useState('')
  const [articleHits, setArticleHits] = useState<SearchHitLite[]>([])
  const [articleOpen, setArticleOpen] = useState(false)
  const [saveHint, setSaveHint] = useState<string | null>(null)

  const loadAll = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [n, b] = await Promise.all([
        window.lawHelper.notes.list() as Promise<NoteRow[]>,
        window.lawHelper.bookmarks.list() as Promise<BookmarkRow[]>
      ])
      setNotes(Array.isArray(n) ? n : [])
      setBookmarks(Array.isArray(b) ? b : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    const q = articleQuery.trim()
    if (q.length < 2) {
      setArticleHits([])
      return
    }
    const t = setTimeout(() => {
      void window.lawHelper.search.query(q).then((raw) => {
        const hits = raw as SearchHitLite[]
        setArticleHits(Array.isArray(hits) ? hits.slice(0, 12) : [])
      })
    }, 220)
    return () => clearTimeout(t)
  }, [articleQuery])

  const selectedNote = useMemo(() => notes.find((x) => x.id === selectedId) ?? null, [notes, selectedId])

  function resetEditor(): void {
    setSelectedId(null)
    setTitle('')
    setScenarioKey('')
    setBody('')
    setArticleId(null)
    setArticleLabel(null)
    setArticleQuery('')
    setArticleHits([])
    setArticleOpen(false)
    setSaveHint(null)
  }

  function openNote(row: NoteRow): void {
    setSelectedId(row.id)
    setTitle(row.title ?? '')
    setScenarioKey(row.scenario_key ?? '')
    setBody(row.body)
    setArticleId(row.article_id)
    setArticleLabel(
      row.article_id && row.article_heading
        ? articleDisplayTitle(row.article_number, row.article_heading)
        : null
    )
    setArticleQuery('')
    setArticleHits([])
    setArticleOpen(false)
    setSaveHint(null)
  }

  async function saveNote(): Promise<void> {
    const trimmed = body.trim()
    if (!trimmed) {
      setSaveHint('Текст заметки не может быть пустым.')
      return
    }
    setSaveHint(null)
    const r = await window.lawHelper.notes.save({
      id: selectedId ?? undefined,
      title: title.trim() || null,
      scenario_key: scenarioKey.trim() || null,
      article_id: articleId,
      body: trimmed
    })
    if (!r.ok) {
      setSaveHint(r.error === 'bad_article' ? 'Статья не найдена в базе.' : 'Не удалось сохранить.')
      return
    }
    await loadAll()
    setSelectedId(r.id)
    setSaveHint('Сохранено.')
  }

  async function deleteNote(): Promise<void> {
    if (!selectedId) return
    if (!confirm('Удалить эту заметку?')) return
    await window.lawHelper.notes.delete(selectedId)
    resetEditor()
    await loadAll()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-4 md:space-y-5">
      <header className="border-b border-white/[0.06] pb-3">
        <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Заметки и закладки</h1>
        <p className="mt-1 max-w-2xl text-xs leading-snug text-app-muted md:text-[13px]">
          Избранные статьи и текстовые заметки; к заметке можно привязать статью из базы.
        </p>
      </header>

      <details className="glass rounded-xl border border-white/[0.06] px-3 py-2 sm:px-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-white [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            Закладки
            <span className="rounded-md bg-white/[0.06] px-1.5 py-px text-[11px] font-normal tabular-nums text-app-muted">
              {loading ? '…' : bookmarks.length}
            </span>
          </span>
          <span className="text-[11px] text-app-muted">▼</span>
        </summary>
        <div className="border-t border-white/[0.06] pt-3">
          <p className="mb-2 text-[11px] leading-snug text-app-muted">Из читателя или базы знаний.</p>
          {loading ? (
            <p className="text-sm text-app-muted">Загрузка…</p>
          ) : bookmarks.length === 0 ? (
            <p className="text-xs text-app-muted">Пока нет — отметьте статью в читателе или в базе.</p>
          ) : (
            <ul className="max-h-[min(200px,28vh)] divide-y divide-white/[0.06] overflow-y-auto rounded-lg border border-white/[0.08]">
              {bookmarks.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate text-white/90">{articleDisplayTitle(b.article_number, b.heading)}</div>
                    <div className="text-[11px] text-app-muted">{fmtDate(b.created_at)}</div>
                  </div>
                  <Link
                    to={`/reader/${b.document_id}/${b.article_id}`}
                    className="shrink-0 rounded-md border border-accent/35 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20"
                  >
                    Открыть
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(220px,30%)_minmax(0,1fr)] xl:items-start xl:gap-5">
        <section className="glass rounded-xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">Мои заметки</h2>
            <button
              type="button"
              onClick={() => resetEditor()}
              className="rounded-lg border border-white/10 bg-surface-raised px-2.5 py-1 text-[11px] text-white hover:bg-surface-hover sm:px-3 sm:text-xs"
            >
              Новая
            </button>
          </div>
          {loading ? (
            <p className="mt-3 text-sm text-app-muted">Загрузка…</p>
          ) : notes.length === 0 ? (
            <p className="mt-3 text-xs leading-snug text-app-muted">
              Пока нет — нажмите «Новая» и заполните форму ниже.
            </p>
          ) : (
            <ul className="mt-3 max-h-[min(280px,38vh)] space-y-1 overflow-y-auto overflow-x-hidden pr-0.5 sm:max-h-[min(320px,42vh)]">
              {notes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openNote(n)}
                    className={`w-full rounded-lg border px-2.5 py-2 text-left text-sm transition ${
                      selectedId === n.id
                        ? 'border-accent/40 bg-accent/10 text-white'
                        : 'border-white/10 bg-black/20 text-app-muted hover:border-white/15 hover:text-white/90'
                    }`}
                  >
                    <div className="line-clamp-1 font-medium text-white/95">
                      {n.title?.trim() || n.body.trim().split('\n')[0]?.slice(0, 72) || 'Без названия'}
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-[11px] text-app-muted">
                      {n.article_heading ? `↳ ${n.article_heading}` : 'Без статьи'} · {fmtDate(n.updated_at)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass space-y-3 rounded-xl p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-white">{selectedId ? 'Редактирование' : 'Новая заметка'}</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-[11px] text-app-muted">
              Заголовок <span className="text-app-muted/70">(необяз.)</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                placeholder="Например: перед обыском"
              />
            </label>

            <label className="block space-y-1 text-[11px] text-app-muted">
              Тег сценария <span className="text-app-muted/70">(необяз.)</span>
              <input
                type="text"
                value={scenarioKey}
                onChange={(e) => setScenarioKey(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                placeholder="patrol / court …"
              />
            </label>
          </div>

          <div className="relative space-y-1 text-[11px] text-app-muted">
            <span>Привязка к статье</span>
            {articleId ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white/90">
                <span className="min-w-0 flex-1 truncate">{articleLabel ?? articleId}</span>
                <button
                  type="button"
                  className="text-xs text-accent hover:underline"
                  onClick={() => {
                    setArticleId(null)
                    setArticleLabel(null)
                  }}
                >
                  Снять
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={articleQuery}
                  onChange={(e) => {
                    setArticleQuery(e.target.value)
                    setArticleOpen(true)
                  }}
                  onFocus={() => setArticleOpen(true)}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                  placeholder="Поиск по базе, от 2 символов…"
                />
                {articleOpen && articleHits.length > 0 ? (
                  <ul className="absolute left-0 right-0 z-10 mt-1 max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-[#12151c] py-1 shadow-xl">
                    {articleHits.map((h) => (
                      <li key={h.article_id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-xs text-white/90 hover:bg-white/[0.06]"
                          onClick={() => {
                            setArticleId(h.article_id)
                            setArticleLabel(articleDisplayTitle(h.article_number, h.heading))
                            setArticleQuery('')
                            setArticleHits([])
                            setArticleOpen(false)
                          }}
                        >
                          <div className="font-medium line-clamp-2">{h.heading}</div>
                          <div className="text-[10px] text-app-muted line-clamp-1">{h.document_title}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>

          <label className="block space-y-1 text-[11px] text-app-muted">
            Текст
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className="min-h-[120px] max-h-[min(280px,42vh)] w-full resize-y rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 font-mono text-sm leading-relaxed text-white outline-none focus:border-accent/50"
              placeholder="Напоминания, чек-листы, формулировки…"
            />
          </label>

          {saveHint ? <p className="text-[11px] text-amber-200/90">{saveHint}</p> : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
            <button
              type="button"
              onClick={() => void saveNote()}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-dim sm:text-sm sm:px-4 sm:py-2"
            >
              Сохранить
            </button>
            {selectedId ? (
              <button
                type="button"
                onClick={() => void deleteNote()}
                className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/20 sm:text-sm sm:px-4 sm:py-2"
              >
                Удалить
              </button>
            ) : null}
            {selectedNote?.document_id && selectedNote.article_id ? (
              <Link
                to={`/reader/${selectedNote.document_id}/${selectedNote.article_id}`}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-app-muted hover:border-white/20 hover:text-white sm:text-sm sm:px-4 sm:py-2"
              >
                В читателе
              </Link>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}
