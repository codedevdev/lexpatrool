import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { BrowserImportPayload, ManualDomParseRulesV1 } from '@shared/types'
import type { SplitArticle } from '@parsers/article-split'
import {
  getForumImportHighlightClearScript,
  getForumImportHighlightScript
} from '@parsers/forum-import-highlight'
import { getWebviewPickerScript, parsePickerResult, type WebviewPickerResult } from './webview-picker'

const SETTINGS_KEY = 'browser_import_manual_v1'
const PRESETS_KEY = 'browser_import_presets_v1'

type WebviewElement = HTMLElement & {
  getURL: () => string
  executeJavaScript: (code: string) => Promise<unknown>
  loadURL: (url: string) => void
}

type DomKind = 'css' | 'xpath'

type SavedForm = {
  importMode: 'auto' | 'manual'
  forumScope: 'first' | 'all'
  strategy: 'rows' | 'single'
  articleFilter: 'all' | 'with_sanctions' | 'without_sanctions'
  maxRows: string
  rowKind: DomKind
  rowExpr: string
  numKind: DomKind
  numExpr: string
  headKind: DomKind
  headExpr: string
  bodyKind: DomKind
  bodyExpr: string
  singleContainerKind: DomKind
  singleContainerExpr: string
  singleBodyKind: DomKind
  singleBodyExpr: string
}

type PickField =
  | 'rowExpr'
  | 'numExpr'
  | 'headExpr'
  | 'bodyExpr'
  | 'singleContainerExpr'
  | 'singleBodyExpr'

type PresetItem = {
  id: string
  name: string
  savedAt: string
  form: SavedForm
}

const defaultForm = (): SavedForm => ({
  importMode: 'auto',
  forumScope: 'first',
  strategy: 'rows',
  articleFilter: 'all',
  maxRows: '',
  rowKind: 'css',
  rowExpr: 'tbody tr',
  numKind: 'css',
  numExpr: 'td:nth-child(1)',
  headKind: 'css',
  headExpr: 'td:nth-child(2)',
  bodyKind: 'css',
  bodyExpr: 'td:nth-child(3)',
  singleContainerKind: 'css',
  singleContainerExpr: 'main',
  singleBodyKind: 'css',
  singleBodyExpr: ''
})

const BROWSER_PIPELINE: { title: string; detail: string }[] = [
  { title: 'Снимок страницы', detail: 'HTML из встроенного браузера' },
  { title: 'Разбор контента', detail: 'Readability или DOM по селекторам' },
  { title: 'Статьи', detail: 'Эвристики и фильтр блоков' },
  { title: 'База', detail: 'SQLite: источник, документ, статьи' }
]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildRules(f: SavedForm): ManualDomParseRulesV1 {
  if (f.strategy === 'single') {
    const base: ManualDomParseRulesV1 = {
      version: 1,
      strategy: 'single',
      containerSelector: {
        kind: f.singleContainerKind,
        expr: f.singleContainerExpr.trim()
      }
    }
    if (f.singleBodyExpr.trim()) {
      base.body = { kind: f.singleBodyKind, expr: f.singleBodyExpr.trim() }
    }
    return base
  }
  const r: ManualDomParseRulesV1 = {
    version: 1,
    strategy: 'rows',
    rowSelector: { kind: f.rowKind, expr: f.rowExpr.trim() }
  }
  if (f.numExpr.trim()) r.articleNumber = { kind: f.numKind, expr: f.numExpr.trim() }
  if (f.headExpr.trim()) r.heading = { kind: f.headKind, expr: f.headExpr.trim() }
  if (f.bodyExpr.trim()) r.body = { kind: f.bodyKind, expr: f.bodyExpr.trim() }
  const cap = parseInt(f.maxRows.trim(), 10)
  if (!Number.isNaN(cap) && cap > 0) {
    r.maxRows = cap
  }
  return r
}

function applyPickerToField(
  field: PickField,
  p: WebviewPickerResult,
  prev: SavedForm
): SavedForm {
  const preferRel =
    p.relativeCss &&
    (field === 'numExpr' || field === 'headExpr' || field === 'bodyExpr')
  const expr = preferRel ? p.relativeCss! : p.css
  switch (field) {
    case 'rowExpr':
      return { ...prev, rowKind: 'css', rowExpr: p.css }
    case 'numExpr':
      return { ...prev, numKind: 'css', numExpr: expr }
    case 'headExpr':
      return { ...prev, headKind: 'css', headExpr: expr }
    case 'bodyExpr':
      return { ...prev, bodyKind: 'css', bodyExpr: expr }
    case 'singleContainerExpr':
      return { ...prev, singleContainerKind: 'css', singleContainerExpr: p.css }
    case 'singleBodyExpr':
      return { ...prev, singleBodyKind: 'css', singleBodyExpr: p.css }
    default:
      return prev
  }
}

function SelKind({
  value,
  onChange
}: {
  value: DomKind
  onChange: (v: DomKind) => void
}): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as DomKind)}
      className="rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none focus:border-accent/50"
    >
      <option value="css">CSS</option>
      <option value="xpath">XPath</option>
    </select>
  )
}

export function BrowserImportPage(): JSX.Element {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [url, setUrl] = useState('https://example.com')
  const [busy, setBusy] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [pipelinePhase, setPipelinePhase] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const [form, setForm] = useState<SavedForm>(defaultForm)
  const [preview, setPreview] = useState<SplitArticle[] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [pickBusy, setPickBusy] = useState(false)
  const [presets, setPresets] = useState<PresetItem[]>([])
  const [presetSelect, setPresetSelect] = useState('')
  const [autoPreviewInfo, setAutoPreviewInfo] = useState<{
    textLength: number
    textSource: string
    parsedTitle: string
  } | null>(null)

  const webviewRef = useRef<WebviewElement | null>(null)

  const clearImportHighlight = useCallback(async (): Promise<void> => {
    const wv = webviewRef.current
    if (!wv) return
    try {
      await wv.executeJavaScript(getForumImportHighlightClearScript())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void window.lawHelper.settings.get(SETTINGS_KEY).then((raw) => {
      if (!raw) return
      try {
        const j = JSON.parse(raw) as Partial<SavedForm>
        setForm((prev) => ({ ...prev, ...j }))
      } catch {
        /* ignore */
      }
    })
    void window.lawHelper.settings.get(PRESETS_KEY).then((raw) => {
      if (!raw) return
      try {
        const j = JSON.parse(raw) as { version?: number; items?: PresetItem[] }
        if (j.items && Array.isArray(j.items)) setPresets(j.items)
      } catch {
        /* ignore */
      }
    })
  }, [])

  const persistForm = useCallback((f: SavedForm): void => {
    void window.lawHelper.settings.set(SETTINGS_KEY, JSON.stringify(f))
  }, [])

  const persistPresets = useCallback((items: PresetItem[]): void => {
    void window.lawHelper.settings.set(PRESETS_KEY, JSON.stringify({ version: 1, items }))
  }, [])

  useEffect(() => {
    void clearImportHighlight()
    setPreview(null)
    setPreviewError(null)
    setAutoPreviewInfo(null)
  }, [form.importMode, form.forumScope, clearImportHighlight])

  async function getPageSnapshot(): Promise<{ html: string; href: string; title: string } | null> {
    const wv = webviewRef.current
    if (!wv) return null
    const href = wv.getURL()
    const html = await wv.executeJavaScript(`document.documentElement.outerHTML`)
    const title = await wv.executeJavaScript(`document.title`)
    return { html: String(html), href: String(href), title: String(title) }
  }

  async function runPicker(field: PickField): Promise<void> {
    const wv = webviewRef.current
    if (!wv) {
      setNote('Дождитесь загрузки страницы во встроенном браузере.')
      return
    }
    setPickBusy(true)
    setNote(null)
    try {
      const raw = await wv.executeJavaScript(getWebviewPickerScript())
      const r = parsePickerResult(raw)
      if (!r) {
        setNote('Выбор отменён (Esc).')
        return
      }
      setForm((prev) => {
        const next = applyPickerToField(field, r, prev)
        persistForm(next)
        return next
      })
      setNote(
        `Подставлено (${r.tagName}). ${r.relativeCss ? 'Для колонки взят относительный селектор внутри строки.' : ''} Образец: ${r.textSample.slice(0, 60)}${r.textSample.length > 60 ? '…' : ''}`
      )
    } finally {
      setPickBusy(false)
    }
  }

  async function runAutoPreview(): Promise<void> {
    setPreview(null)
    setPreviewError(null)
    setAutoPreviewInfo(null)
    setNote(null)
    const snap = await getPageSnapshot()
    if (!snap) {
      setPreviewError('Страница ещё загружается или встроенный браузер недоступен.')
      return
    }
    try {
      const data = await window.lawHelper.parse.autoImportPreview(
        snap.html,
        snap.href,
        snap.title,
        form.forumScope
      )
      setPreview(data.splits as SplitArticle[])
      setAutoPreviewInfo({
        textLength: data.textLength,
        textSource: data.textSource,
        parsedTitle: data.title
      })
      persistForm(form)
      const wv = webviewRef.current
      if (wv) {
        const hl = (await wv.executeJavaScript(
          getForumImportHighlightScript(form.forumScope)
        )) as { ok?: boolean; reason?: string; count?: number }
        if (hl && hl.ok === false) {
          setNote(
            'Текст разобран как при импорте. Подсветка недоступна: не удалось распознать типичную разметку темы форума.'
          )
        } else {
          const n = hl && typeof hl.count === 'number' ? hl.count : 1
          setNote(
            form.forumScope === 'all'
              ? `Подсветка: зелёные рамки — ${n} блок(ов), из которых склеивается текст.`
              : 'Подсветка: зелёная рамка — блок, из которого берётся текст в режиме «Авто».'
          )
        }
      }
      setStep(4)
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Ошибка предпросмотра')
    }
  }

  async function runPreview(): Promise<void> {
    setPreview(null)
    setPreviewError(null)
    setAutoPreviewInfo(null)
    void clearImportHighlight()
    setNote(null)
    const snap = await getPageSnapshot()
    if (!snap) {
      setPreviewError('Страница ещё загружается или встроенный браузер недоступен.')
      return
    }
    if (form.importMode !== 'manual') {
      setNote('Предпросмотр селекторов только в режиме «Вручную».')
      return
    }
    const rules = buildRules(form)
    const res = await window.lawHelper.parse.manualDom(snap.html, snap.href, rules)
    if (res.ok) {
      let articles = res.articles as SplitArticle[]
      if (form.strategy === 'single' && articles.length > 0) {
        const rawText = articles.map((a) => a.body).join('\n\n---\n\n')
        articles = (await window.lawHelper.parse.resolveArticleSplits(
          rawText,
          snap.title
        )) as SplitArticle[]
      }
      setPreview(articles)
      persistForm(form)
      setStep(4)
    } else {
      setPreviewError(res.error)
    }
  }

  const importCurrent = useCallback(async (): Promise<void> => {
    setBusy(true)
    setNote(null)
    setPreviewError(null)
    setOverlayOpen(true)
    setPipelinePhase(0)

    const timers: ReturnType<typeof setTimeout>[] = []
    timers.push(setTimeout(() => setPipelinePhase(1), 320))
    timers.push(setTimeout(() => setPipelinePhase(2), 680))

    try {
      const snap = await getPageSnapshot()
      if (!snap) {
        timers.forEach(clearTimeout)
        setOverlayOpen(false)
        setBusy(false)
        setNote('Страница ещё не готова к импорту.')
        return
      }
      const payload: BrowserImportPayload = {
        html: snap.html,
        url: snap.href,
        title: snap.title,
        mode: form.importMode,
        articleFilter: form.articleFilter,
        ...(form.importMode === 'auto' ? { forumScope: form.forumScope } : {}),
        ...(form.importMode === 'manual' ? { manualRules: buildRules(form) } : {})
      }
      const res = (await window.lawHelper.import.browserPage(payload)) as { documentId: string }
      persistForm(form)
      timers.forEach(clearTimeout)
      setPipelinePhase(3)
      await sleep(420)
      setOverlayOpen(false)
      setPipelinePhase(0)
      navigate(`/reader/${res.documentId}`)
    } catch (e) {
      timers.forEach(clearTimeout)
      setNote(e instanceof Error ? e.message : 'Не удалось импортировать')
      setPipelinePhase(0)
      setOverlayOpen(false)
    } finally {
      setBusy(false)
    }
  }, [form, navigate, persistForm])

  function update<K extends keyof SavedForm>(key: K, v: SavedForm[K]): void {
    setForm((prev) => ({ ...prev, [key]: v }))
  }

  function savePreset(): void {
    const name = window.prompt('Название пресета (например «Форум — таблица штрафов»)')
    if (!name?.trim()) return
    const item: PresetItem = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}`,
      name: name.trim(),
      savedAt: new Date().toISOString(),
      form: { ...form }
    }
    const next = [...presets.filter((p) => p.name !== item.name), item].sort((a, b) =>
      a.name.localeCompare(b.name, 'ru')
    )
    setPresets(next)
    persistPresets(next)
    setPresetSelect(item.id)
    setNote(`Пресет «${item.name}» сохранён.`)
  }

  function loadPreset(id: string): void {
    setPresetSelect(id)
    if (!id) return
    const p = presets.find((x) => x.id === id)
    if (p) {
      setForm({ ...defaultForm(), ...p.form })
      setNote(`Загружен пресет «${p.name}».`)
    }
  }

  function deletePreset(): void {
    if (!presetSelect) return
    const p = presets.find((x) => x.id === presetSelect)
    if (!p || !window.confirm(`Удалить пресет «${p.name}»?`)) return
    const next = presets.filter((x) => x.id !== presetSelect)
    setPresets(next)
    persistPresets(next)
    setPresetSelect('')
  }

  const pickDisabled = pickBusy || busy || form.importMode !== 'manual'

  const stepLabels = ['Страница', 'Режим', 'Настройка', 'Проверка']

  return (
    <div className="relative min-h-0 space-y-6">
      <header className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-[#111824]/95 via-[#0d121a]/92 to-[#080b10]/95 p-6 md:p-8">
        <div className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-40 w-40 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent/90">Встроенный Chromium</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-[1.65rem]">Браузерный импорт</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-app-muted">
            Загрузите страницу справа, войдите на сайт при необходимости — cookies сохраняются в профиле браузера LexPatrol.
            Дальше выберите: <strong className="text-white/85">авто</strong> (Readability и темы форумов) или{' '}
            <strong className="text-white/85">вручную</strong> через CSS/XPath и кнопку «Указать» по клику на элемент.
          </p>
          <p className="mt-2 text-[12px] text-app-muted">
            Обычный импорт текста без браузера — в разделе{' '}
            <Link className="font-medium text-accent hover:underline" to="/import">
              Импорт
            </Link>
            .
          </p>
        </div>
      </header>

      {/* Step rail */}
      <nav className="flex flex-wrap items-center gap-2 md:gap-3" aria-label="Шаги браузерного импорта">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="flex items-center gap-2 md:gap-3">
            <button
              type="button"
              disabled={busy || n > step}
              onClick={() => !busy && n < step && setStep(n)}
              className={`flex h-9 min-w-[2.25rem] items-center justify-center rounded-full border px-2 text-xs font-semibold transition md:h-10 md:min-w-[2.5rem] md:text-[13px] ${
                n === step
                  ? 'border-accent/60 bg-accent/20 text-white shadow-[0_0_0_1px_rgba(91,140,255,0.35)]'
                  : n < step
                    ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25'
                    : 'border-white/10 bg-black/25 text-white/35'
              }`}
            >
              {n < step ? '✓' : n}
            </button>
            {n < 4 ? <span className="hidden h-px w-4 bg-white/15 md:block md:w-6" /> : null}
          </div>
        ))}
        <span className="ml-auto hidden text-[11px] text-white/40 md:inline">{stepLabels[step - 1]}</span>
      </nav>

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,400px)_1fr] lg:items-stretch">
        {/* Left: wizard */}
        <div className="glass flex min-h-[360px] flex-col rounded-2xl p-5 md:p-6">
          {step === 1 && (
            <div className="flex flex-1 flex-col space-y-4">
              <h2 className="text-lg font-semibold text-white">Шаг 1 — страница</h2>
              <p className="text-[13px] leading-relaxed text-app-muted">
                Введите адрес в поле над превью справа и нажмите «Перейти». Дождитесь загрузки; для закрытых разделов форума
                сначала авторизуйтесь во встроенном окне.
              </p>
              <ul className="space-y-2 rounded-xl border border-white/[0.06] bg-black/25 px-4 py-3 text-[12px] leading-snug text-app-muted">
                <li className="flex gap-2">
                  <span className="text-accent">·</span>
                  Профиль браузера отдельный от основного окна LexPatrol — сессии не смешиваются.
                </li>
                <li className="flex gap-2">
                  <span className="text-accent">·</span>
                  Когда страница открыта как нужно, перейдите к шагу 2.
                </li>
              </ul>
              <div className="mt-auto flex justify-end border-t border-white/[0.06] pt-4">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-dim"
                >
                  Далее
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-1 flex-col space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-white">Шаг 2 — режим разбора</h2>
                <p className="mt-1 text-[13px] text-app-muted">Как извлекать контент из загруженной страницы.</p>
              </div>

              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => update('importMode', 'auto')}
                  className={`rounded-2xl border p-4 text-left transition md:p-5 ${
                    form.importMode === 'auto'
                      ? 'border-accent/45 bg-accent/[0.12]'
                      : 'border-white/[0.08] bg-black/20 hover:border-white/15'
                  }`}
                >
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-accent/90">Авто</p>
                  <p className="mt-2 text-[14px] font-semibold text-white">Readability + форумы</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-app-muted">
                    Основной текст страницы; для XenForo — первый пост или вся тема.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => update('importMode', 'manual')}
                  className={`rounded-2xl border p-4 text-left transition md:p-5 ${
                    form.importMode === 'manual'
                      ? 'border-accent/45 bg-accent/[0.12]'
                      : 'border-white/[0.08] bg-black/20 hover:border-white/15'
                  }`}
                >
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-accent/90">Вручную</p>
                  <p className="mt-2 text-[14px] font-semibold text-white">CSS и XPath</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-app-muted">
                    Таблицы штрафов, нестандартная вёрстка — селекторы и «Указать» на странице.
                  </p>
                </button>
              </div>

              <label className="block space-y-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Фильтр блоков после разбора</span>
                <select
                  className="w-full rounded-xl border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white outline-none focus:border-accent/55"
                  value={form.articleFilter}
                  onChange={(e) =>
                    update('articleFilter', e.target.value as SavedForm['articleFilter'])
                  }
                >
                  <option value="all">Все блоки</option>
                  <option value="with_sanctions">Только с наказанием / штрафом / санкциями</option>
                  <option value="without_sanctions">Только справочные (без санкций)</option>
                </select>
              </label>

              <div className="mt-auto flex justify-between gap-2 border-t border-white/[0.06] pt-4">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-xl border border-white/12 px-4 py-2 text-sm text-app-muted hover:bg-white/[0.05]"
                >
                  Назад
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-dim"
                >
                  Далее
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-1 flex-col space-y-4 overflow-hidden">
              <div className="shrink-0">
                <h2 className="text-lg font-semibold text-white">Шаг 3 — параметры</h2>
                <p className="mt-1 text-[13px] text-app-muted">
                  {form.importMode === 'auto'
                    ? 'Проверьте разбор до импорта — подсветка покажет откуда берётся текст.'
                    : 'Задайте селекторы или загрузите пресет. Превью обязательно для проверки.'}
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {form.importMode === 'auto' ? (
                  <div className="space-y-4">
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.07] bg-black/25 p-4">
                      <input
                        type="checkbox"
                        className="mt-1 accent-accent"
                        checked={form.forumScope === 'all'}
                        onChange={(e) => update('forumScope', e.target.checked ? 'all' : 'first')}
                      />
                      <span className="text-[13px] leading-relaxed text-app-muted">
                        <strong className="text-white/85">Все сообщения темы</strong> — склеить посты (дефисы между блоками).
                        По умолчанию для форумов — только <strong className="text-white/85">первый пост</strong>.
                      </span>
                    </label>
                    <p className="text-[12px] leading-relaxed text-app-muted">
                      Если найден полный текст темы, он может заменить короткую выдержку — в зависимости от длины и качества.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-xl border border-accent/35 bg-accent/15 px-4 py-2.5 text-sm font-medium text-accent hover:bg-accent/25 disabled:opacity-40"
                        onClick={() => void runAutoPreview()}
                      >
                        Проверить разбор (авто)
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/85 hover:bg-white/10 disabled:opacity-40"
                        onClick={() => void clearImportHighlight()}
                      >
                        Снять подсветку
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 pb-2">
                    <div className="flex flex-col gap-2">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Пресеты</span>
                      <div className="flex flex-wrap gap-2">
                        <select
                          value={presetSelect}
                          onChange={(e) => loadPreset(e.target.value)}
                          className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
                        >
                          <option value="">— выбрать —</option>
                          {presets.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white hover:bg-white/10"
                          onClick={() => savePreset()}
                        >
                          Сохранить…
                        </button>
                        <button
                          type="button"
                          disabled={!presetSelect}
                          className="rounded-xl border border-red-500/25 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-30"
                          onClick={() => deletePreset()}
                        >
                          Удалить
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4 text-[13px]">
                      <label className="flex cursor-pointer items-center gap-2 text-app-muted">
                        <input
                          type="radio"
                          className="accent-accent"
                          checked={form.strategy === 'rows'}
                          onChange={() => update('strategy', 'rows')}
                        />
                        Строки таблицы → статьи
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-app-muted">
                        <input
                          type="radio"
                          className="accent-accent"
                          checked={form.strategy === 'single'}
                          onChange={() => update('strategy', 'single')}
                        />
                        Один контейнер → документ
                      </label>
                    </div>

                    {form.strategy === 'rows' ? (
                      <div className="space-y-3">
                        <p className="text-[12px] text-app-muted">
                          Селектор строки, затем колонки. «Указать» подставляет CSS — клик по элементу в окне справа.
                        </p>
                        <label className="flex max-w-xs flex-col gap-1 text-[11px] text-app-muted">
                          Макс. строк (пусто = все)
                          <input
                            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-white"
                            value={form.maxRows}
                            onChange={(e) => update('maxRows', e.target.value.replace(/[^\d]/g, ''))}
                            placeholder="500"
                            inputMode="numeric"
                          />
                        </label>
                        <FieldRow
                          label="Строки"
                          kind={form.rowKind}
                          expr={form.rowExpr}
                          onKind={(v) => update('rowKind', v)}
                          onExpr={(v) => update('rowExpr', v)}
                          hint="tbody tr · //table//tr[td]"
                          onPick={() => void runPicker('rowExpr')}
                          pickDisabled={pickDisabled}
                        />
                        <FieldRow
                          label="Номер (опц.)"
                          kind={form.numKind}
                          expr={form.numExpr}
                          onKind={(v) => update('numKind', v)}
                          onExpr={(v) => update('numExpr', v)}
                          onPick={() => void runPicker('numExpr')}
                          pickDisabled={pickDisabled}
                        />
                        <FieldRow
                          label="Заголовок (опц.)"
                          kind={form.headKind}
                          expr={form.headExpr}
                          onKind={(v) => update('headKind', v)}
                          onExpr={(v) => update('headExpr', v)}
                          onPick={() => void runPicker('headExpr')}
                          pickDisabled={pickDisabled}
                        />
                        <FieldRow
                          label="Текст (опц.)"
                          kind={form.bodyKind}
                          expr={form.bodyExpr}
                          onKind={(v) => update('bodyKind', v)}
                          onExpr={(v) => update('bodyExpr', v)}
                          onPick={() => void runPicker('bodyExpr')}
                          pickDisabled={pickDisabled}
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-[12px] text-app-muted">
                          Контейнер тела поста (например <code className="rounded bg-black/40 px-1">.message-body</code>), затем
                          разбивка как в авто.
                        </p>
                        <FieldRow
                          label="Контейнер"
                          kind={form.singleContainerKind}
                          expr={form.singleContainerExpr}
                          onKind={(v) => update('singleContainerKind', v)}
                          onExpr={(v) => update('singleContainerExpr', v)}
                          hint="#content"
                          onPick={() => void runPicker('singleContainerExpr')}
                          pickDisabled={pickDisabled}
                        />
                        <FieldRow
                          label="Только текст (опц.)"
                          kind={form.singleBodyKind}
                          expr={form.singleBodyExpr}
                          onKind={(v) => update('singleBodyKind', v)}
                          onExpr={(v) => update('singleBodyExpr', v)}
                          onPick={() => void runPicker('singleBodyExpr')}
                          pickDisabled={pickDisabled}
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-xl border border-accent/35 bg-accent/15 px-4 py-2.5 text-sm font-medium text-accent hover:bg-accent/25 disabled:opacity-40"
                        onClick={() => void runPreview()}
                      >
                        Проверить селекторы
                      </button>
                      {pickBusy ? (
                        <span className="text-[11px] text-amber-200/90">Кликните по элементу справа…</span>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-auto flex shrink-0 justify-between gap-2 border-t border-white/[0.06] pt-4">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-xl border border-white/12 px-4 py-2 text-sm text-app-muted hover:bg-white/[0.05]"
                >
                  Назад
                </button>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="rounded-xl bg-white/[0.08] px-4 py-2 text-sm font-medium text-white hover:bg-white/[0.12]"
                >
                  К проверке →
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-1 flex-col space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Шаг 4 — проверка и импорт</h2>
                <p className="mt-1 text-[13px] text-app-muted">
                  Убедитесь в таблице предпросмотра ниже (на всю ширину). При необходимости вернитесь на шаг 3.
                </p>
              </div>
              {!preview && !previewError && (
                <p className="rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-4 py-3 text-[12px] text-amber-50/95">
                  Предпросмотр ещё не запускался. На шаге 3 нажмите «Проверить разбор» или «Проверить селекторы» — таблица
                  появится под панелями.
                </p>
              )}
              <div className="mt-auto flex flex-wrap justify-between gap-2 border-t border-white/[0.06] pt-4">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  disabled={busy}
                  className="rounded-xl border border-white/12 px-4 py-2 text-sm text-app-muted hover:bg-white/[0.05] disabled:opacity-40"
                >
                  Назад
                </button>
                <button
                  type="button"
                  disabled={busy || pickBusy}
                  onClick={() => void importCurrent()}
                  className="rounded-xl bg-gradient-to-r from-accent to-[#5b7cff] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_8px_28px_rgba(91,140,255,0.35)] hover:brightness-110 disabled:opacity-40"
                >
                  {busy ? 'Импорт…' : 'Импортировать в базу'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: browser chrome + webview */}
        <div className="glass flex min-h-[min(70vh,720px)] flex-col overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.07] bg-black/35 px-3 py-2.5 md:px-4">
            <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wide text-white/35 sm:inline">
              Адрес
            </span>
            <input
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-surface-raised px-3 py-2 text-[13px] text-white outline-none focus:border-accent/55"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              spellCheck={false}
            />
            <button
              type="button"
              className="shrink-0 rounded-xl border border-white/12 bg-white/[0.06] px-4 py-2 text-sm font-medium text-white hover:bg-white/[0.1]"
              onClick={() => webviewRef.current?.loadURL(url)}
            >
              Перейти
            </button>
          </div>
          <webview
            ref={webviewRef as React.RefObject<WebviewElement>}
            src={url}
            className="min-h-[420px] flex-1 bg-black"
            style={{ width: '100%' }}
            allowpopups
            partition="persist:lexpatrol-browser"
          />
        </div>
      </div>

      {/* Preview full width */}
      {(previewError || (preview && preview.length > 0)) && (
        <div className="glass rounded-2xl p-5 md:p-6">
          <h3 className="text-sm font-semibold text-white">Предпросмотр разбора</h3>
          {previewError && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {previewError}
            </div>
          )}
          {preview && preview.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
              <div className="border-b border-white/5 bg-black/25 px-3 py-2 text-[11px] text-app-muted">
                Найдено блоков: <span className="text-white/90">{preview.length}</span>
                {form.importMode === 'manual' && form.maxRows.trim()
                  ? ` · лимит ${form.maxRows} строк`
                  : ''}
                {form.importMode === 'auto' && autoPreviewInfo ? (
                  <span className="text-white/70">
                    {' '}
                    · символов: {autoPreviewInfo.textLength} ·{' '}
                    <span className="text-emerald-300/90">
                      {autoPreviewInfo.textSource === 'forum_first_post'
                        ? 'первый пост'
                        : autoPreviewInfo.textSource === 'forum_all_posts'
                          ? 'все посты темы'
                          : 'основной текст'}
                    </span>
                    {autoPreviewInfo.parsedTitle ? (
                      <span className="text-white/45"> · «{autoPreviewInfo.parsedTitle.slice(0, 48)}»</span>
                    ) : null}
                  </span>
                ) : null}
              </div>
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="bg-black/30 text-[10px] uppercase tracking-wide text-white/45">
                  <tr>
                    <th className="px-2 py-2">#</th>
                    <th className="px-2 py-2">Статья</th>
                    <th className="px-2 py-2">Заголовок</th>
                    <th className="px-2 py-2">Текст (начало)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-app-muted">
                  {preview.slice(0, 12).map((a, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5 font-mono text-accent/90">{i + 1}</td>
                      <td className="max-w-[100px] truncate px-2 py-1.5">{a.articleNumber ?? '—'}</td>
                      <td className="max-w-[180px] truncate px-2 py-1.5 text-white/85">{a.heading}</td>
                      <td className="max-w-[320px] truncate px-2 py-1.5">{a.body.slice(0, 120)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-white/5 px-3 py-1.5 text-[10px] text-white/35">
                Показано до 12 из {preview.length}
              </div>
            </div>
          )}
        </div>
      )}

      {note && (
        <div className="rounded-xl border border-white/[0.08] bg-surface-raised/80 px-4 py-3 text-[13px] leading-relaxed text-app-muted">
          {note}
        </div>
      )}

      {/* Import pipeline overlay */}
      {overlayOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/72 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.1] bg-gradient-to-b from-[#121722]/98 to-[#07090e]/98 shadow-[0_24px_80px_rgba(0,0,0,0.65)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
            <div className="border-b border-white/[0.06] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent/90">Импорт страницы</p>
              <p className="mt-2 text-lg font-semibold text-white">{busy ? 'Сохраняем в базу…' : 'Готово'}</p>
            </div>
            <div className="space-y-0 px-6 py-4">
              {BROWSER_PIPELINE.map((ph, i) => {
                const done = i < pipelinePhase || pipelinePhase >= 3
                const active = busy && i === pipelinePhase && pipelinePhase < 3
                return (
                  <div
                    key={ph.title}
                    className={`flex gap-3 border-l-2 py-3 pl-4 pr-1 ${active ? 'border-accent bg-accent/[0.06]' : done ? 'border-emerald-500/50' : 'border-white/10'}`}
                  >
                    <div
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                        done
                          ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-100'
                          : active
                            ? 'border-accent/60 bg-accent/25 text-white shadow-[0_0_12px_rgba(91,140,255,0.35)]'
                            : 'border-white/15 bg-black/40 text-white/25'
                      }`}
                    >
                      {done ? '✓' : i + 1}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-[13px] font-medium ${done || active ? 'text-white' : 'text-white/35'}`}>{ph.title}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-app-muted">{ph.detail}</p>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="border-t border-white/[0.06] px-6 py-4">
              <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-[#7e9cff] transition-all duration-500 ease-out"
                  style={{
                    width: `${Math.min(100, ((pipelinePhase + 1) / BROWSER_PIPELINE.length) * 100)}%`
                  }}
                />
              </div>
              <p className="mt-3 text-center text-[10px] text-white/35">Обработка только на вашем компьютере.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FieldRow({
  label,
  kind,
  expr,
  onKind,
  onExpr,
  hint,
  onPick,
  pickDisabled
}: {
  label: string
  kind: DomKind
  expr: string
  onKind: (k: DomKind) => void
  onExpr: (s: string) => void
  hint?: string
  onPick?: () => void
  pickDisabled?: boolean
}): JSX.Element {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-[120px] text-[12px] text-white/75">{label}</span>
        <SelKind value={kind} onChange={onKind} />
        <input
          className="min-w-[140px] flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-white outline-none focus:border-accent/50"
          value={expr}
          onChange={(e) => onExpr(e.target.value)}
          spellCheck={false}
        />
        {onPick ? (
          <button
            type="button"
            title="Клик по элементу справа во встроенном браузере"
            disabled={pickDisabled}
            onClick={onPick}
            className="shrink-0 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[10px] font-medium text-accent hover:bg-accent/20 disabled:opacity-35"
          >
            Указать
          </button>
        ) : null}
      </div>
      {hint ? <p className="pl-[128px] text-[10px] text-white/35">{hint}</p> : null}
    </div>
  )
}
