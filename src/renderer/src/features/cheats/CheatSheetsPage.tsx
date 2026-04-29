import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Sheet = { id: string; title: string; body: string; sort_order: number }

const TEMPLATES: { label: string; title: string; body: string }[] = [
  {
    label: 'Пустая',
    title: '',
    body: ''
  },
  {
    label: 'Позывные / радио',
    title: 'Позывные и радио',
    body: 'Позывной:\nЧастота:\nКоды:\n\n—\n\nШаблон фразы:\n'
  },
  {
    label: 'Смена (чеклист)',
    title: 'Смена — памятка',
    body: '□ Документы\n□ Связь\n□ Координаты\n\nЗаметки:\n'
  }
]

export function CheatSheetsPage(): JSX.Element {
  const [rows, setRows] = useState<Sheet[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [listQ, setListQ] = useState('')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const lastSavedRef = useRef<{ title: string; body: string } | null>(null)

  const refresh = useCallback(async () => {
    const list = (await window.lawHelper.cheatSheets.list()) as Sheet[]
    setRows(Array.isArray(list) ? list : [])
  }, [])

  const save = useCallback(async (): Promise<void> => {
    const t = title.trim()
    if (!t) {
      setStatus('Введите заголовок.')
      return
    }
    setStatus(null)
    const r = await window.lawHelper.cheatSheets.save({
      id: activeId ?? undefined,
      title: t,
      body
    })
    if (r.ok) {
      setActiveId(r.id)
      lastSavedRef.current = { title: t, body }
      setDirty(false)
      setStatus('Сохранено.')
      void refresh()
      void window.lawHelper.toolOverlay.raise('cheats').catch(() => {})
    } else {
      setStatus('Не удалось сохранить.')
    }
  }, [activeId, title, body, refresh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!activeId) {
      setTitle('')
      setBody('')
      lastSavedRef.current = null
      setDirty(false)
      return
    }
    void window.lawHelper.cheatSheets.get(activeId).then((r) => {
      const row = r as Sheet | null
      if (row) {
        setTitle(row.title)
        setBody(row.body)
        lastSavedRef.current = { title: row.title, body: row.body }
        setDirty(false)
      }
    })
  }, [activeId])

  const filteredRows = useMemo(() => {
    const s = listQ.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => r.title.toLowerCase().includes(s))
  }, [rows, listQ])

  useEffect(() => {
    if (!lastSavedRef.current) {
      setDirty(Boolean(title.trim() || body.trim()))
      return
    }
    setDirty(title !== lastSavedRef.current.title || body !== lastSavedRef.current.body)
  }, [title, body])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          e.preventDefault()
          void save()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  function createNew(): void {
    if (dirty && !window.confirm('Есть несохранённые изменения. Создать новую?')) return
    setActiveId(null)
    setTitle('')
    setBody('')
    setStatus(null)
    lastSavedRef.current = null
    setDirty(false)
  }

  async function duplicateActive(): Promise<void> {
    if (!activeId) return
    const row = rows.find((x) => x.id === activeId)
    if (!row) return
    const copyTitle = `${row.title} (копия)`
    const r = await window.lawHelper.cheatSheets.save({
      title: copyTitle,
      body: row.body
    })
    if (r.ok) {
      setActiveId(r.id)
      setTitle(copyTitle)
      setBody(row.body)
      lastSavedRef.current = { title: copyTitle, body: row.body }
      setDirty(false)
      void refresh()
      setStatus('Копия создана.')
    }
  }

  const bodyStats = useMemo(() => {
    const lines = body.length ? body.split(/\r?\n/).length : 0
    return `${body.length.toLocaleString('ru-RU')} симв. · ${lines} строк`
  }, [body])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Шпаргалки</h1>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">
            Текст вне базы статей: позывные, радиокоды, шаблоны фраз. В основном оверлее — компактный блок; для игры
            удобнее отдельное перетаскиваемое окно — кнопка справа или горячая клавиша в настройках.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void window.lawHelper.toolOverlay.toggle('cheats')}
            className="rounded-xl border border-accent/35 bg-accent/15 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/25"
          >
            Окно поверх игры
          </button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        <aside className="glass flex min-h-0 flex-col rounded-2xl p-4 lg:max-h-[min(78vh,40rem)]">
          <button
            type="button"
            onClick={() => createNew()}
            className="w-full rounded-lg bg-accent py-2 text-sm font-medium text-white hover:bg-accent-dim"
          >
            Новая шпаргалка
          </button>
          <input
            className="mt-3 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-accent/40"
            placeholder="Поиск в списке…"
            value={listQ}
            onChange={(e) => setListQ(e.target.value)}
          />
          <ul className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto lex-app-scroll">
            {filteredRows.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (dirty && !window.confirm('Есть несохранённые изменения. Переключить шпаргалку?')) return
                    setActiveId(s.id)
                  }}
                  className={`w-full rounded-lg px-2 py-2 text-left text-sm ${
                    activeId === s.id ? 'bg-white/10 text-white' : 'text-app-muted hover:bg-white/5'
                  }`}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="glass flex min-h-[min(70vh,36rem)] flex-col rounded-2xl p-5">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.06] pb-4">
            <label className="block min-w-0 flex-1 text-xs text-app-muted">
              Заголовок
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Краткое имя в списке"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <select
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs text-white outline-none"
                onChange={(e) => {
                  const i = Number(e.target.value)
                  const tpl = TEMPLATES[i]
                  e.target.value = ''
                  if (Number.isNaN(i) || !tpl) return
                  if (i > 0 && dirty && !window.confirm('Подставить шаблон? Несохранённое будет потеряно.')) return
                  setTitle(tpl.title)
                  setBody(tpl.body)
                  setActiveId(null)
                  lastSavedRef.current = null
                  setDirty(Boolean(tpl.title.trim() || tpl.body.trim()))
                }}
                defaultValue=""
              >
                <option value="" disabled>
                  Шаблон…
                </option>
                {TEMPLATES.map((t, i) => (
                  <option key={t.label} value={i}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-2 text-[11px] text-app-muted">
              <span>Текст · моноширинный редактор</span>
              <span className="tabular-nums text-white/45">{bodyStats}</span>
            </div>
            <textarea
              className="lex-app-scroll mt-1 min-h-[min(52vh,22rem)] flex-1 resize-y rounded-lg border border-white/10 bg-[#080a0f] px-3 py-2 font-mono text-[13px] leading-relaxed text-white outline-none focus:border-accent/50"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Строки, списки, разделитель «---» между блоками…"
              spellCheck={false}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
            <button
              type="button"
              onClick={() => void save()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim"
            >
              Сохранить
            </button>
            <span className="text-[11px] text-white/35">Ctrl+S</span>
            {dirty ? <span className="text-[11px] text-amber-200/90">Есть несохранённые изменения</span> : null}
            {activeId ? (
              <button
                type="button"
                onClick={() => void duplicateActive()}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-app-muted hover:bg-white/5"
              >
                Дублировать
              </button>
            ) : null}
            {activeId ? (
              <button
                type="button"
                onClick={() => {
                  if (!confirm('Удалить эту шпаргалку?')) return
                  void window.lawHelper.cheatSheets.delete(activeId).then(() => {
                    setActiveId(null)
                    void refresh()
                    setStatus(null)
                  })
                }}
                className="rounded-lg border border-red-500/35 px-4 py-2 text-sm text-red-200/90 hover:bg-red-500/10"
              >
                Удалить
              </button>
            ) : null}
            {status ? <span className="text-xs text-emerald-200/90">{status}</span> : null}
          </div>
        </section>
      </div>
    </div>
  )
}
