import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { articleDisplayTitle } from '@shared/article-display'
import { extractPenaltyHints } from '@parsers/article-split'

interface ArticleDisplayMeta {
  stars?: number
  fineUsd?: number
  fineRub?: number
  ukArticle?: string
  tags?: string[]
  bailHint?: string
}

interface Pinned {
  id: string
  document_id: string
  heading: string
  article_number: string | null
  body_clean: string
  document_title: string
  summary_short: string | null
  penalty_hint: string | null
  display_meta_json: string
  sort_order?: number
  /** Соответствует documents.article_import_filter (импорт «только справочные» = without_sanctions) */
  document_article_import_filter?: string | null
}

function parseDisplayMeta(raw: string | null | undefined): ArticleDisplayMeta {
  if (!raw?.trim()) return {}
  try {
    const j = JSON.parse(raw) as ArticleDisplayMeta
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

function isReferenceImportDoc(p: { document_article_import_filter?: string | null }): boolean {
  return p.document_article_import_filter === 'without_sanctions'
}

/** Короткая выжимка для карточки списка (не длинная простыня). */
function previewEssenceLine(p: Pinned): string {
  if (p.summary_short?.trim()) {
    const t = p.summary_short.trim().replace(/\s+/g, ' ')
    return t.length > 140 ? `${t.slice(0, 137)}…` : t
  }
  const lines = p.body_clean.split('\n').map((l) => l.trim()).filter(Boolean)
  const line = lines.find(
    (l) =>
      !/^Часть\s/i.test(l) &&
      !/^Наказание\s*:/i.test(l) &&
      !/^Выход под залог/i.test(l) &&
      !/^\d+(?:\.\d+)+\s*\([^)]*\)\s*\S/.test(l)
  )
  const t = (line ?? lines[0] ?? p.body_clean).replace(/\s+/g, ' ').trim()
  if (!t) return '—'
  return t.length > 140 ? `${t.slice(0, 137)}…` : t
}

function previewPenalty(p: Pinned): string {
  if (p.penalty_hint?.trim()) return p.penalty_hint.trim()
  if (isReferenceImportDoc(p)) return '—'
  const hint = extractPenaltyHints(p.body_clean, 4).split('\n')[0]?.trim()
  return hint ?? '—'
}

function previewBail(meta: ArticleDisplayMeta, body: string): string | null {
  if (meta.bailHint?.trim()) return meta.bailHint.trim()
  const m = body.match(/Выход под залог\s*:\s*([^\n]+)/i)
  return m ? m[1]!.trim().slice(0, 120) : null
}

function ruArticlesCount(n: number): string {
  const m = n % 100
  const m10 = n % 10
  if (m >= 11 && m <= 14) return `${n} статей`
  if (m10 === 1) return `${n} статья`
  if (m10 >= 2 && m10 <= 4) return `${n} статьи`
  return `${n} статей`
}

/** Превью текста на карточке: в фокусе — только релевантные санкциям строки (кроме справочных документов). */
function previewCardEssenceLine(p: Pinned, focusMode: boolean): string {
  if (!focusMode) return previewEssenceLine(p)
  if (isReferenceImportDoc(p)) return previewEssenceLine(p)
  const raw = extractPenaltyHints(p.body_clean, 16).trim()
  if (raw) {
    const flat = raw.replace(/\s+/g, ' ')
    return flat.length > 200 ? `${flat.slice(0, 197)}…` : flat
  }
  const pen = previewPenalty(p)
  if (pen && pen !== '—') return pen.length > 200 ? `${pen.slice(0, 197)}…` : pen
  return previewEssenceLine(p)
}

interface SearchHit {
  article_id: string
  document_id: string
  document_title: string
  heading: string
  snippet: string
}

function mapArticleGetToPinned(row: unknown): Pinned | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  return {
    id: r.id,
    document_id: typeof r.document_id === 'string' ? r.document_id : '',
    heading: typeof r.heading === 'string' ? r.heading : '',
    article_number: r.article_number != null ? String(r.article_number) : null,
    body_clean: typeof r.body_clean === 'string' ? r.body_clean : '',
    document_title: typeof r.document_title === 'string' ? r.document_title : '',
    summary_short: r.summary_short != null ? String(r.summary_short) : null,
    penalty_hint: r.penalty_hint != null ? String(r.penalty_hint) : null,
    display_meta_json: typeof r.display_meta_json === 'string' ? r.display_meta_json : '{}',
    document_article_import_filter:
      r.document_article_import_filter != null ? String(r.document_article_import_filter) : null
  }
}

const UI_KEY = 'overlay_ui_prefs'

/** Прокрутка без системной полосы (оверлей поверх игры). */
const ovScroll = 'lex-overlay-scroll'

/** Компакт — мало места; чтение — крупнее текст при узком заголовке; панель — поиск и все опции. */
export type OverlayLayoutPreset = 'compact' | 'reading' | 'full'

function isChromeCompact(preset: OverlayLayoutPreset): boolean {
  return preset === 'compact' || preset === 'reading'
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function MouseModeRow({
  clickThrough,
  onOverlay,
  onGame,
  variant,
  hotkeyMouse
}: {
  clickThrough: boolean
  onOverlay: () => void
  onGame: () => void
  /** compact — только переключатель; full — подсказки под кнопками мыши */
  variant: 'compact' | 'full'
  /** Подпись для режима «мышь в игру» из настроек хоткеев */
  hotkeyMouse: string
}): JSX.Element {
  const btnPad = variant === 'compact' ? 'px-2 py-1.5 text-[10px]' : 'px-2 py-2 text-[11px]'
  const wrap = variant === 'compact' ? 'mt-1.5' : 'mt-2 space-y-1.5'
  return (
    <div className={wrap} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div className="flex rounded-lg border border-white/10 bg-black/35 p-0.5 shadow-inner">
        <button
          type="button"
          title="Клики и колесо обрабатывает LexPatrol"
          className={`flex-1 rounded-md font-semibold transition ${btnPad} ${
            !clickThrough
              ? 'bg-accent/30 text-white shadow-[0_0_0_1px_rgba(91,140,255,0.35)]'
              : 'text-white/45 hover:bg-white/[0.06] hover:text-white/80'
          }`}
          onClick={onOverlay}
        >
          В оверлей
        </button>
        <button
          type="button"
          title={`Клики проходят в игру; вернуться: кнопка или ${hotkeyMouse}`}
          className={`flex-1 rounded-md font-semibold transition ${btnPad} ${
            clickThrough
              ? 'bg-emerald-500/25 text-emerald-50 shadow-[0_0_0_1px_rgba(52,211,153,0.35)]'
              : 'text-white/45 hover:bg-white/[0.06] hover:text-white/80'
          }`}
          onClick={onGame}
        >
          В игру
        </button>
      </div>
      {variant === 'full' ? (
        <p className="px-0.5 text-[9px] leading-snug text-app-muted">
          {clickThrough ? (
            <>
              Сейчас мышь идёт <span className="text-emerald-200/90">в игру</span>. Чтобы снова нажимать кнопки оверлея —
              выберите «В оверлей» или <span className="font-mono text-white/60">{hotkeyMouse}</span>.
            </>
          ) : (
            <>
              Сейчас вы работаете <span className="text-accent/90">с панелью</span>. Перед игрой включите «В игру», чтобы
              не перекрывать клики.
            </>
          )}
        </p>
      ) : null}
    </div>
  )
}

export function OverlayPage(): JSX.Element {
  const [pins, setPins] = useState<Pinned[]>([])
  const [idx, setIdx] = useState(0)
  const [opacity, setOpacity] = useState(0.94)
  const [clickThrough, setClickThrough] = useState(false)
  const [filterLocal, setFilterLocal] = useState('')
  const [globalQ, setGlobalQ] = useState('')
  const debouncedGlobal = useDebounced(globalQ, 280)
  const [tagFilterId, setTagFilterId] = useState('')
  const [tagOptions, setTagOptions] = useState<{ id: string; name: string }[]>([])
  const [globalHits, setGlobalHits] = useState<SearchHit[]>([])
  const [globalOpen, setGlobalOpen] = useState(false)
  const [layoutPreset, setLayoutPreset] = useState<OverlayLayoutPreset>('full')
  const [focusMode, setFocusMode] = useState(false)
  const [fontScale, setFontScale] = useState(1)
  const [toolsExpanded, setToolsExpanded] = useState(true)
  const [hkDisp, setHkDisp] = useState({
    toggle: 'Ctrl+Shift+Space',
    search: 'Ctrl+Shift+F',
    clickThrough: 'Ctrl+Shift+G',
    cheatsOverlay: 'Ctrl+Shift+Y',
    collectionsOverlay: 'Ctrl+Shift+U'
  })

  useEffect(() => {
    void window.lawHelper.hotkeys
      .get()
      .then((h) => setHkDisp(h.display))
      .catch(() => {})
  }, [])

  const [cheatSheetMode, setCheatSheetMode] = useState(true)
  const [detailId, setDetailId] = useState<string | null>(null)
  /** Просмотр статьи из глобального поиска (не из закрепов) — остаёмся в оверлее. */
  const [searchArticle, setSearchArticle] = useState<Pinned | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const chromeCompact = isChromeCompact(layoutPreset)
  const readingComfort = layoutPreset === 'reading'
  const readingSizeBoost = readingComfort ? 1.085 : 1

  const filterInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    const rows = (await window.lawHelper.overlay.getPinned()) as Pinned[]
    setPins(rows)
    setIdx((i) => Math.min(i, Math.max(0, rows.length - 1)))
  }, [])

  useEffect(() => {
    void (async () => {
      const [opRaw, ctRaw, raw] = await Promise.all([
        window.lawHelper.settings.get('overlay_opacity'),
        window.lawHelper.settings.get('overlay_click_through'),
        window.lawHelper.settings.get(UI_KEY)
      ])
      if (ctRaw === '1' || ctRaw === '0') setClickThrough(ctRaw === '1')
      let nextOpacity = 0.94
      if (opRaw) {
        const n = Number(opRaw)
        if (!Number.isNaN(n)) nextOpacity = n
      }
      if (raw) {
        try {
          const j = JSON.parse(raw) as {
            layoutPreset?: OverlayLayoutPreset
            opacity?: number
            compact?: boolean
            focusMode?: boolean
            fontScale?: number
            toolsExpanded?: boolean
            cheatSheetMode?: boolean
          }
          if (j.layoutPreset === 'compact' || j.layoutPreset === 'reading' || j.layoutPreset === 'full') {
            setLayoutPreset(j.layoutPreset)
          } else if (typeof j.compact === 'boolean') {
            setLayoutPreset(j.compact ? 'compact' : 'full')
          }
          if (typeof j.opacity === 'number') nextOpacity = j.opacity
          if (typeof j.focusMode === 'boolean') setFocusMode(j.focusMode)
          if (typeof j.fontScale === 'number') setFontScale(j.fontScale)
          if (typeof j.toolsExpanded === 'boolean') setToolsExpanded(j.toolsExpanded)
          if (typeof j.cheatSheetMode === 'boolean') setCheatSheetMode(j.cheatSheetMode)
        } catch {
          /* ignore */
        }
      }
      setOpacity(Math.min(1, Math.max(0.28, nextOpacity)))
      const fromMain = await window.lawHelper.overlay.getClickThrough()
      setClickThrough(fromMain)
    })()
  }, [])

  useEffect(() => {
    const off = window.lawHelper.overlay.onClickThroughChanged((enabled) => setClickThrough(enabled))
    return () => off()
  }, [])

  useEffect(() => {
    void window.lawHelper.settings.set(
      UI_KEY,
      JSON.stringify({ opacity, layoutPreset, focusMode, fontScale, toolsExpanded, cheatSheetMode })
    )
    void window.lawHelper.settings.set('overlay_opacity', String(opacity))
  }, [opacity, layoutPreset, focusMode, fontScale, toolsExpanded, cheatSheetMode])

  useEffect(() => {
    void refresh()
    const off = window.lawHelper.overlay.onPinsUpdated(() => void refresh())
    const offSearch = window.lawHelper.overlay.onFocusSearch(() => {
      setLayoutPreset('full')
      setToolsExpanded(true)
      searchInputRef.current?.focus()
      setGlobalOpen(true)
    })
    return () => {
      off()
      offSearch()
    }
  }, [refresh])

  useEffect(() => {
    void window.lawHelper.tags.list().then((raw) => {
      const rows = raw as { id: string; name: string }[]
      setTagOptions(Array.isArray(rows) ? rows : [])
    })
  }, [])

  useEffect(() => {
    window.lawHelper.overlay.setOpacity(opacity)
  }, [opacity])

  useEffect(() => {
    window.lawHelper.overlay.setClickThrough(clickThrough)
  }, [clickThrough])

  useEffect(() => {
    const q = debouncedGlobal.trim()
    if (q.length < 2) {
      setGlobalHits([])
      return
    }
    void window.lawHelper.search
      .query(q, tagFilterId ? { tagIds: [tagFilterId] } : undefined)
      .then((raw) => {
        setGlobalHits(raw as SearchHit[])
      })
  }, [debouncedGlobal, tagFilterId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      const inField = tag === 'INPUT' || tag === 'TEXTAREA'
      if (e.key === 'Escape') {
        e.preventDefault()
        if (searchArticle) {
          setSearchArticle(null)
          return
        }
        setDetailId((current) => {
          if (current) return null
          void window.lawHelper.overlay.hide()
          return null
        })
        return
      }
      if (inField) return
      if (cheatSheetMode) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setIdx((i) => (pins.length ? (i - 1 + pins.length) % pins.length : 0))
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setIdx((i) => (pins.length ? (i + 1) % pins.length : 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pins.length, cheatSheetMode, searchArticle])

  useEffect(() => {
    if (!cheatSheetMode) {
      setDetailId(null)
      setSearchArticle(null)
    }
  }, [cheatSheetMode])

  useEffect(() => {
    if (detailId && !pins.some((p) => p.id === detailId)) setDetailId(null)
  }, [pins, detailId])

  const current = pins[idx] ?? null

  const filteredPins = useMemo(() => {
    const q = filterLocal.trim().toLowerCase()
    if (!q) return pins
    return pins.filter(
      (p) =>
        p.heading.toLowerCase().includes(q) ||
        p.body_clean.toLowerCase().includes(q) ||
        (p.summary_short?.toLowerCase().includes(q) ?? false) ||
        (p.penalty_hint?.toLowerCase().includes(q) ?? false) ||
        (p.document_title?.toLowerCase().includes(q) ?? false)
    )
  }, [pins, filterLocal])

  const detailPin = useMemo(
    () => (detailId ? pins.find((p) => p.id === detailId) ?? null : null),
    [pins, detailId]
  )

  const activeDetailArticle = searchArticle ?? detailPin

  const bodyDisplay = useMemo(() => {
    if (!current) return ''
    const raw = current.body_clean
    if (focusMode) {
      if (isReferenceImportDoc(current)) {
        if (!filterLocal.trim()) return raw
        return filterBody(raw, filterLocal)
      }
      return extractPenaltyHints(raw, 36)
    }
    if (!filterLocal.trim()) return raw
    return filterBody(raw, filterLocal)
  }, [current, focusMode, filterLocal])

  const detailBodyDisplay = useMemo(() => {
    if (!activeDetailArticle) return ''
    const raw = activeDetailArticle.body_clean
    if (focusMode) {
      if (isReferenceImportDoc(activeDetailArticle)) {
        if (!filterLocal.trim()) return raw
        return filterBody(raw, filterLocal)
      }
      return extractPenaltyHints(raw, 48)
    }
    if (!filterLocal.trim()) return raw
    return filterBody(raw, filterLocal)
  }, [activeDetailArticle, focusMode, filterLocal])

  async function unpin(id: string): Promise<void> {
    await window.lawHelper.overlay.unpin(id)
    void refresh()
  }

  async function movePin(from: number, dir: -1 | 1): Promise<void> {
    const to = from + dir
    if (to < 0 || to >= pins.length) return
    const next = [...pins]
    const [row] = next.splice(from, 1)
    if (!row) return
    next.splice(to, 0, row)
    setPins(next)
    setIdx(to)
    await window.lawHelper.overlay.reorderPins(next.map((p) => p.id))
  }

  async function openHit(h: SearchHit): Promise<void> {
    const row = await window.lawHelper.article.get(h.article_id)
    const mapped = mapArticleGetToPinned(row)
    if (!mapped) {
      alert('Статья не найдена в базе.')
      return
    }
    setSearchArticle(mapped)
    setDetailId(null)
    setGlobalOpen(false)
    setGlobalQ('')
    void window.lawHelper.overlay.raise()
  }

  return (
    <div
      className="box-border flex h-full min-h-0 max-h-full w-full max-w-full flex-1 flex-col rounded-xl border border-white/[0.12] bg-[#0a0d12] text-app shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_64px_rgba(0,0,0,0.55)]"
      style={{ WebkitFontSmoothing: 'antialiased' } as React.CSSProperties}
    >
      {/* Title bar */}
      <header
        className={`shrink-0 border-b border-white/[0.08] bg-black/20 px-2 ${chromeCompact ? 'py-1.5' : 'py-2'}`}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {chromeCompact ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 pl-0.5">
                <span className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-white/95">LexPatrol</span>
                <span className="text-[9px] text-white/35">
                  {layoutPreset === 'reading' ? 'чтение' : 'компакт'}
                </span>
              </div>
              <div
                className="flex shrink-0 flex-wrap items-center justify-end gap-1"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <button
                  type="button"
                  title="Полная панель: поиск, фильтр, настройки"
                  className="rounded-md border border-accent/35 bg-accent/15 px-2 py-1 text-[9px] font-semibold text-accent hover:bg-accent/25"
                  onClick={() => setLayoutPreset('full')}
                >
                  Панель
                </button>
                <ToolBtn title="Поверх всех окон" onClick={() => void window.lawHelper.overlay.raise()}>
                  ⧈
                </ToolBtn>
                <ToolBtn title="Слева" onClick={() => void window.lawHelper.overlay.dock('left')}>
                  ◀
                </ToolBtn>
                <ToolBtn title="Справа" onClick={() => void window.lawHelper.overlay.dock('right')}>
                  ▶
                </ToolBtn>
                <ToolBtn title="Угол" onClick={() => void window.lawHelper.overlay.dock('top-right')}>
                  ⤢
                </ToolBtn>
                <ToolBtn title="Скрыть (Esc)" onClick={() => void window.lawHelper.overlay.hide()} accent>
                  ✕
                </ToolBtn>
              </div>
            </div>
            <MouseModeRow
              clickThrough={clickThrough}
              onOverlay={() => setClickThrough(false)}
              onGame={() => setClickThrough(true)}
              variant="compact"
              hotkeyMouse={hkDisp.clickThrough}
            />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 pl-1">
                <span className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-white/95">LexPatrol</span>
                <span className="hidden text-[10px] text-white/35 sm:inline">·</span>
                <span className="hidden truncate text-[10px] text-app-muted sm:inline">оверлей</span>
              </div>
              <div
                className="flex shrink-0 flex-wrap items-center justify-end gap-1"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <ToolBtn title="Поверх всех окон" onClick={() => void window.lawHelper.overlay.raise()}>
                  ⧈
                </ToolBtn>
                <ToolBtn title="Слева" onClick={() => void window.lawHelper.overlay.dock('left')}>
                  ◀
                </ToolBtn>
                <ToolBtn title="Справа" onClick={() => void window.lawHelper.overlay.dock('right')}>
                  ▶
                </ToolBtn>
                <ToolBtn title="Угол" onClick={() => void window.lawHelper.overlay.dock('top-right')}>
                  ⤢
                </ToolBtn>
                <ToolBtn title="Скрыть (Esc)" onClick={() => void window.lawHelper.overlay.hide()} accent>
                  ✕
                </ToolBtn>
              </div>
            </div>

            <MouseModeRow
              clickThrough={clickThrough}
              onOverlay={() => setClickThrough(false)}
              onGame={() => setClickThrough(true)}
              variant="full"
              hotkeyMouse={hkDisp.clickThrough}
            />

            {/* Global search */}
        <div className="relative mt-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="flex items-center gap-2 rounded-lg border border-accent/25 bg-black/40 px-2 py-1.5 ring-1 ring-white/5">
            <span className="text-[10px] text-accent/90">⌕</span>
            <input
              ref={searchInputRef}
              id="overlay-search"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-white outline-none placeholder:text-white/25"
              placeholder="Поиск по всей базе…"
              value={globalQ}
              onChange={(e) => {
                setGlobalQ(e.target.value)
                setGlobalOpen(true)
              }}
              onFocus={() => setGlobalOpen(true)}
            />
            {globalQ && (
              <button
                type="button"
                className="text-[10px] text-white/40 hover:text-white"
                onClick={() => {
                  setGlobalQ('')
                  setGlobalHits([])
                }}
              >
                очистить
              </button>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-white/5 bg-black/25 px-2 py-1">
            <span className="shrink-0 text-[9px] uppercase tracking-wide text-white/40">тег FTS</span>
            <select
              className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-1 py-0.5 text-[10px] text-white outline-none"
              value={tagFilterId}
              onChange={(e) => setTagFilterId(e.target.value)}
            >
              <option value="">Все статьи</option>
              {tagOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          {globalOpen && globalHits.length > 0 && globalQ.trim().length >= 2 && (
            <ul
              className={`absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-lg border border-white/10 bg-[#0d1118] py-1 shadow-xl ${ovScroll}`}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {globalHits.slice(0, 8).map((h) => (
                <li key={h.article_id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-[11px] hover:bg-white/10"
                    onClick={() => void openHit(h)}
                  >
                    <div className="font-medium text-white/95">{h.heading}</div>
                    <div className="truncate text-[10px] text-app-muted">{h.document_title}</div>
                  </button>
                </li>
              ))}
              <li className="border-t border-white/5 px-2 py-1 text-[9px] text-app-muted">
                Просмотр статьи — в этом окне оверлея
              </li>
            </ul>
          )}
        </div>

        {toolsExpanded && (
          <div
            className="mt-2 space-y-2 border-t border-white/[0.06] pt-2"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              <span className="shrink-0 text-[9px] uppercase tracking-wide text-white/40">фильтр</span>
              <input
                ref={filterInputRef}
                className="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white outline-none focus:border-accent/50"
                placeholder="Отбор карточек по слову в тексте…"
                value={filterLocal}
                onChange={(e) => setFilterLocal(e.target.value)}
              />
            </label>

            <div>
              <div className="text-[9px] font-medium uppercase tracking-wide text-white/45">Режим закрепов</div>
              <div className="mt-1 flex rounded-lg border border-white/10 bg-black/40 p-0.5">
                <button
                  type="button"
                  title="Список карточек (суть, залог, наказание) и детали по клику"
                  onClick={() => setCheatSheetMode(true)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition ${
                    cheatSheetMode
                      ? 'bg-accent/35 text-white shadow-[0_0_0_1px_rgba(91,140,255,0.35)]'
                      : 'text-white/50 hover:bg-white/[0.06] hover:text-white/85'
                  }`}
                >
                  Карточки
                </button>
                <button
                  type="button"
                  title="Одна статья целиком; стрелки ← → переключают закрепы"
                  onClick={() => setCheatSheetMode(false)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition ${
                    !cheatSheetMode
                      ? 'bg-accent/35 text-white shadow-[0_0_0_1px_rgba(91,140,255,0.35)]'
                      : 'text-white/50 hover:bg-white/[0.06] hover:text-white/85'
                  }`}
                >
                  Читать
                </button>
              </div>
              <p className="mt-1 text-[9px] leading-snug text-white/42">
                {cheatSheetMode ? (
                  <>
                    Обзор по карточкам, полный текст в окне деталей. Переключение между статьями —{' '}
                    <span className="text-white/55">в списке или чипах на карточке</span> (стрелки клавиатуры здесь не
                    листают закрепы).
                  </>
                ) : (
                  <>
                    Полный текст одной статьи. <span className="text-white/55">← →</span> или точки внизу — между
                    закреплёнными статьями.
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-white/[0.05] pt-2">
              <LayoutPresetControl value={layoutPreset} onChange={setLayoutPreset} />
              <OverlayOptionToggle
                label="Фокус"
                hint="Карточки: превью и чип про санкции. Детали: без блока «Залог», тело — по строкам санкций. «Читать»: то же для текста."
                checked={focusMode}
                onChange={setFocusMode}
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.05] pt-2">
              <label className="flex items-center gap-1.5 text-[10px] text-app-muted">
                <span className="text-white/50">A</span>
                <input
                  type="range"
                  min={0.75}
                  max={1.35}
                  step={0.05}
                  value={fontScale}
                  onChange={(e) => setFontScale(Number(e.target.value))}
                  className="h-1 w-20 accent-accent"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[10px] text-app-muted">
                <span className="text-white/50">◐</span>
                <input
                  type="range"
                  min={0.28}
                  max={1}
                  step={0.01}
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  className="h-1 w-24 accent-accent"
                />
              </label>
            </div>
          </div>
        )}

            <button
              type="button"
              className="mt-1 w-full py-0.5 text-[9px] text-white/35 hover:text-white/60"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={() => setToolsExpanded((e) => !e)}
            >
              {toolsExpanded ? '▼ свернуть панель' : '▲ развернуть панель'}
            </button>
          </>
        )}
      </header>

      <div
        className={`flex min-h-0 flex-1 ${
          chromeCompact ? (readingComfort ? 'p-1.5' : 'p-1') : 'p-2'
        }`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <section className="min-h-0 w-full flex-1 overflow-hidden">
          {pins.length === 0 && !searchArticle ? (
            <div className="flex h-full flex-col justify-center rounded-xl border border-dashed border-white/15 bg-black/20 p-6 text-center">
              <p className="text-sm text-white/80">Нет закреплённых статей</p>
              <p className="mt-2 text-[11px] leading-relaxed text-app-muted">
                В LexPatrol откройте читатель и нажмите «На оверлей». Поиск по всей базе — в шапке; результат откроется здесь.
              </p>
            </div>
          ) : cheatSheetMode && !detailId && !searchArticle ? (
            <div
              className="flex h-full flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-b from-[#0c1018]/95 to-black/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              style={{ fontSize: `${11 * fontScale * readingSizeBoost}px` }}
            >
              <div
                className={`shrink-0 border-b border-white/[0.06] ${
                  chromeCompact ? (readingComfort ? 'px-2.5 py-1.5' : 'px-2 py-1') : 'px-3 py-2'
                }`}
              >
                {chromeCompact ? (
                  <div className="flex flex-col gap-1">
                    {readingComfort ? (
                      <p className="text-[9px] leading-snug text-accent/85">
                        Режим чтения — крупнее текст; поиск по базе — кнопка «Панель» или горячая клавиша.
                      </p>
                    ) : null}
                    <div className="flex justify-end">
                      <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9px] tabular-nums text-white/45">
                        {ruArticlesCount(pins.length)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-[10px] leading-snug text-white/70">
                        <span className="text-white/90">Карточки</span> — суть одним взглядом;{' '}
                        <span className="text-accent/90">клик</span> — полный текст.
                      </p>
                      <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9px] tabular-nums text-white/50">
                        {ruArticlesCount(pins.length)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[9px] text-app-muted">Esc — назад из деталей · скрыть окно — Esc ещё раз</p>
                  </>
                )}
              </div>
              <div
                className={`min-h-0 flex-1 overflow-auto pb-2 pt-2 ${readingComfort ? 'px-2.5' : 'px-2'} ${ovScroll}`}
              >
                {filteredPins.length === 0 ? (
                  <p className="p-4 text-center text-[11px] text-white/50">Нет совпадений по фильтру.</p>
                ) : (
                  <ul
                    className={`flex flex-col ${
                      chromeCompact ? (readingComfort ? 'gap-2' : 'gap-1.5') : 'gap-2'
                    }`}
                  >
                    {filteredPins.map((p) => {
                      const i = pins.findIndex((x) => x.id === p.id)
                      const meta = parseDisplayMeta(p.display_meta_json)
                      const bail = previewBail(meta, p.body_clean)
                      const pen = previewPenalty(p)
                      const penShort = pen.length > 72 ? `${pen.slice(0, 69)}…` : pen
                      const open = detailId === p.id
                      return (
                        <li key={p.id}>
                          <div
                            className={`overflow-hidden rounded-xl border bg-gradient-to-br from-black/50 to-black/25 shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition ${
                              open
                                ? 'border-accent/40 ring-1 ring-accent/25'
                                : 'border-white/[0.09] hover:border-accent/25 hover:bg-white/[0.03]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setSearchArticle(null)
                                setDetailId(p.id)
                              }}
                              className={`group w-full text-left ${
                                chromeCompact
                                  ? readingComfort
                                    ? 'px-3 pb-2 pt-2.5'
                                    : 'px-2.5 pb-1.5 pt-2'
                                  : 'px-3 pb-2 pt-2.5'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="shrink-0 rounded-md bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent">
                                  {p.article_number ?? '—'}
                                </span>
                                <span className="text-[11px] text-white/25 transition group-hover:text-accent/80">→</span>
                              </div>
                              <div className="mt-1.5 line-clamp-2 text-[11px] font-medium leading-snug text-white">
                                {articleDisplayTitle(p.article_number, p.heading)}
                              </div>
                              <p
                                className={`mt-1.5 text-[10px] leading-relaxed text-white/55 ${
                                  focusMode ? 'line-clamp-3' : readingComfort ? 'line-clamp-3' : 'line-clamp-2'
                                }`}
                              >
                                {previewCardEssenceLine(p, focusMode)}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {!focusMode && bail ? (
                                  <span className="max-w-full truncate rounded-md border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[9px] text-sky-100/90">
                                    Залог: {bail.length > 56 ? `${bail.slice(0, 53)}…` : bail}
                                  </span>
                                ) : null}
                                {pen && pen !== '—' ? (
                                  <span
                                    className={`max-w-full truncate rounded-md border px-1.5 py-0.5 text-[9px] ${
                                      isReferenceImportDoc(p)
                                        ? focusMode
                                          ? 'border-zinc-400/35 bg-zinc-500/15 font-medium text-zinc-100/95'
                                          : 'border-white/[0.12] bg-white/[0.06] text-white/78'
                                        : focusMode
                                          ? 'border-amber-400/45 bg-amber-500/15 font-medium text-amber-50/95'
                                          : 'border-amber-500/20 bg-amber-500/10 text-amber-100/90'
                                    }`}
                                  >
                                    {isReferenceImportDoc(p)
                                      ? penShort
                                      : focusMode
                                        ? `⚑ ${penShort}`
                                        : penShort}
                                  </span>
                                ) : null}
                              </div>
                            </button>
                            {i >= 0 ? (
                              <div
                                className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-2 py-1"
                                onMouseDown={(e) => e.preventDefault()}
                              >
                                <span className="pl-1 text-[9px] tabular-nums text-white/35">
                                  {i + 1}/{pins.length}
                                </span>
                                <div className="flex items-center gap-0.5">
                                  <MiniBtn onClick={() => void movePin(i, -1)} disabled={i === 0} title="Выше в списке">
                                    ↑
                                  </MiniBtn>
                                  <MiniBtn
                                    onClick={() => void movePin(i, 1)}
                                    disabled={i === pins.length - 1}
                                    title="Ниже в списке"
                                  >
                                    ↓
                                  </MiniBtn>
                                  <button
                                    type="button"
                                    className="rounded px-1.5 text-[10px] text-red-400/85 hover:bg-red-500/10"
                                    onClick={() => void unpin(p.id)}
                                    title="Снять с закрепа"
                                  >
                                    ⊗
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          ) : activeDetailArticle && (searchArticle || (cheatSheetMode && detailId)) ? (
            <ArticleDetailPane
              pin={activeDetailArticle}
              bodyText={detailBodyDisplay}
              fontScale={fontScale}
              compact={chromeCompact}
              readingComfort={readingComfort}
              focusMode={focusMode}
              fromSearch={Boolean(searchArticle)}
              onBack={() => {
                setSearchArticle(null)
                setDetailId(null)
              }}
              onOpenReader={() =>
                void window.lawHelper.openReader(activeDetailArticle.document_id, activeDetailArticle.id)
              }
            />
          ) : current ? (
            <div
              className="flex h-full flex-col rounded-xl border border-white/[0.08] bg-gradient-to-b from-black/40 to-black/25 p-3"
              style={{
                fontSize: `${12 * fontScale * readingSizeBoost}px`,
                lineHeight: chromeCompact ? (readingComfort ? 1.48 : 1.38) : 1.55
              }}
            >
              {pins.length > 1 ? (
                <div className={`mb-2 flex max-w-full gap-1 overflow-x-auto pb-1 ${ovScroll}`}>
                  {pins.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      title={articleDisplayTitle(p.article_number, p.heading)}
                      onClick={() => setIdx(i)}
                      className={`shrink-0 rounded-lg border px-2 py-1 text-[9px] transition ${
                        i === idx
                          ? 'border-accent/40 bg-accent/15 text-white'
                          : 'border-white/10 bg-black/30 text-white/55 hover:border-white/20 hover:text-white/85'
                      }`}
                    >
                      {p.article_number?.trim() || `#${i + 1}`}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="text-[10px] font-medium uppercase tracking-wide text-accent/80">{current.document_title}</div>
              <div className="mt-1.5 shrink-0 font-semibold leading-tight text-white">
                {articleDisplayTitle(current.article_number, current.heading)}
              </div>
              <MetaChips meta={parseDisplayMeta(current.display_meta_json)} />
              <div className={`mt-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap text-white/75 ${ovScroll}`}>
                {bodyDisplay}
              </div>
              {pins.length > 1 && (
                <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-white/[0.06] pt-2">
                  <div className="flex gap-1">
                    {pins.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        title={`Статья ${i + 1}`}
                        className={`h-1.5 w-1.5 rounded-full transition ${i === idx ? 'bg-accent' : 'bg-white/20 hover:bg-white/40'}`}
                        onClick={() => setIdx(i)}
                      />
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <NavBtn onClick={() => setIdx((i) => (i - 1 + pins.length) % pins.length)}>←</NavBtn>
                    <NavBtn onClick={() => setIdx((i) => (i + 1) % pins.length)}>→</NavBtn>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>

      <footer
        className="shrink-0 border-t border-white/[0.06] bg-black/25 px-2 py-1.5 text-[9px] leading-relaxed text-white/40"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {chromeCompact ? (
          <>
            <span className="text-white/55">⌨</span> «Панель» — поиск и настройки · ◀▶⤢ — позиция окна · {hkDisp.search}{' '}
            — то же · {hkDisp.clickThrough} — мышь · Esc — скрыть
          </>
        ) : (
          <>
            <span className="text-white/55">⌨</span> {hkDisp.toggle} — окно · {hkDisp.search} — поиск · {hkDisp.clickThrough}{' '}
            — режим мыши (оверлей ↔ игра)
            {cheatSheetMode ? (
              <>
                {' '}
                · в режиме «Карточки» <span className="text-white/55">← →</span> не переключают закрепы
              </>
            ) : (
              <>
                {' '}
                · <span className="text-white/55">← →</span> между статьями в режиме «Читать»
              </>
            )}
            {' '}
            · Esc — из деталей или скрыть окно
            <span className="mt-1 block text-white/35">
              Отдельные окна: {hkDisp.cheatsOverlay} — шпаргалки · {hkDisp.collectionsOverlay} — подборки
            </span>
          </>
        )}
      </footer>
    </div>
  )
}

function ArticleDetailPane({
  pin,
  bodyText,
  fontScale,
  compact,
  readingComfort,
  focusMode,
  fromSearch,
  onBack,
  onOpenReader
}: {
  pin: Pinned
  bodyText: string
  fontScale: number
  compact: boolean
  /** Узкая шапка + укрупнение для чтения в игре */
  readingComfort?: boolean
  focusMode: boolean
  fromSearch?: boolean
  onBack: () => void
  onOpenReader: () => void
}): JSX.Element {
  const meta = parseDisplayMeta(pin.display_meta_json)
  const bail = meta.bailHint?.trim() || previewBail(meta, pin.body_clean)
  const showBailBlock = Boolean(bail) && !focusMode
  const referenceDoc = isReferenceImportDoc(pin)
  const hasSummary = Boolean(pin.summary_short?.trim() || showBailBlock || pin.penalty_hint?.trim())
  const sections = useMemo(() => splitBodyForReading(bodyText), [bodyText])

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/[0.1] bg-gradient-to-b from-[#0a0e14]/98 via-[#080b10]/95 to-black/90 shadow-[inset_0_0_0_1px_rgba(91,140,255,0.08),0_12px_40px_rgba(0,0,0,0.45)]"
      style={{
        fontSize: `${12 * fontScale * (readingComfort ? 1.085 : 1)}px`,
        lineHeight: compact ? (readingComfort ? 1.52 : 1.42) : 1.58
      }}
    >
      <div className="shrink-0 border-b border-white/[0.07] bg-black/30 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[10px] font-medium text-white/95 hover:bg-white/10"
            onClick={onBack}
          >
            ← К списку
          </button>
          <div className="flex flex-wrap gap-1.5">
            {pin.document_id ? (
              <button
                type="button"
                className="rounded-lg border border-accent/35 bg-accent/15 px-2.5 py-1.5 text-[10px] font-medium text-accent hover:bg-accent/25"
                onClick={onOpenReader}
              >
                Открыть в LexPatrol
              </button>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-accent/85">{pin.document_title}</p>
        <h2 className="mt-1 text-[15px] font-semibold leading-snug text-white sm:text-[16px]">
          {articleDisplayTitle(pin.article_number, pin.heading)}
        </h2>
        {fromSearch ? (
          <p className="mt-1.5 text-[9px] leading-snug text-accent/90">
            Результат поиска по базе — без переключения на главное окно. «Открыть в LexPatrol» — полный читатель.
          </p>
        ) : null}
        <MetaChips meta={meta} omitBail />
      </div>

      {hasSummary ? (
        <div className="shrink-0 space-y-2 border-b border-white/[0.06] bg-black/20 px-3 py-3">
          {pin.summary_short?.trim() ? (
            <div className="rounded-lg border border-white/[0.07] bg-black/35 px-3 py-2">
              <div className="text-[9px] font-medium uppercase tracking-wide text-white/45">Суть</div>
              <p className="mt-1 text-[11px] leading-relaxed text-white/88">{pin.summary_short.trim()}</p>
            </div>
          ) : null}
          {showBailBlock ? (
            <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.07] px-3 py-2">
              <div className="text-[9px] font-medium uppercase tracking-wide text-sky-200/70">Залог</div>
              <p className="mt-1 text-[11px] leading-relaxed text-sky-50/95">{bail}</p>
            </div>
          ) : null}
          {pin.penalty_hint?.trim() ? (
            <div
              className={
                referenceDoc
                  ? 'rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2'
                  : 'rounded-lg border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2'
              }
            >
              <div
                className={`text-[9px] font-medium uppercase tracking-wide ${
                  referenceDoc ? 'text-white/50' : 'text-amber-200/75'
                }`}
              >
                {referenceDoc ? 'Пояснение' : 'Наказание'}
              </div>
              <p
                className={`mt-1 text-[11px] leading-relaxed ${
                  referenceDoc ? 'text-white/88' : 'text-amber-50/95'
                }`}
              >
                {pin.penalty_hint.trim()}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={`min-h-0 flex-1 overflow-y-auto px-3 py-3 ${ovScroll}`}>
        {!bodyText.trim() ? (
          <p className="text-[11px] text-white/45">Нет текста.</p>
        ) : sections.length > 1 ? (
          <div className="space-y-3">
            {sections.map((chunk, i) => (
              <div
                key={i}
                className="rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2.5 shadow-sm"
              >
                <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-white/85">{chunk}</pre>
              </div>
            ))}
          </div>
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-white/85">{bodyText}</pre>
        )}
      </div>
    </div>
  )
}

/** Разбивает текст на визуальные блоки (части, фрагменты после ---). */
function splitBodyForReading(body: string): string[] {
  const t = body.replace(/\r\n/g, '\n').trim()
  if (!t) return []
  const byDelimiter = t.split(/\n-{3,}\n/)
  if (byDelimiter.length > 1) return byDelimiter.map((s) => s.trim()).filter(Boolean)
  const lines = t.split('\n')
  const chunks: string[] = []
  let buf: string[] = []
  const flush = () => {
    const s = buf.join('\n').trim()
    if (s) chunks.push(s)
    buf = []
  }
  for (const line of lines) {
    if (/^(?:Часть|часть|ч\.)\s+/i.test(line.trim())) {
      flush()
      buf.push(line)
    } else {
      buf.push(line)
    }
  }
  flush()
  return chunks.length > 1 ? chunks : [t]
}

function ToolBtn({
  children,
  onClick,
  title,
  accent
}: {
  children: ReactNode
  onClick: () => void
  title: string
  accent?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-lg border px-2 py-1 text-[11px] transition active:scale-95 ${
        accent
          ? 'border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20'
          : 'border-white/10 bg-white/[0.06] text-white/90 hover:bg-white/12'
      }`}
    >
      {children}
    </button>
  )
}

function MiniBtn({
  children,
  onClick,
  disabled,
  title
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  title: string
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded bg-white/10 px-1.5 text-[10px] text-white/80 disabled:opacity-30 hover:bg-white/15"
    >
      {children}
    </button>
  )
}

function NavBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-[12px] text-white hover:bg-white/10"
    >
      {children}
    </button>
  )
}

/** Три пресета шапки: компакт / чтение / полная панель */
function LayoutPresetControl({
  value,
  onChange
}: {
  value: OverlayLayoutPreset
  onChange: (p: OverlayLayoutPreset) => void
}): JSX.Element {
  const items: { id: OverlayLayoutPreset; label: string; title: string }[] = [
    { id: 'compact', label: 'Компакт', title: 'Минимум места в углу экрана' },
    { id: 'reading', label: 'Чтение', title: 'Такая же узкая шапка, но крупнее текст карточек и статьи' },
    { id: 'full', label: 'Панель', title: 'Поиск по базе, фильтры и все переключатели' }
  ]
  return (
    <div className="min-w-0 flex-1 sm:max-w-lg">
      <div className="text-[9px] font-medium uppercase tracking-wide text-white/45">Режим окна</div>
      <div className="mt-1 flex rounded-lg border border-white/10 bg-black/40 p-0.5">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            title={it.title}
            onClick={() => onChange(it.id)}
            className={`flex-1 rounded-md px-1.5 py-1.5 text-[10px] font-semibold transition sm:px-2 ${
              value === it.id
                ? 'bg-accent/35 text-white shadow-[0_0_0_1px_rgba(91,140,255,0.35)]'
                : 'text-white/50 hover:bg-white/[0.06] hover:text-white/88'
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[9px] leading-snug text-white/42">
        Для игры часто удобнее «Чтение»: меньше отвлекает шапка, текст крупнее. Горячая клавиша поиска открывает полную панель.
      </p>
    </div>
  )
}

/** Чекбокс с короткой подписью смысла — не теряется логика «Компакт» / «Фокус». */
function OverlayOptionToggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <label className="flex max-w-[220px] cursor-pointer gap-2">
      <input
        type="checkbox"
        className="mt-0.5 accent-accent"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-[10px] font-medium text-white/88">{label}</span>
        <span className="mt-0.5 block text-[9px] leading-snug text-white/45">{hint}</span>
      </span>
    </label>
  )
}

function MetaChips({ meta, omitBail }: { meta: ArticleDisplayMeta; omitBail?: boolean }): JSX.Element | null {
  const chips: ReactNode[] = []
  if (!omitBail && meta.bailHint?.trim()) {
    const b = meta.bailHint.trim()
    chips.push(
      <span key="bail" className="max-w-full truncate rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-100/95" title={b}>
        Залог {b.length > 48 ? `${b.slice(0, 45)}…` : b}
      </span>
    )
  }
  if (meta.stars != null && meta.stars > 0) {
    chips.push(
      <span key="stars" className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-100/95">
        ★ {meta.stars}
      </span>
    )
  }
  if (meta.fineUsd != null && meta.fineUsd > 0) {
    chips.push(
      <span key="usd" className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-100/90">
        {Math.round(meta.fineUsd).toLocaleString('ru-RU')}$
      </span>
    )
  }
  if (meta.fineRub != null && meta.fineRub > 0) {
    chips.push(
      <span key="rub" className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-100/90">
        {Math.round(meta.fineRub).toLocaleString('ru-RU')} ₽
      </span>
    )
  }
  if (meta.ukArticle) {
    chips.push(
      <span key="uk" className="rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-100/90">
        УК {meta.ukArticle}
      </span>
    )
  }
  if (!chips.length) return null
  return <div className="mt-2 flex flex-wrap gap-1">{chips}</div>
}

function filterBody(body: string, q: string): string {
  if (!q.trim()) return body
  const lines = body.split('\n')
  const hit = lines.filter((l) => l.toLowerCase().includes(q.toLowerCase()))
  return hit.length ? hit.slice(0, 28).join('\n') : body.slice(0, 1800)
}
