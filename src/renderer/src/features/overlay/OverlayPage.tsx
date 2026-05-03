import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { articleDisplayTitle } from '@shared/article-display'
import { extractPenaltyHints } from '@parsers/article-split'
import type { ArticleDisplayMeta } from '@parsers/article-enrichment'
import { ArticleMetaChips } from '@/components/ArticleMetaChips'

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
type OverlayArticleListMode = 'cards' | 'dense'
type OverlayInteractionMode = 'game' | 'interactive'
type OverlayUiPrefs = {
  layoutPreset?: OverlayLayoutPreset
  opacity?: number
  focusMode?: boolean
  fontScale?: number
  /** Яркость содержимого оверлея, 0.75–1.25 */
  overlayBrightness?: number
  cheatSheetMode?: boolean
  articleListMode?: OverlayArticleListMode
}

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

function OverlayInteractionModeRow({
  mode,
  onChange
}: {
  mode: OverlayInteractionMode
  onChange: (mode: OverlayInteractionMode) => void
}): JSX.Element {
  const btnPad = 'px-2 py-1.5 text-[10px]'
  return (
    <div className="mt-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div className="text-[9px] font-medium uppercase tracking-wide text-[#6b6582]">Режим</div>
      <div className="mt-1 flex rounded-lg border border-[#322c4d] bg-[#1d192a] p-0.5 shadow-inner">
        <button
          type="button"
          title="Показывать без захвата фокуса, чтобы игра продолжала получать ввод"
          className={`flex-1 rounded-md font-semibold transition ${btnPad} ${
            mode === 'game'
              ? 'bg-[#3c2e7a] text-[#e6e3ee] shadow-[inset_0_0_0_1px_#5a4ab0]'
              : 'text-[#8a8497] can-hover:hover:bg-[#2a2540] can-hover:hover:text-[#e6e3ee]'
          }`}
          onClick={() => onChange('game')}
        >
          Игровой
        </button>
        <button
          type="button"
          title="Оверлей ведёт себя как активное окно и сразу принимает клавиатуру"
          className={`flex-1 rounded-md font-semibold transition ${btnPad} ${
            mode === 'interactive'
              ? 'bg-[#3c2e7a] text-[#e6e3ee] shadow-[inset_0_0_0_1px_#5a4ab0]'
              : 'text-[#8a8497] can-hover:hover:bg-[#2a2540] can-hover:hover:text-[#e6e3ee]'
          }`}
          onClick={() => onChange('interactive')}
        >
          Интерактивный
        </button>
      </div>
    </div>
  )
}

function ArticleRail({
  pins,
  activeId,
  onSelect
}: {
  pins: Pinned[]
  activeId: string | null
  onSelect: (pin: Pinned, index: number) => void
}): JSX.Element {
  return (
    <aside
      className={`mr-1 flex w-10 shrink-0 flex-col gap-1 overflow-y-auto rounded-xl border border-[#322c4d] bg-[#1d192a] p-1 sm:mr-1.5 sm:w-12 ${ovScroll}`}
    >
      {pins.map((p, i) => {
        const active = p.id === activeId
        return (
          <button
            key={p.id}
            type="button"
            title={articleDisplayTitle(p.article_number, p.heading)}
            onClick={() => onSelect(p, i)}
            className={`group flex h-9 w-full items-center justify-center rounded-lg border text-[9px] font-semibold transition ${
              active
                ? 'border-[#5a4ab0] bg-[#3c2e7a] text-[#e6e3ee] shadow-[inset_0_0_0_1px_#5a4ab0]'
                : 'border-[#2a2540] bg-[#15121e] text-[#8a8497] can-hover:hover:border-[#322c4d] can-hover:hover:bg-[#1d192a] can-hover:hover:text-[#e6e3ee]'
            }`}
          >
            <span className="max-w-[2.2rem] truncate font-mono">{p.article_number?.trim() || i + 1}</span>
          </button>
        )
      })}
    </aside>
  )
}

function OverlayPositionControl(): JSX.Element {
  const items: Array<{ id: Parameters<typeof window.lawHelper.overlay.dock>[0]; label: string; title: string }> = [
    { id: 'compact-top-right', label: 'Авто', title: 'Компактно в правом верхнем углу' },
    { id: 'wide-right', label: 'Справа+', title: 'Широкая панель справа для большого списка' },
    { id: 'top-left', label: 'СВ', title: 'Левый верхний угол' },
    { id: 'top-right', label: 'СЗ', title: 'Правый верхний угол' },
    { id: 'bottom-left', label: 'НЛ', title: 'Левый нижний угол' },
    { id: 'bottom-right', label: 'НП', title: 'Правый нижний угол' }
  ]
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-medium uppercase tracking-wide text-[#6b6582]">Положение</div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            title={it.title}
            onClick={() => void window.lawHelper.overlay.dock(it.id)}
            className="min-w-0 rounded-lg border border-[#322c4d] bg-[#1d192a] px-1.5 py-1.5 text-[9px] font-semibold text-[#b8b3cc] transition can-hover:hover:border-[#5a4ab0] can-hover:hover:bg-[#3c2e7a]/40 can-hover:hover:text-[#e6e3ee] sm:px-2 sm:text-[10px]"
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function DensePinnedList({
  pins,
  focusMode,
  selectedId,
  onOpen,
  onMove,
  onUnpin
}: {
  pins: Pinned[]
  focusMode: boolean
  selectedId: string | null
  onOpen: (pin: Pinned, index: number) => void
  onMove: (index: number, dir: -1 | 1) => void
  onUnpin: (id: string) => void
}): JSX.Element {
  return (
    <ul className="flex flex-col gap-1">
      {pins.map((p, i) => {
        const pen = previewPenalty(p)
        const active = p.id === selectedId
        return (
          <li
            key={p.id}
            className={`overflow-hidden rounded-lg border bg-[#1d192a] transition ${
              active ? 'border-[#5a4ab0] bg-[#3c2e7a]/25' : 'border-[#322c4d] can-hover:hover:border-[#5a4ab0]/50 can-hover:hover:bg-[#15121e]'
            }`}
          >
            <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
              <button
                type="button"
                title="Открыть статью в оверлее"
                onClick={() => onOpen(p, i)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded-md bg-[#3c2e7a] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#c9c0f0]">
                    {p.article_number ?? i + 1}
                  </span>
                  <span className="truncate text-[10px] font-medium text-[#e6e3ee]">
                    {articleDisplayTitle(p.article_number, p.heading)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[9px] text-[#8a8497]">
                  {focusMode && pen !== '—' ? pen : previewEssenceLine(p)}
                </p>
              </button>
              <div className="flex shrink-0 items-center gap-0.5">
                <MiniBtn onClick={() => onMove(i, -1)} disabled={i === 0} title="Выше">
                  ↑
                </MiniBtn>
                <MiniBtn onClick={() => onMove(i, 1)} disabled={i === pins.length - 1} title="Ниже">
                  ↓
                </MiniBtn>
                <button
                  type="button"
                  className="rounded px-1.5 text-[10px] text-red-400/85 can-hover:hover:bg-red-500/10"
                  onClick={() => onUnpin(p.id)}
                  title="Снять с закрепа"
                >
                  ⊗
                </button>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Полоска под шапкой: основные сочетания с короткими подписями (подсказка в title). */
function OverlayQuickHotkeyStrip({
  hk,
  density
}: {
  hk: { toggle: string; search: string; clickThrough: string }
  density: 'compact' | 'normal' | 'comfort'
}): JSX.Element {
  const items: { key: string; combo: string; label: string; title: string }[] = [
    {
      key: 'toggle',
      combo: hk.toggle,
      label: 'оверлей',
      title: `${hk.toggle} — показать или скрыть оверлей`
    },
    {
      key: 'search',
      combo: hk.search,
      label: 'поиск',
      title: `${hk.search} — фокус в поле поиска по базе`
    },
    {
      key: 'mouse',
      combo: hk.clickThrough,
      label: 'мышь → игра',
      title: `${hk.clickThrough} — клики и курсор уходят в игру, оверлей их не ловит (остаётся на экране)`
    }
  ]
  const pad = density === 'compact' ? 'py-0.5' : density === 'comfort' ? 'py-1.5' : 'py-1'
  return (
    <div
      className={`flex shrink-0 flex-nowrap items-center gap-1 overflow-x-auto border-b border-[#2a2540] bg-[linear-gradient(105deg,#1c1828_0%,#15121e_42%,#1a1626_100%)] px-2 ${pad} ${ovScroll}`}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      role="group"
      aria-label="Основные горячие клавиши"
    >
      <span
        className={`mr-0.5 shrink-0 font-medium uppercase tracking-wider text-[#5c5670] ${
          density === 'compact' ? 'text-[7px]' : 'text-[8px]'
        }`}
      >
        ⌨
      </span>
      {items.map((it) => (
        <span
          key={it.key}
          title={it.title}
          className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-[#322c4d]/85 bg-black/22 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${
            density === 'compact' ? 'px-1 py-px' : 'px-1.5 py-0.5'
          }`}
        >
          <kbd
            className={`max-w-[9.5rem] truncate font-mono font-semibold tracking-tight text-[#d4cef7] ${
              density === 'compact' ? 'text-[7px]' : 'text-[8px] sm:text-[9px]'
            }`}
          >
            {it.combo}
          </kbd>
          <span
            className={`max-w-[5.5rem] truncate font-sans normal-case text-[#8a8497] ${
              density === 'compact' ? 'text-[7px]' : 'text-[8px]'
            }`}
          >
            {it.label}
          </span>
        </span>
      ))}
      <span
        className={`ml-auto shrink-0 pl-1 font-sans text-[#5c5670] ${
          density === 'compact' ? 'text-[7px]' : 'text-[8px]'
        }`}
        title="Полный список сочетаний — кнопка «?» внизу справа"
      >
        ? внизу
      </span>
    </div>
  )
}

function OverlayHotkeysModal({
  hk,
  onClose
}: {
  hk: {
    toggle: string
    search: string
    clickThrough: string
    cheatsOverlay: string
    collectionsOverlay: string
  }
  onClose: () => void
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="max-h-[min(80vh,420px)] w-full max-w-md overflow-y-auto rounded-xl border border-[#322c4d] bg-[#1d192a] p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[12px] font-semibold text-[#e6e3ee]">Сочетания клавиш</h2>
          <button
            type="button"
            className="rounded-md px-2 py-0.5 text-[11px] text-[#8a8497] can-hover:hover:bg-[#2a2540] can-hover:hover:text-[#e6e3ee]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <ul className="mt-3 space-y-2 text-[10px] leading-relaxed text-[#b8b3cc]">
          <li>
            <span className="font-mono text-[#c9c0f0]">{hk.toggle}</span> — показать или скрыть оверлей
          </li>
          <li>
            <span className="font-mono text-[#c9c0f0]">{hk.search}</span> — фокус в поле поиска по базе
          </li>
          <li>
            <span className="font-mono text-[#c9c0f0]">{hk.clickThrough}</span> — мышь: оверлей ↔ игра
            <p className="mt-1 text-[9px] leading-snug text-[#8a8497]">
              В режиме «клики в игру» курсор и нажатия не попадают в окно оверлея — они уходят в игру под ним. Оверлей
              остаётся на экране, но LexPatrol не перехватывает мышь (удобно кликать по HUD игры, не закрывая подсказку).
              Вернуть клики в оверлей — тем же сочетанием или переключателем «Мышь в оверлее» в настройках оверлея.
            </p>
          </li>
          <li>
            <span className="font-mono text-[#c9c0f0]">{hk.cheatsOverlay}</span> — окно шпаргалок
          </li>
          <li>
            <span className="font-mono text-[#c9c0f0]">{hk.collectionsOverlay}</span> — окно подборок
          </li>
          <li className="text-[#8a8497]">
            Кнопка 📌 в шапке (без хоткея) — если оверлей оказался под игрой или другим окном, снова вывести его
            поверх.
          </li>
          <li className="text-[#8a8497]">Esc — из деталей статьи или скрыть оверлей</li>
          <li className="text-[#8a8497]">
            В режиме «Карточки» стрелки ← → на клавиатуре не переключают закрепы; в режиме «Читать» — переключают.
          </li>
        </ul>
      </div>
    </div>
  )
}

export function OverlayPage(): JSX.Element {
  const [pins, setPins] = useState<Pinned[]>([])
  const [idx, setIdx] = useState(0)
  const [opacity, setOpacity] = useState(0.94)
  const [clickThrough, setClickThrough] = useState(false)
  const [overlayInteractionMode, setOverlayInteractionMode] = useState<OverlayInteractionMode>('game')
  const [globalQ, setGlobalQ] = useState('')
  const debouncedGlobal = useDebounced(globalQ, 280)
  const [tagFilterId, setTagFilterId] = useState('')
  const [tagOptions, setTagOptions] = useState<{ id: string; name: string }[]>([])
  const [globalHits, setGlobalHits] = useState<SearchHit[]>([])
  const [globalOpen, setGlobalOpen] = useState(false)
  const [layoutPreset, setLayoutPreset] = useState<OverlayLayoutPreset>('full')
  const [focusMode, setFocusMode] = useState(false)
  const [fontScale, setFontScale] = useState(1)
  const [overlayBrightness, setOverlayBrightness] = useState(1)
  const [articleListMode, setArticleListMode] = useState<OverlayArticleListMode>('cards')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hotkeysModalOpen, setHotkeysModalOpen] = useState(false)
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
  const overlayRootRef = useRef<HTMLDivElement>(null)
  const [overlayDensity, setOverlayDensity] = useState<'compact' | 'normal' | 'comfort'>('normal')
  const [uiScale, setUiScale] = useState(1)
  const chromeCompact = isChromeCompact(layoutPreset)
  const readingComfort = layoutPreset === 'reading'
  const readingSizeBoost = readingComfort ? 1.085 : 1

  const refresh = useCallback(async () => {
    const rows = (await window.lawHelper.overlay.getPinned()) as Pinned[]
    setPins(rows)
    setIdx((i) => Math.min(i, Math.max(0, rows.length - 1)))
  }, [])

  useEffect(() => {
    void (async () => {
      const [opRaw, ctRaw, raw, interactionMode] = await Promise.all([
        window.lawHelper.settings.get('overlay_opacity'),
        window.lawHelper.settings.get('overlay_click_through'),
        window.lawHelper.settings.get(UI_KEY),
        window.lawHelper.overlay.getInteractionMode()
      ])
      if (ctRaw === '1' || ctRaw === '0') setClickThrough(ctRaw === '1')
      let nextOpacity = 0.94
      if (opRaw) {
        const n = Number(opRaw)
        if (!Number.isNaN(n)) nextOpacity = n
      }
      if (raw) {
        try {
          const j = JSON.parse(raw) as OverlayUiPrefs & { compact?: boolean }
          if (j.layoutPreset === 'compact' || j.layoutPreset === 'reading' || j.layoutPreset === 'full') {
            setLayoutPreset(j.layoutPreset)
          } else if (typeof j.compact === 'boolean') {
            setLayoutPreset(j.compact ? 'compact' : 'full')
          }
          if (typeof j.opacity === 'number') nextOpacity = j.opacity
          if (typeof j.focusMode === 'boolean') setFocusMode(j.focusMode)
          if (typeof j.fontScale === 'number') setFontScale(j.fontScale)
          if (typeof j.overlayBrightness === 'number') {
            setOverlayBrightness(Math.min(1.25, Math.max(0.75, j.overlayBrightness)))
          }
          if (typeof j.cheatSheetMode === 'boolean') setCheatSheetMode(j.cheatSheetMode)
          if (j.articleListMode === 'cards' || j.articleListMode === 'dense') setArticleListMode(j.articleListMode)
        } catch {
          /* ignore */
        }
      }
      setOpacity(Math.min(1, Math.max(0.28, nextOpacity)))
      const fromMain = await window.lawHelper.overlay.getClickThrough()
      setClickThrough(fromMain)
      setOverlayInteractionMode(interactionMode)
    })()
  }, [])

  useEffect(() => {
    void window.lawHelper.overlay.applyLayoutPreset(layoutPreset)
  }, [layoutPreset])

  useEffect(() => {
    const el = overlayRootRef.current
    if (!el) return
    const apply = (): void => {
      const h = el.getBoundingClientRect().height
      let s = 1
      if (h > 0 && h < 700) s = 0.92
      else if (h > 1400) s = 1.08
      setUiScale(s)
      el.style.setProperty('--ui-scale', String(s))
      if (h > 0 && h < 600) setOverlayDensity('compact')
      else if (h > 800) setOverlayDensity('comfort')
      else setOverlayDensity('normal')
    }
    apply()
    const ro = new ResizeObserver(() => apply())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const changeOverlayInteractionMode = useCallback((mode: OverlayInteractionMode): void => {
    setOverlayInteractionMode(mode)
    void window.lawHelper.overlay.setInteractionMode(mode)
  }, [])

  useEffect(() => {
    const off = window.lawHelper.overlay.onClickThroughChanged((enabled) => setClickThrough(enabled))
    return () => off()
  }, [])

  useEffect(() => {
    const off = window.lawHelper.overlay.onApplyUiPrefs((prefs) => {
      if (prefs.layoutPreset === 'compact' || prefs.layoutPreset === 'reading' || prefs.layoutPreset === 'full') {
        setLayoutPreset(prefs.layoutPreset)
      }
      if (typeof prefs.opacity === 'number') setOpacity(Math.min(1, Math.max(0.28, prefs.opacity)))
      if (typeof prefs.focusMode === 'boolean') setFocusMode(prefs.focusMode)
      if (typeof prefs.fontScale === 'number') setFontScale(Math.min(1.35, Math.max(0.86, prefs.fontScale)))
      if (typeof prefs.overlayBrightness === 'number') {
        setOverlayBrightness(Math.min(1.25, Math.max(0.75, prefs.overlayBrightness)))
      }
      if (typeof prefs.cheatSheetMode === 'boolean') setCheatSheetMode(prefs.cheatSheetMode)
      if (prefs.articleListMode === 'cards' || prefs.articleListMode === 'dense') setArticleListMode(prefs.articleListMode)
    })
    return () => off()
  }, [])

  useEffect(() => {
    void window.lawHelper.settings.set(
      UI_KEY,
      JSON.stringify({
        opacity,
        layoutPreset,
        focusMode,
        fontScale,
        overlayBrightness,
        cheatSheetMode,
        articleListMode
      })
    )
    void window.lawHelper.settings.set('overlay_opacity', String(opacity))
  }, [opacity, layoutPreset, focusMode, fontScale, overlayBrightness, cheatSheetMode, articleListMode])

  useEffect(() => {
    void refresh()
    const off = window.lawHelper.overlay.onPinsUpdated(() => void refresh())
    const offSearch = window.lawHelper.overlay.onFocusSearch(() => {
      setSettingsOpen(false)
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
    const onVis = (): void => {
      if (document.visibilityState === 'hidden') {
        setSettingsOpen(false)
        setHotkeysModalOpen(false)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

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
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (e.key === 'Escape') {
        e.preventDefault()
        if (hotkeysModalOpen) {
          setHotkeysModalOpen(false)
          return
        }
        if (settingsOpen) {
          setSettingsOpen(false)
          return
        }
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

      if (!inField && (e.ctrlKey || e.metaKey) && e.key === ',' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        setSettingsOpen((o) => !o)
        return
      }

      if (!inField && (e.key === '?' || (e.key === '/' && e.shiftKey))) {
        e.preventDefault()
        setHotkeysModalOpen(true)
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
  }, [pins.length, cheatSheetMode, searchArticle, settingsOpen, hotkeysModalOpen])

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
    const q = globalQ.trim().toLowerCase()
    if (!q) return pins
    return pins.filter(
      (p) =>
        p.heading.toLowerCase().includes(q) ||
        p.body_clean.toLowerCase().includes(q) ||
        (p.summary_short?.toLowerCase().includes(q) ?? false) ||
        (p.penalty_hint?.toLowerCase().includes(q) ?? false) ||
        (p.document_title?.toLowerCase().includes(q) ?? false)
    )
  }, [pins, globalQ])

  const detailPin = useMemo(
    () => (detailId ? pins.find((p) => p.id === detailId) ?? null : null),
    [pins, detailId]
  )

  const activeDetailArticle = searchArticle ?? detailPin
  const selectedPinnedId = detailPin?.id ?? current?.id ?? null
  const showArticleRail = pins.length >= 4 && !searchArticle

  const openPinnedInOverlay = useCallback(
    (pin: Pinned, index: number): void => {
      setSearchArticle(null)
      setIdx(index)
      if (cheatSheetMode) {
        setDetailId(pin.id)
      } else {
        setDetailId(null)
      }
    },
    [cheatSheetMode]
  )

  const bodyDisplay = useMemo(() => {
    if (!current) return ''
    const raw = current.body_clean
    if (focusMode) {
      if (isReferenceImportDoc(current)) {
        if (!globalQ.trim()) return raw
        return filterBody(raw, globalQ)
      }
      return extractPenaltyHints(raw, 36)
    }
    if (!globalQ.trim()) return raw
    return filterBody(raw, globalQ)
  }, [current, focusMode, globalQ])

  const detailBodyDisplay = useMemo(() => {
    if (!activeDetailArticle) return ''
    const raw = activeDetailArticle.body_clean
    if (focusMode) {
      if (isReferenceImportDoc(activeDetailArticle)) {
        if (!globalQ.trim()) return raw
        return filterBody(raw, globalQ)
      }
      return extractPenaltyHints(raw, 48)
    }
    if (!globalQ.trim()) return raw
    return filterBody(raw, globalQ)
  }, [activeDetailArticle, focusMode, globalQ])

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

  const footerCounter = pins.length > 0 ? `${idx + 1}/${pins.length}` : '—'

  return (
    <div
      ref={overlayRootRef}
      data-overlay-density={overlayDensity}
      className="lex-overlay-root box-border flex h-full min-h-0 max-h-full w-full max-w-full flex-1 flex-col overflow-hidden rounded-xl border border-[#322c4d] bg-[#15121e] text-[#e6e3ee] shadow-[0_0_0_1px_rgba(90,74,176,0.12),0_24px_64px_rgba(0,0,0,0.55)]"
      style={
        {
          WebkitFontSmoothing: 'antialiased',
          filter: `brightness(${overlayBrightness})`,
          ['--ui-scale' as string]: String(uiScale)
        } as React.CSSProperties
      }
    >
      {hotkeysModalOpen ? <OverlayHotkeysModal hk={hkDisp} onClose={() => setHotkeysModalOpen(false)} /> : null}

      <header
        className="flex h-9 shrink-0 items-center justify-between border-b border-[#2a2540] bg-[#15121e] px-2"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="select-none text-[11px] font-bold uppercase tracking-[0.14em] text-[#e6e3ee]">LEXPATROL</span>
        <div
          className="flex shrink-0 items-center gap-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            type="button"
            title="Настройки (Ctrl+,)"
            className={`inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded-md px-2 py-1 text-[13px] leading-none transition ${
              settingsOpen ? 'bg-[#3c2e7a] text-[#c9c0f0]' : 'text-[#b8b3cc] can-hover:hover:bg-[#1d192a]'
            }`}
            onClick={() => setSettingsOpen((o) => !o)}
          >
            ⚙
          </button>
          <button
            type="button"
            title="Если оверлей ушёл под игру или другое окно — нажмите, чтобы снова показать его поверх (не мышь в игру и не закреп позиции)"
            className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded-md px-2 py-1 text-[13px] leading-none text-[#b8b3cc] can-hover:hover:bg-[#1d192a]"
            onClick={() => void window.lawHelper.overlay.raise()}
          >
            📌
          </button>
          <button
            type="button"
            title="Скрыть (Esc)"
            className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded-md px-2 py-1 text-[13px] leading-none text-[#b8b3cc] can-hover:hover:bg-red-500/10 can-hover:hover:text-red-200"
            onClick={() => void window.lawHelper.overlay.hide()}
          >
            ✕
          </button>
        </div>
      </header>

      <OverlayQuickHotkeyStrip hk={hkDisp} density={overlayDensity} />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className={`flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2 pt-1.5 transition-opacity duration-200 ease-out ${
            settingsOpen ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
        >
          <div className="relative shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div className="flex items-center gap-2 rounded-lg border border-[#322c4d] bg-[#1d192a] px-2 py-1.5">
              <span className="shrink-0 text-[12px] text-[#8a8497]" aria-hidden>
                ⌕
              </span>
              <input
                ref={searchInputRef}
                id="overlay-search"
                className="min-w-0 flex-1 bg-transparent text-[11px] text-[#e6e3ee] outline-none placeholder:text-[#6b6582]"
                placeholder="Поиск по базе…"
                value={globalQ}
                onChange={(e) => {
                  setGlobalQ(e.target.value)
                  setGlobalOpen(true)
                }}
                onFocus={() => setGlobalOpen(true)}
              />
              <span className="hidden shrink-0 font-mono text-[9px] text-[#6b6582] sm:inline">{hkDisp.search}</span>
              {globalQ ? (
                <button
                  type="button"
                  className="shrink-0 text-[10px] text-[#8a8497] can-hover:hover:text-[#e6e3ee]"
                  onClick={() => {
                    setGlobalQ('')
                    setGlobalHits([])
                  }}
                >
                  очистить
                </button>
              ) : null}
            </div>
            <div className="mt-1.5">
              <select
                className="w-full rounded-lg border border-[#322c4d] bg-[#1d192a] px-2 py-1.5 text-[10px] text-[#e6e3ee] outline-none focus:border-[#5a4ab0]"
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
                className={`absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-lg border border-[#322c4d] bg-[#1d192a] py-1 shadow-xl ${ovScroll}`}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {globalHits.slice(0, 8).map((h) => (
                  <li key={h.article_id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-[11px] can-hover:hover:bg-[#2a2540]"
                      onClick={() => void openHit(h)}
                    >
                      <div className="font-medium text-[#e6e3ee]">{h.heading}</div>
                      <div className="truncate text-[10px] text-[#8a8497]">{h.document_title}</div>
                    </button>
                  </li>
                ))}
                <li className="border-t border-[#2a2540] px-2 py-1 text-[9px] text-[#6b6582]">
                  Просмотр статьи — в этом окне оверлея
                </li>
              </ul>
            )}
          </div>

      <div
        className={`flex min-h-0 flex-1 ${
          overlayDensity === 'compact'
            ? chromeCompact
              ? 'p-1'
              : 'p-1.5'
            : overlayDensity === 'comfort' && !chromeCompact
              ? 'p-2.5'
              : chromeCompact
                ? readingComfort
                  ? 'p-1.5'
                  : 'p-1'
                : 'p-2'
        }`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {showArticleRail ? (
          <ArticleRail pins={pins} activeId={selectedPinnedId} onSelect={openPinnedInOverlay} />
        ) : null}
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
              className="flex h-full flex-col overflow-hidden rounded-xl border border-[#322c4d] bg-[#1d192a] shadow-[inset_0_1px_0_rgba(90,74,176,0.08)]"
              style={{ fontSize: `${11 * fontScale * readingSizeBoost * uiScale}px` }}
            >
              <div
                className={`shrink-0 border-b border-[#2a2540] ${
                  chromeCompact ? (readingComfort ? 'px-2.5 py-1.5' : 'px-2 py-1') : 'px-3 py-2'
                }`}
              >
                <div className="flex justify-end">
                  <span className="rounded-md border border-[#322c4d] bg-[#1d192a] px-1.5 py-0.5 text-[9px] tabular-nums text-[#8a8497]">
                    {ruArticlesCount(pins.length)}
                  </span>
                </div>
              </div>
              <div
                className={`min-h-0 flex-1 overflow-auto pb-2 pt-2 ${readingComfort ? 'px-2.5' : 'px-2'} ${ovScroll}`}
              >
                {filteredPins.length === 0 ? (
                  <p className="p-4 text-center text-[11px] text-white/50">Нет совпадений по фильтру.</p>
                ) : articleListMode === 'dense' ? (
                  <DensePinnedList
                    pins={filteredPins}
                    focusMode={focusMode}
                    selectedId={selectedPinnedId}
                    onOpen={(pin) => {
                      const sourceIndex = pins.findIndex((p) => p.id === pin.id)
                      openPinnedInOverlay(pin, sourceIndex >= 0 ? sourceIndex : 0)
                    }}
                    onMove={(i, dir) => {
                      const pin = filteredPins[i]
                      const sourceIndex = pin ? pins.findIndex((p) => p.id === pin.id) : -1
                      if (sourceIndex >= 0) void movePin(sourceIndex, dir)
                    }}
                    onUnpin={(id) => void unpin(id)}
                  />
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
                            className={`overflow-hidden rounded-xl border bg-[#1d192a] shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition ${
                              open
                                ? 'border-[#5a4ab0] ring-1 ring-[#5a4ab0]/40'
                                : 'border-[#322c4d] can-hover:hover:border-[#5a4ab0]/50 can-hover:hover:bg-[#15121e]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                openPinnedInOverlay(p, i >= 0 ? i : 0)
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
                                <span className="shrink-0 rounded-md bg-[#3c2e7a] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#c9c0f0]">
                                  {p.article_number ?? '—'}
                                </span>
                                <span className="text-[11px] text-[#6b6582] transition can-hover:group-hover:text-[#8a8497]">→</span>
                              </div>
                              <div className="mt-1.5 line-clamp-2 text-[11px] font-medium leading-snug text-[#e6e3ee]">
                                {articleDisplayTitle(p.article_number, p.heading)}
                              </div>
                              <p
                                className={`mt-1.5 text-[10px] leading-relaxed text-[#b8b3cc] ${
                                  focusMode ? 'line-clamp-3' : readingComfort ? 'line-clamp-3' : 'line-clamp-2'
                                }`}
                              >
                                {previewCardEssenceLine(p, focusMode)}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {!focusMode && bail ? (
                                  <span className="max-w-full truncate rounded-md bg-[#4a2418] px-1.5 py-0.5 text-[9px] text-[#f0b89e]">
                                    Залог: {bail.length > 56 ? `${bail.slice(0, 53)}…` : bail}
                                  </span>
                                ) : null}
                                {pen && pen !== '—' ? (
                                  <span
                                    className={`max-w-full truncate rounded-md px-1.5 py-0.5 text-[9px] ${
                                      isReferenceImportDoc(p)
                                        ? focusMode
                                          ? 'bg-zinc-500/20 font-medium text-zinc-100/95'
                                          : 'bg-[#2a2540] text-[#b8b3cc]'
                                        : focusMode
                                          ? 'bg-amber-500/20 font-medium text-amber-50/95'
                                          : 'bg-[#423814] text-[#e8c889]'
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
                                className="flex items-center justify-between gap-2 border-t border-[#2a2540] px-2 py-1"
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
                                    className="rounded px-1.5 text-[10px] text-red-400/85 can-hover:hover:bg-red-500/10"
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
              uiScale={uiScale}
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
                fontSize: `${12 * fontScale * readingSizeBoost * uiScale}px`,
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
                          : 'border-white/10 bg-black/30 text-white/55 can-hover:hover:border-white/20 can-hover:hover:text-white/85'
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
                        className={`h-1.5 w-1.5 rounded-full transition ${i === idx ? 'bg-accent' : 'bg-white/20 can-hover:hover:bg-white/40'}`}
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
        </div>

        <div
          className={`absolute inset-0 z-10 flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#15121e] px-2 pb-3 pt-2 transition-opacity duration-200 ease-out ${ovScroll} ${
            settingsOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="mb-2 flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-[#322c4d] bg-[#1d192a] px-2 py-1 text-[10px] font-medium text-[#e6e3ee] can-hover:hover:border-[#5a4ab0]"
              onClick={() => setSettingsOpen(false)}
              title="Назад"
            >
              ← Назад
            </button>
          </div>
          <div className="min-w-0 space-y-3">
            <LayoutPresetControl value={layoutPreset} onChange={setLayoutPreset} />
            <OverlayPositionControl />
            <label className="block">
              <span className="text-[9px] font-medium uppercase tracking-wide text-[#6b6582]">Прозрачность</span>
              <input
                type="range"
                min={0.28}
                max={1}
                step={0.01}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="lex-ov-range mt-1 w-full accent-[#5a4ab0]"
              />
            </label>
            <label className="block">
              <span className="text-[9px] font-medium uppercase tracking-wide text-[#6b6582]">Яркость</span>
              <input
                type="range"
                min={0.75}
                max={1.25}
                step={0.01}
                value={overlayBrightness}
                onChange={(e) => setOverlayBrightness(Number(e.target.value))}
                className="lex-ov-range mt-1 w-full accent-[#5a4ab0]"
              />
            </label>
            <div className="border-t border-[#2a2540] pt-3" />
            <div className="rounded-lg border border-[#322c4d] bg-[#1d192a] px-2 py-2">
              <label
                className="flex cursor-pointer items-center justify-between gap-2"
                title={`Включено — кликаете по оверлею. Выключено или ${hkDisp.clickThrough} — курсор и клики идут в игру, оверлей их не ловит.`}
              >
                <span className="text-[10px] font-medium text-[#e6e3ee]">Мышь в оверлее</span>
                <input
                  type="checkbox"
                  className="accent-[#5a4ab0]"
                  checked={!clickThrough}
                  onChange={(e) => setClickThrough(!e.target.checked)}
                />
              </label>
              <p className="mt-1.5 text-[9px] leading-relaxed text-[#8a8497]">
                <span className="font-mono text-[#6b6582]">{hkDisp.clickThrough}</span> — переключить: когда мышь «в
                игру», курсор не остаётся на оверлее — ввод уходит в игру под окном LexPatrol; оверлей виден, но не
                забирает клики на себя.
              </p>
            </div>
            <OverlayOptionToggle
              label="Фокус режим"
              hint=""
              title="Короче превью и текст санкций; детали плотнее"
              checked={focusMode}
              onChange={setFocusMode}
            />
            <OverlayInteractionModeRow mode={overlayInteractionMode} onChange={changeOverlayInteractionMode} />
            <div>
              <div className="text-[9px] font-medium uppercase tracking-wide text-[#6b6582]">Закрепы</div>
              <div className="mt-1 grid grid-cols-3 rounded-lg border border-[#322c4d] bg-[#1d192a] p-0.5">
                <button
                  type="button"
                  title="Карточки: суть, залог, наказание; клик — полный текст"
                  onClick={() => {
                    setCheatSheetMode(true)
                    setArticleListMode('cards')
                  }}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition ${
                    cheatSheetMode && articleListMode === 'cards'
                      ? 'bg-[#3c2e7a] text-[#e6e3ee] shadow-[inset_0_0_0_1px_#5a4ab0]'
                      : 'text-[#8a8497] can-hover:hover:bg-[#2a2540]'
                  }`}
                >
                  Карточки
                </button>
                <button
                  type="button"
                  title="Плотный список — больше статей на экране"
                  onClick={() => {
                    setCheatSheetMode(true)
                    setArticleListMode('dense')
                  }}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition ${
                    cheatSheetMode && articleListMode === 'dense'
                      ? 'bg-[#3c2e7a] text-[#e6e3ee] shadow-[inset_0_0_0_1px_#5a4ab0]'
                      : 'text-[#8a8497] can-hover:hover:bg-[#2a2540]'
                  }`}
                >
                  Список
                </button>
                <button
                  type="button"
                  title="Одна статья; ← → между закрепами"
                  onClick={() => setCheatSheetMode(false)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition ${
                    !cheatSheetMode ? 'bg-[#3c2e7a] text-[#e6e3ee] shadow-[inset_0_0_0_1px_#5a4ab0]' : 'text-[#8a8497] can-hover:hover:bg-[#2a2540]'
                  }`}
                >
                  Читать
                </button>
              </div>
            </div>
            <label className="flex items-center gap-2">
              <span className="w-4 text-center text-[10px] text-[#6b6582]">A</span>
              <input
                type="range"
                min={0.75}
                max={1.35}
                step={0.05}
                value={fontScale}
                onChange={(e) => setFontScale(Number(e.target.value))}
                className="lex-ov-range h-1 min-w-0 flex-1 accent-[#5a4ab0]"
              />
            </label>
            <button
              type="button"
              className="w-full rounded-lg border border-[#322c4d] bg-[#1d192a] py-2 text-[10px] font-medium text-[#b8b3cc] can-hover:hover:border-[#5a4ab0] can-hover:hover:text-[#e6e3ee]"
              onClick={() => setHotkeysModalOpen(true)}
            >
              Все сочетания клавиш…
            </button>
          </div>
        </div>
      </div>

      <footer
        className={`flex shrink-0 items-center border-t border-[#2a2540] bg-[#15121e] px-2 text-[9px] text-[#8a8497] ${
          overlayDensity === 'compact' ? 'h-6 justify-end' : 'h-7 justify-between'
        }`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {overlayDensity === 'compact' ? (
          <span className="sr-only">
            {hkDisp.toggle} — открыть/скрыть
          </span>
        ) : (
          <span className="min-w-0 truncate font-mono text-[#b8b3cc]">
            {hkDisp.toggle} — открыть/скрыть
          </span>
        )}
        <span className="flex shrink-0 items-center gap-2 tabular-nums text-[#6b6582]">
          <button
            type="button"
            className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded px-1.5 can-hover:hover:bg-[#1d192a] can-hover:hover:text-[#e6e3ee]"
            title="Все сочетания (?)"
            onClick={() => setHotkeysModalOpen(true)}
          >
            ?
          </button>
          <span>{footerCounter}</span>
        </span>
      </footer>
    </div>
  )
}

function ArticleDetailPane({
  pin,
  bodyText,
  fontScale,
  uiScale,
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
  uiScale: number
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
        fontSize: `${12 * fontScale * (readingComfort ? 1.085 : 1) * uiScale}px`,
        lineHeight: compact ? (readingComfort ? 1.52 : 1.42) : 1.58
      }}
    >
      <div className="shrink-0 border-b border-white/[0.07] bg-black/30 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[10px] font-medium text-white/95 can-hover:hover:bg-white/10"
            onClick={onBack}
          >
            ← К списку
          </button>
          <div className="flex flex-wrap gap-1.5">
            {pin.document_id ? (
              <button
                type="button"
                className="rounded-lg border border-accent/35 bg-accent/15 px-2.5 py-1.5 text-[10px] font-medium text-accent can-hover:hover:bg-accent/25"
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
          ? 'border-red-500/30 bg-red-500/10 text-red-200 can-hover:hover:bg-red-500/20'
          : 'border-white/10 bg-white/[0.06] text-white/90 can-hover:hover:bg-white/12'
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
      className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded bg-white/10 px-1.5 text-[10px] text-white/80 disabled:opacity-30 can-hover:hover:bg-white/15"
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
      className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-[12px] text-white can-hover:hover:bg-white/10"
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
    { id: 'reading', label: 'Чтение', title: 'Узкая шапка, крупнее текст карточек и статьи' },
    { id: 'full', label: 'Панель', title: 'Больше поля для списка и чтения' }
  ]
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-medium uppercase tracking-wide text-[#6b6582]">Режим окна</div>
      <div className="mt-1 flex rounded-lg border border-[#322c4d] bg-[#1d192a] p-0.5">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            title={it.title}
            onClick={() => onChange(it.id)}
            className={`flex-1 rounded-md px-1.5 py-1.5 text-[10px] font-semibold transition sm:px-2 ${
              value === it.id
                ? 'bg-[#3c2e7a] text-[#e6e3ee] shadow-[inset_0_0_0_1px_#5a4ab0]'
                : 'text-[#8a8497] can-hover:hover:bg-[#2a2540] can-hover:hover:text-[#e6e3ee]'
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Чекбокс с короткой подписью смысла — не теряется логика «Компакт» / «Фокус». */
function OverlayOptionToggle({
  label,
  hint,
  checked,
  onChange,
  title: tip
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
  title?: string
}): JSX.Element {
  return (
    <label
      title={tip}
      className="flex w-full cursor-pointer gap-2 rounded-lg border border-[#322c4d] bg-[#1d192a] px-2 py-1.5"
    >
      <input
        type="checkbox"
        className="mt-0.5 shrink-0 accent-[#5a4ab0]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-[10px] font-medium text-[#e6e3ee]">{label}</span>
        {hint ? <span className="mt-0.5 block text-[9px] leading-snug text-[#8a8497]">{hint}</span> : null}
      </span>
    </label>
  )
}

function MetaChips({ meta, omitBail }: { meta: ArticleDisplayMeta; omitBail?: boolean }): JSX.Element | null {
  return (
    <ArticleMetaChips
      meta={meta}
      size="sm"
      omitBail={omitBail}
      className="mt-2 flex flex-wrap items-center gap-1"
    />
  )
}

function filterBody(body: string, q: string): string {
  if (!q.trim()) return body
  const lines = body.split('\n')
  const hit = lines.filter((l) => l.toLowerCase().includes(q.toLowerCase()))
  return hit.length ? hit.slice(0, 28).join('\n') : body.slice(0, 1800)
}
