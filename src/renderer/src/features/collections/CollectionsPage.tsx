import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ArticleCollectionRecord } from '@shared/types'

export function CollectionsPage(): JSX.Element {
  const [rows, setRows] = useState<ArticleCollectionRecord[]>([])
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [filter, setFilter] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [hint, setHint] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const list = await window.lawHelper.collections.list()
    setRows(Array.isArray(list) ? list : [])
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const off = window.lawHelper.collections.onChanged(() => void refresh())
    return () => off()
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

  const filteredRows = useMemo(() => {
    const s = filter.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((c) => `${c.name}\n${c.description ?? ''}`.toLowerCase().includes(s))
  }, [rows, filter])

  function startEdit(c: ArticleCollectionRecord): void {
    setEditingId(c.id)
    setEditName(c.name)
    setEditDesc(c.description ?? '')
    setHint(null)
  }

  async function saveEdit(c: ArticleCollectionRecord): Promise<void> {
    const n = editName.trim()
    if (!n) {
      setHint('Название подборки не может быть пустым.')
      return
    }
    const r = await window.lawHelper.collections.save({
      id: c.id,
      name: n,
      description: editDesc.trim() || null,
      sort_order: c.sort_order
    })
    if (r.ok) {
      setEditingId(null)
      await refresh()
      setHint('Подборка обновлена.')
    } else {
      setHint('Не удалось обновить подборку.')
    }
  }

  async function moveCollection(id: string, direction: -1 | 1): Promise<void> {
    const currentIndex = rows.findIndex((x) => x.id === id)
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= rows.length) return
    const current = rows[currentIndex]!
    const next = rows[nextIndex]!
    const [a, b] = await Promise.all([
      window.lawHelper.collections.save({
        id: current.id,
        name: current.name,
        description: current.description,
        sort_order: next.sort_order
      }),
      window.lawHelper.collections.save({
        id: next.id,
        name: next.name,
        description: next.description,
        sort_order: current.sort_order
      })
    ])
    if (a.ok && b.ok) {
      await refresh()
      setHint('Порядок подборок обновлён.')
    } else {
      setHint('Не удалось изменить порядок.')
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Сменные подборки</h1>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">
            Группы статей для разных ситуаций на смене (ДТП, задержание, EMS…). Добавляйте статьи из читателя или на странице «Состав и поиск». В оверлее закрепов — компактный список; для игры — отдельное окно.
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-white">Ваши подборки</h2>
          <input
            className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-1.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-accent/40 sm:w-72"
            placeholder="Фильтр по названию и подписи…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <ul className="mt-3 divide-y divide-white/5">
          {rows.length === 0 ? (
            <li className="py-6 text-sm text-app-muted">Пока пусто — создайте первую подборку выше.</li>
          ) : filteredRows.length === 0 ? (
            <li className="py-6 text-sm text-app-muted">Нет подборок по этому фильтру.</li>
          ) : (
            filteredRows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                {editingId === c.id ? (
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                    <input
                      className="rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Название"
                    />
                    <input
                      className="rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Подпись"
                    />
                  </div>
                ) : (
                  <div className="min-w-0">
                    <div className="font-medium text-white">{c.name}</div>
                    {c.description ? <div className="text-xs text-app-muted">{c.description}</div> : null}
                    <div className="mt-1 text-xs text-white/40">
                      Статей: {typeof c.article_count === 'number' ? c.article_count : '—'}
                    </div>
                  </div>
                )}
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {editingId === c.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void saveEdit(c)}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-dim"
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-app-muted hover:bg-white/5"
                      >
                        Отмена
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-app-muted hover:bg-white/5"
                    >
                      Редактировать
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void moveCollection(c.id, -1)}
                    disabled={rows.findIndex((x) => x.id === c.id) === 0}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-app-muted hover:bg-white/5 disabled:opacity-30"
                  >
                    Вверх
                  </button>
                  <button
                    type="button"
                    onClick={() => void moveCollection(c.id, 1)}
                    disabled={rows.findIndex((x) => x.id === c.id) === rows.length - 1}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-app-muted hover:bg-white/5 disabled:opacity-30"
                  >
                    Вниз
                  </button>
                  <Link
                    to={`/collections/${c.id}`}
                    className="rounded-lg border border-accent/35 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20"
                  >
                    Состав и поиск
                  </Link>
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
