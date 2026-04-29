import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

type CollectionRow = {
  id: string
  name: string
  description: string | null
  sort_order: number
  article_count?: number
}

export function CollectionsPage(): JSX.Element {
  const [rows, setRows] = useState<CollectionRow[]>([])
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [hint, setHint] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const list = (await window.lawHelper.collections.list()) as CollectionRow[]
    setRows(Array.isArray(list) ? list : [])
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function addCollection(): Promise<void> {
    setHint(null)
    const n = name.trim()
    if (!n) {
      setHint('Введите название подборки.')
      return
    }
    const r = await window.lawHelper.collections.save({ name: n, description: desc.trim() || null })
    if (r.ok) {
      setName('')
      setDesc('')
      void refresh()
    } else setHint('Не удалось сохранить.')
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Сменные подборки</h1>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">
            Группы статей для разных ситуаций на смене (ДТП, задержание, EMS…). В оверлее закрепов — компактный список;
            для быстрого доступа в игре — отдельное окно.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void window.lawHelper.toolOverlay.toggle('collections')}
          className="rounded-xl border border-accent/35 bg-accent/15 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/25"
        >
          Окно подборок
        </button>
      </header>

      <section className="glass rounded-2xl p-5">
        <h2 className="text-sm font-medium text-white">Новая подборка</h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block min-w-0 flex-1 text-xs text-app-muted">
            Название
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: ДТП и дорога"
            />
          </label>
          <label className="block min-w-0 flex-1 text-xs text-app-muted">
            Подпись (необязательно)
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => void addCollection()}
            className="h-10 shrink-0 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-dim"
          >
            Создать
          </button>
        </div>
        {hint ? <p className="mt-2 text-xs text-amber-200/90">{hint}</p> : null}
      </section>

      <section className="glass rounded-2xl p-5">
        <h2 className="text-sm font-medium text-white">Ваши подборки</h2>
        <ul className="mt-3 divide-y divide-white/5">
          {rows.length === 0 ? (
            <li className="py-6 text-sm text-app-muted">Пока пусто — создайте первую подборку выше.</li>
          ) : (
            rows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="font-medium text-white">{c.name}</div>
                  {c.description ? <div className="text-xs text-app-muted">{c.description}</div> : null}
                  <div className="mt-1 text-xs text-white/40">
                    Статей: {typeof c.article_count === 'number' ? c.article_count : '—'}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link
                    to={`/kb?q=${encodeURIComponent(c.name)}`}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-app-muted hover:bg-white/5"
                  >
                    В базе
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm(`Удалить подборку «${c.name}»? Статьи в базе останутся.`)) return
                      void window.lawHelper.collections.delete(c.id).then(() => void refresh())
                    }}
                    className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-200/90 hover:bg-red-500/10"
                  >
                    Удалить
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  )
}
