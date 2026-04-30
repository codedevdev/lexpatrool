import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CheatSheetRecord } from '@shared/types'
import { ToolOverlayFrame } from './ToolOverlayFrame'

function splitCheatBlocks(body: string): string[] {
  return body
    .split(/\n\s*---+\s*\n|\n{2,}/u)
    .map((x) => x.trim())
    .filter(Boolean)
}

export function CheatOverlayPage(): JSX.Element {
  const [rows, setRows] = useState<CheatSheetRecord[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [q, setQ] = useState('')
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    const list = await window.lawHelper.cheatSheets.list()
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

  useEffect(() => {
    const off = window.lawHelper.cheatSheets.onChanged(() => void refresh())
    return () => off()
  }, [refresh])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => `${r.title}\n${r.body}`.toLowerCase().includes(s))
  }, [rows, q])

  useEffect(() => {
    if (filtered.length === 0) return
    if (!filtered.some((s) => s.id === activeId)) setActiveId(filtered[0]!.id)
  }, [filtered, activeId])

  const active = rows.find((r) => r.id === activeId) ?? null
  const activeIndex = filtered.findIndex((r) => r.id === activeId)
  const blocks = useMemo(() => splitCheatBlocks(active?.body ?? ''), [active?.body])
  const stats = active
    ? `${(active.body.length || 0).toLocaleString('ru-RU')} симв. · ${blocks.length || 1} блок`
    : `${filtered.length} найдено`

  const flashCopied = useCallback((label: string) => {
    setCopiedLabel(label)
    window.setTimeout(() => setCopiedLabel(null), 1300)
  }, [])

  const copyText = useCallback(
    async (text: string, label: string): Promise<void> => {
      if (!text.trim()) return
      try {
        await navigator.clipboard.writeText(text)
        flashCopied(label)
      } catch {
        /* clipboard may be unavailable over some overlay focus modes */
      }
    },
    [flashCopied]
  )

  const selectRelative = useCallback(
    (delta: number): void => {
      if (filtered.length === 0) return
      const current = Math.max(0, activeIndex)
      const next = (current + delta + filtered.length) % filtered.length
      setActiveId(filtered[next]!.id)
    },
    [activeIndex, filtered]
  )

  async function copyBody(): Promise<void> {
    if (!active?.body) return
    await copyText(active.body, 'скопировано всё')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (typing) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        selectRelative(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        selectRelative(-1)
      } else if (e.key.toLowerCase() === 'c') {
        e.preventDefault()
        void copyBody()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [copyBody, selectRelative])

  return (
    <ToolOverlayFrame
      which="cheats"
      title="LexPatrol · шпаргалки"
      subtitle={active ? `${active.title} · ${stats}` : 'быстрый текст поверх игры'}
      footerHint="Ctrl+F — поиск · ↑/↓ — выбор · C — копировать · двойной клик — копировать"
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex shrink-0 gap-2">
          <input
            ref={searchRef}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/35 px-2 py-1.5 text-[11px] text-white outline-none placeholder:text-white/25 focus:border-accent/40"
            placeholder="Поиск по названию и тексту…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="button"
            title="Предыдущая шпаргалка"
            onClick={() => selectRelative(-1)}
            disabled={filtered.length < 2}
            className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] text-white/80 hover:bg-white/10 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            title="Следующая шпаргалка"
            onClick={() => selectRelative(1)}
            disabled={filtered.length < 2}
            className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] text-white/80 hover:bg-white/10 disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            title="Обновить список из базы"
            onClick={() => void refresh()}
            className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] text-white/80 hover:bg-white/10"
          >
            ↻
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,36%)_1fr]">
          <ul className="lex-overlay-scroll min-h-0 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/25 p-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-4 text-center text-[11px] text-white/45">
                {rows.length === 0 ? 'Нет шпаргалок — создайте в LexPatrol → Шпаргалки.' : 'Нет совпадений.'}
              </li>
            ) : (
              filtered.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    title="Двойной клик — скопировать текст шпаргалки"
                    onClick={() => setActiveId(s.id)}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      void copyText(s.body, 'шпаргалка скопирована')
                    }}
                    className={`w-full rounded-md px-2 py-2 text-left text-[11px] transition ${
                      s.id === activeId ? 'bg-accent/25 text-white' : 'text-app-muted hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className="block truncate font-medium">{s.title}</span>
                    <span className="mt-0.5 block truncate text-[9px] text-white/35">
                      {s.body.trim().split(/\r?\n/u)[0] || 'Пустой текст'}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="flex min-h-0 flex-col rounded-lg border border-white/[0.06] bg-black/20">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-2 py-1.5">
              <span className="truncate text-[10px] font-medium text-white/85">
                {active?.title ?? '—'}{copiedLabel ? ` · ${copiedLabel}` : ''}
              </span>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={!active?.body}
                  onClick={() => void copyBody()}
                  className="rounded border border-white/10 px-2 py-0.5 text-[9px] text-white/70 hover:bg-white/10 disabled:opacity-30"
                >
                  Всё
                </button>
                <button
                  type="button"
                  disabled={!blocks[0]}
                  onClick={() => void copyText(blocks[0] ?? '', 'первый блок скопирован')}
                  className="rounded border border-white/10 px-2 py-0.5 text-[9px] text-white/70 hover:bg-white/10 disabled:opacity-30"
                >
                  Блок 1
                </button>
              </div>
            </div>
            <div className="lex-overlay-scroll min-h-0 flex-1 overflow-auto p-2">
              {active?.body?.trim() ? (
                <div className="space-y-2">
                  <pre className="whitespace-pre-wrap rounded-lg bg-black/20 p-2 font-sans text-[11px] leading-relaxed text-white/85">
                    {active.body}
                  </pre>
                  {blocks.length > 1 ? (
                    <div className="grid gap-1 sm:grid-cols-2">
                      {blocks.slice(0, 6).map((block, i) => (
                        <button
                          key={`${active.id}-${i}`}
                          type="button"
                          onClick={() => void copyText(block, `блок ${i + 1} скопирован`)}
                          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-left text-[10px] text-white/65 hover:bg-white/[0.08] hover:text-white"
                        >
                          <span className="block text-[9px] text-accent/80">Блок {i + 1}</span>
                          <span className="line-clamp-2">{block}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-white/10 px-3 text-center text-[11px] text-white/45">
                  Выберите шпаргалку слева или создайте новую в основном окне.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ToolOverlayFrame>
  )
}
