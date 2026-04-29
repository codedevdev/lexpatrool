import { useCallback, useEffect, useMemo, useState } from 'react'
import { ToolOverlayFrame } from './ToolOverlayFrame'

type Sheet = { id: string; title: string; body: string; sort_order: number }

export function CheatOverlayPage(): JSX.Element {
  const [rows, setRows] = useState<Sheet[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [q, setQ] = useState('')

  const refresh = useCallback(async () => {
    const list = (await window.lawHelper.cheatSheets.list()) as Sheet[]
    const arr = Array.isArray(list) ? list : []
    setRows(arr)
    setActiveId((cur) => {
      if (cur && arr.some((s) => s.id === cur)) return cur
      return arr[0]?.id ?? ''
    })
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => r.title.toLowerCase().includes(s))
  }, [rows, q])

  useEffect(() => {
    if (filtered.length === 0) return
    if (!filtered.some((s) => s.id === activeId)) setActiveId(filtered[0]!.id)
  }, [filtered, activeId])

  const active = rows.find((r) => r.id === activeId) ?? null

  async function copyBody(): Promise<void> {
    if (!active?.body) return
    try {
      await navigator.clipboard.writeText(active.body)
    } catch {
      /* ignore */
    }
  }

  return (
    <ToolOverlayFrame
      which="cheats"
      title="LexPatrol · шпаргалки"
      footerHint="Esc — скрыть · горячая клавиша в настройках · двойной клик по названию — копировать текст"
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex shrink-0 gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/35 px-2 py-1.5 text-[11px] text-white outline-none placeholder:text-white/25 focus:border-accent/40"
            placeholder="Поиск по названию…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="button"
            title="Обновить список из базы"
            onClick={() => void refresh()}
            className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] text-white/80 hover:bg-white/10"
          >
            ↻
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,38%)_1fr]">
          <ul className="lex-overlay-scroll min-h-0 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/25 p-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-4 text-center text-[11px] text-white/45">Нет шпаргалок — создайте в LexPatrol → Шпаргалки.</li>
            ) : (
              filtered.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    title="Двойной клик — скопировать текст шпаргалки"
                    onClick={() => setActiveId(s.id)}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      if (s.body?.trim()) void navigator.clipboard.writeText(s.body)
                    }}
                    className={`w-full rounded-md px-2 py-2 text-left text-[11px] transition ${
                      s.id === activeId ? 'bg-accent/25 text-white' : 'text-app-muted hover:bg-white/[0.06]'
                    }`}
                  >
                    {s.title}
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="flex min-h-0 flex-col rounded-lg border border-white/[0.06] bg-black/20">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-2 py-1.5">
              <span className="truncate text-[10px] font-medium text-white/85">{active?.title ?? '—'}</span>
              <button
                type="button"
                disabled={!active?.body}
                onClick={() => void copyBody()}
                className="shrink-0 rounded border border-white/10 px-2 py-0.5 text-[9px] text-white/70 hover:bg-white/10 disabled:opacity-30"
              >
                Копировать всё
              </button>
            </div>
            <pre className="lex-overlay-scroll min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 font-sans text-[11px] leading-relaxed text-white/85">
              {active?.body?.trim() ? active.body : 'Выберите шпаргалку слева.'}
            </pre>
          </div>
        </div>
      </div>
    </ToolOverlayFrame>
  )
}
