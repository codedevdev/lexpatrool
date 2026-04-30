import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CheatSheetRecord } from '@shared/types'

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
  },
  {
    label: 'Задержание',
    title: 'Задержание — порядок',
    body: 'Основание:\n1. Представиться и назвать причину.\n2. Разъяснить права.\n3. Провести досмотр/изъятие по процедуре.\n4. Зафиксировать время и статью.\n\nФраза:\n'
  },
  {
    label: 'ДТП',
    title: 'ДТП — быстрый чеклист',
    body: 'Место:\nУчастники:\nПострадавшие:\nСвидетели:\n\n□ Обезопасить место\n□ Вызвать EMS при необходимости\n□ Проверить документы\n□ Оформить итог\n'
  },
  {
    label: 'Обыск',
    title: 'Обыск — формулировки',
    body: 'Причина обыска:\nПонятые/камера:\nИзъято:\n\nШаблон:\nНа основании ... будет проведён обыск. Прошу не препятствовать законным действиям.\n'
  },
  {
    label: 'Рапорт',
    title: 'Рапорт — шаблон',
    body: 'Дата/время:\nСотрудник:\nСобытие:\nОснование:\nДействия:\nИтог:\n\nДоказательства:\n'
  }
]

function includesQuery(row: CheatSheetRecord, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return `${row.title}\n${row.body}`.toLowerCase().includes(s)
}

export function CheatSheetsPage(): JSX.Element {
  const [rows, setRows] = useState<CheatSheetRecord[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [listQ, setListQ] = useState('')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const lastSavedRef = useRef<{ title: string; body: string } | null>(null)

  const refresh = useCallback(async () => {
    const list = await window.lawHelper.cheatSheets.list()
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
      body,
      sort_order: rows.find((x) => x.id === activeId)?.sort_order
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
  }, [activeId, title, body, rows, refresh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const off = window.lawHelper.cheatSheets.onChanged(() => void refresh())
    return () => off()
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
      const row = r
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
    return rows.filter((r) => includesQuery(r, s))
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

  async function copyBody(): Promise<void> {
    if (!body.trim()) {
      setStatus('Нечего копировать.')
      return
    }
    try {
      await navigator.clipboard.writeText(body)
      setStatus('Текст скопирован.')
    } catch {
      setStatus('Не удалось скопировать.')
    }
  }

  async function moveSheet(id: string, direction: -1 | 1): Promise<void> {
    const currentIndex = rows.findIndex((x) => x.id === id)
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= rows.length) return
    if (dirty && activeId === id && !window.confirm('Сначала сохранить текущие изменения и изменить порядок?')) return

    const current = rows[currentIndex]!
    const next = rows[nextIndex]!
    const currentPayload =
      current.id === activeId
        ? { id: current.id, title: title.trim() || current.title, body, sort_order: next.sort_order }
        : { id: current.id, title: current.title, body: current.body, sort_order: next.sort_order }
    const nextPayload =
      next.id === activeId
        ? { id: next.id, title: title.trim() || next.title, body, sort_order: current.sort_order }
        : { id: next.id, title: next.title, body: next.body, sort_order: current.sort_order }

    const [a, b] = await Promise.all([
      window.lawHelper.cheatSheets.save(currentPayload),
      window.lawHelper.cheatSheets.save(nextPayload)
    ])
    if (a.ok && b.ok) {
      if (activeId === id) setDirty(false)
      setStatus('Порядок обновлён.')
      void refresh()
    } else {
      setStatus('Не удалось изменить порядок.')
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

      <div className="grid gap-6 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
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
            placeholder="Поиск по названию и тексту…"
            value={listQ}
            onChange={(e) => setListQ(e.target.value)}
          />
          <ul className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto lex-app-scroll">
            {filteredRows.length === 0 ? (
              <li className="rounded-lg border border-white/5 px-2 py-4 text-center text-xs text-app-muted">
                Ничего не найдено.
              </li>
            ) : null}
            {filteredRows.map((s) => (
              <li key={s.id}>
                <div
                  className={`group rounded-lg border px-2 py-2 ${
                    activeId === s.id ? 'border-accent/30 bg-white/10' : 'border-transparent hover:bg-white/5'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (dirty && !window.confirm('Есть несохранённые изменения. Переключить шпаргалку?')) return
                      setActiveId(s.id)
                    }}
                    className={`w-full text-left text-sm ${
                      activeId === s.id ? 'text-white' : 'text-app-muted'
                    }`}
                  >
                    <span className="line-clamp-1">{s.title}</span>
                    <span className="mt-0.5 block line-clamp-1 text-[11px] text-white/35">
                      {s.body.trim().split(/\r?\n/)[0] || 'Пустой текст'}
                    </span>
                  </button>
                  <div className="mt-1 flex gap-1 opacity-80">
                    <button
                      type="button"
                      onClick={() => void moveSheet(s.id, -1)}
                      className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/50 hover:text-white disabled:opacity-30"
                      disabled={rows.findIndex((x) => x.id === s.id) === 0}
                    >
                      Вверх
                    </button>
                    <button
                      type="button"
                      onClick={() => void moveSheet(s.id, 1)}
                      className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/50 hover:text-white disabled:opacity-30"
                      disabled={rows.findIndex((x) => x.id === s.id) === rows.length - 1}
                    >
                      Вниз
                    </button>
                  </div>
                </div>
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

          <div className="mt-3 grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(220px,32%)]">
            <div className="flex min-h-0 flex-col">
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
            <aside className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-white/45">Предпросмотр</div>
              <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-white">{title.trim() || 'Без заголовка'}</h3>
              <pre className="lex-app-scroll mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/25 p-2 font-sans text-xs leading-relaxed text-app-muted">
                {body.trim() || 'Текст шпаргалки появится здесь. Этот вид ближе к оверлею поверх игры.'}
              </pre>
              <button
                type="button"
                onClick={() => void copyBody()}
                className="mt-3 w-full rounded-lg border border-white/10 px-3 py-1.5 text-xs text-app-muted hover:bg-white/5"
              >
                Копировать текст
              </button>
            </aside>
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
