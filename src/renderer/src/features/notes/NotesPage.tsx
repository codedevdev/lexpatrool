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
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-white">Заметки и закладки</h1>
        <p className="mt-2 max-w-2xl text-sm text-app-muted leading-relaxed">
          Избранные статьи из базы и текстовые заметки. К заметке можно привязать статью — чтобы не искать формулировку во время
          смены.
        </p>
      </header>

      <section className="glass rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white">Закладки</h2>
        <p className="mt-1 text-xs text-app-muted">Статьи, которые вы добавили в избранное в читателе или в базе знаний.</p>
        {loading ? (
          <p className="mt-4 text-sm text-app-muted">Загрузка…</p>
        ) : bookmarks.length === 0 ? (
          <p className="mt-4 text-sm text-app-muted">Пока нет закладок — отметьте статью в читателе или базе знаний.</p>
        ) : (
          <ul className="mt-4 divide-y divide-white/5 rounded-xl border border-white/10">
            {bookmarks.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate text-white/90">{articleDisplayTitle(b.article_number, b.heading)}</div>
                  <div className="text-xs text-app-muted">{fmtDate(b.created_at)}</div>
                </div>
                <Link
                  to={`/reader/${b.document_id}/${b.article_id}`}
                  className="shrink-0 rounded-lg border border-accent/35 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20"
                >
                  Открыть
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="glass rounded-2xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">Мои заметки</h2>
            <button
              type="button"
              onClick={() => resetEditor()}
              className="rounded-lg border border-white/10 bg-surface-raised px-3 py-1.5 text-xs text-white hover:bg-surface-hover"
            >
              Новая заметка
            </button>
          </div>
          {loading ? (
            <p className="mt-4 text-sm text-app-muted">Загрузка…</p>
          ) : notes.length === 0 ? (
            <p className="mt-4 text-sm text-app-muted">Пока нет заметок — создайте первую справа или кнопкой «Новая».</p>
          ) : (
            <ul className="mt-4 max-h-[480px] space-y-1 overflow-y-auto pr-1">
              {notes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openNote(n)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                      selectedId === n.id
                        ? 'border-accent/40 bg-accent/10 text-white'
                        : 'border-white/10 bg-black/20 text-app-muted hover:border-white/15 hover:text-white/90'
                    }`}
                  >
                    <div className="font-medium text-white/95 line-clamp-1">
                      {n.title?.trim() || n.body.trim().split('\n')[0]?.slice(0, 72) || 'Без названия'}
                    </div>
                    <div className="mt-0.5 text-xs text-app-muted line-clamp-1">
                      {n.article_heading ? `↳ ${n.article_heading}` : 'Без привязки к статье'} · {fmtDate(n.updated_at)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass space-y-4 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-white">{selectedId ? 'Редактирование' : 'Новая заметка'}</h2>

          <label className="block space-y-1 text-xs text-app-muted">
            Заголовок (необязательно)
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
              placeholder="Например: проверка перед обыском"
            />
          </label>

          <label className="block space-y-1 text-xs text-app-muted">
            Тег сценария (необязательно)
            <input
              type="text"
              value={scenarioKey}
              onChange={(e) => setScenarioKey(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
              placeholder="patrol / traffic / court …"
            />
          </label>

          <div className="relative space-y-1 text-xs text-app-muted">
            <span>Привязка к статье (поиск по базе)</span>
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
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
                  placeholder="Введите запрос (от 2 символов)…"
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

          <label className="block space-y-1 text-xs text-app-muted">
            Текст
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="w-full resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm leading-relaxed text-white outline-none focus:border-accent/50"
              placeholder="Ваши напоминания, чек-листы, формулировки для RP…"
            />
          </label>

          {saveHint ? <p className="text-xs text-amber-200/90">{saveHint}</p> : null}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={() => void saveNote()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim"
            >
              Сохранить
            </button>
            {selectedId ? (
              <button
                type="button"
                onClick={() => void deleteNote()}
                className="rounded-lg border border-red-500/35 bg-red-500/10 px-4 py-2 text-sm text-red-200 hover:bg-red-500/20"
              >
                Удалить
              </button>
            ) : null}
            {selectedNote?.document_id && selectedNote.article_id ? (
              <Link
                to={`/reader/${selectedNote.document_id}/${selectedNote.article_id}`}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-app-muted hover:border-white/20 hover:text-white"
              >
                Открыть статью в читателе
              </Link>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}
