import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  /** Авто: только первый пост темы или все сообщения подряд (XenForo). */
  forumScope: 'first' | 'all'
  strategy: 'rows' | 'single'
  /** После разбивки текста на блоки */
  articleFilter: 'all' | 'with_sanctions' | 'without_sanctions'
  /** Пусто = без лимита */
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
      className="rounded border border-white/15 bg-black/40 px-1.5 py-1 text-[11px] text-white outline-none"
    >
      <option value="css">CSS</option>
      <option value="xpath">XPath</option>
    </select>
  )
}

/**
 * Встроенный браузер: ручной вход, импорт — авто (Readability) или разбор по CSS/XPath с пресетами и «указать на странице».
 */
export function BrowserImportPage(): JSX.Element {
  const navigate = useNavigate()
  const [url, setUrl] = useState('https://example.com')
  const [busy, setBusy] = useState(false)
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
      setNote('Сначала дождитесь загрузки встроенного браузера.')
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
        `Подставлено (${r.tagName}). ${r.relativeCss ? 'Для колонки взят относительный селектор внутри строки (клик по ячейке).' : ''} Образец: ${r.textSample.slice(0, 60)}${r.textSample.length > 60 ? '…' : ''}`
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
      setPreviewError('Webview не готов')
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
            'Текст разобран как при импорте. Подсветка недоступна: не найден типичный блок XenForo (или страница не форум).'
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
      setPreviewError('Webview не готов')
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
    } else {
      setPreviewError(res.error)
    }
  }

  async function importCurrent(): Promise<void> {
    setBusy(true)
    setNote(null)
    setPreviewError(null)
    try {
      const snap = await getPageSnapshot()
      if (!snap) {
        setNote('Webview не готов')
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
      setNote('Импорт выполнен. Открываем документ…')
      navigate(`/reader/${res.documentId}`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Не удалось импортировать')
    } finally {
      setBusy(false)
    }
  }

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

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-white">Браузерный импорт</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-app-muted">
          Войдите на сайт вручную. <strong className="text-white/90">Авто</strong> — Readability; для XenForo можно
          взять только первый пост или всю тему (чекбокс ниже). Нажмите «Проверить разбор (авто)», чтобы увидеть блоки
          и подсветку зоны парсинга. <strong className="text-white/90">Вручную</strong> — CSS или XPath;
          «Указать на странице» подставляет селектор кликом. Пресеты хранят набор полей.
        </p>
      </header>

      <div className="glass space-y-4 rounded-2xl p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-white/50">Режим импорта</div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-app-muted">
            <input
              type="radio"
              className="accent-accent"
              checked={form.importMode === 'auto'}
              onChange={() => update('importMode', 'auto')}
            />
            Авто — Readability + эвристики статей
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-app-muted">
            <input
              type="radio"
              className="accent-accent"
              checked={form.importMode === 'manual'}
              onChange={() => update('importMode', 'manual')}
            />
            Вручную — селекторы (CSS / XPath)
          </label>
        </div>

        <div className="border-t border-white/10 pt-4">
          <label className="flex max-w-lg flex-col gap-1 text-xs text-app-muted">
            Разбор блоков после импорта
            <select
              className="rounded-lg border border-white/10 bg-black/35 px-2 py-1.5 text-sm text-white outline-none focus:border-accent/50"
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
        </div>

        {form.importMode === 'auto' && (
          <div className="space-y-3 border-t border-white/10 pt-4">
            <label className="flex max-w-xl cursor-pointer items-start gap-2 text-xs leading-relaxed text-app-muted">
              <input
                type="checkbox"
                className="mt-0.5 accent-accent"
                checked={form.forumScope === 'all'}
                onChange={(e) => update('forumScope', e.target.checked ? 'all' : 'first')}
              />
              <span>
                <strong className="text-white/80">Все сообщения темы</strong> — склеить текст всех постов на странице
                (разделитель между постами — строка из дефисов). По умолчанию для форумов берётся только{' '}
                <strong className="text-white/80">первый пост</strong> (как отдельная статья/документ в теме).
              </span>
            </label>
            <p className="text-xs leading-relaxed text-app-muted">
              Тот же путь, что и «Импорт текущей страницы»: если текст с форума длиннее, чем у Readability, подставляется
              он; иначе — разметка статьи Readability.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded-lg border border-accent/35 bg-accent/15 px-4 py-2 text-sm text-accent hover:bg-accent/25 disabled:opacity-40"
                onClick={() => void runAutoPreview()}
              >
                Проверить разбор (авто)
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-40"
                onClick={() => void clearImportHighlight()}
              >
                Снять подсветку
              </button>
            </div>
          </div>
        )}

        {form.importMode === 'manual' && (
          <div className="space-y-4 border-t border-white/10 pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-app-muted">
                Пресеты
                <div className="flex flex-wrap gap-2">
                  <select
                    value={presetSelect}
                    onChange={(e) => loadPreset(e.target.value)}
                    className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-black/35 px-2 py-1.5 text-sm text-white outline-none focus:border-accent/50"
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
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10"
                    onClick={() => savePreset()}
                  >
                    Сохранить текущий…
                  </button>
                  <button
                    type="button"
                    disabled={!presetSelect}
                    className="rounded-lg border border-red-500/25 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-30"
                    onClick={() => deletePreset()}
                  >
                    Удалить
                  </button>
                </div>
              </label>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2 text-app-muted">
                <input
                  type="radio"
                  className="accent-accent"
                  checked={form.strategy === 'rows'}
                  onChange={() => update('strategy', 'rows')}
                />
                Много строк (каждая строка → статья)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-app-muted">
                <input
                  type="radio"
                  className="accent-accent"
                  checked={form.strategy === 'single'}
                  onChange={() => update('strategy', 'single')}
                />
                Один блок → один документ
              </label>
            </div>

            {form.strategy === 'rows' ? (
              <div className="space-y-3 text-sm">
                <p className="text-xs text-app-muted">
                  Селектор <strong className="text-white/80">строки</strong>, затем опционально колонки относительно
                  строки. Пустая колонка = не использовать. Без текста статьи — берётся вся строка. «Указать» вставляет
                  CSS; для XPath переключите тип и отредактируйте выражение.
                </p>
                <label className="flex max-w-xs flex-col gap-1 text-xs text-app-muted">
                  Макс. строк (пусто = все)
                  <input
                    className="rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-white"
                    value={form.maxRows}
                    onChange={(e) => update('maxRows', e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="напр. 500"
                    inputMode="numeric"
                  />
                </label>
                <FieldRow
                  label="Строки (row)"
                  kind={form.rowKind}
                  expr={form.rowExpr}
                  onKind={(v) => update('rowKind', v)}
                  onExpr={(v) => update('rowExpr', v)}
                  hint="CSS: tbody tr · XPath: //table//tr[td]"
                  onPick={() => void runPicker('rowExpr')}
                  pickDisabled={pickDisabled}
                />
                <FieldRow
                  label="Номер статьи (опц.)"
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
                  label="Текст статьи (опц.)"
                  kind={form.bodyKind}
                  expr={form.bodyExpr}
                  onKind={(v) => update('bodyKind', v)}
                  onExpr={(v) => update('bodyExpr', v)}
                  onPick={() => void runPicker('bodyExpr')}
                  pickDisabled={pickDisabled}
                />
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <p className="text-xs text-app-muted">
                  Укажите узел с текстом первого сообщения (например XenForo:{' '}
                  <code className="rounded bg-black/40 px-1 text-white/90">.message-body .bbWrapper</code> или{' '}
                  <code className="rounded bg-black/40 px-1 text-white/90">.js-postBody</code>
                  ). После извлечения текст режется на статьи той же эвристикой, что и в режиме «Авто».
                </p>
                <FieldRow
                  label="Контейнер"
                  kind={form.singleContainerKind}
                  expr={form.singleContainerExpr}
                  onKind={(v) => update('singleContainerKind', v)}
                  onExpr={(v) => update('singleContainerExpr', v)}
                  hint="#content, //article[1]"
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
                className="rounded-lg border border-accent/35 bg-accent/15 px-4 py-2 text-sm text-accent hover:bg-accent/25 disabled:opacity-40"
                onClick={() => void runPreview()}
              >
                Проверить селекторы
              </button>
              {pickBusy && <span className="text-xs text-amber-200/90">Кликните по элементу на странице…</span>}
            </div>
          </div>
        )}

        {(previewError || (preview && preview.length > 0)) && (
          <div className="border-t border-white/10 pt-4">
            {previewError && (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {previewError}
              </div>
            )}

            {preview && preview.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <div className="border-b border-white/5 bg-black/25 px-2 py-1.5 text-[11px] text-app-muted">
                  Найдено блоков: <span className="text-white/90">{preview.length}</span>
                  {form.importMode === 'manual' && form.maxRows.trim()
                    ? ` · лимит ${form.maxRows} строк в правилах`
                    : ''}
                  {form.importMode === 'auto' && autoPreviewInfo ? (
                    <span className="text-white/70">
                      {' '}
                      · символов текста: {autoPreviewInfo.textLength} · источник:{' '}
                      <span className="text-emerald-300/90">
                        {autoPreviewInfo.textSource === 'forum_first_post'
                          ? 'первый пост (форум)'
                          : autoPreviewInfo.textSource === 'forum_all_posts'
                            ? 'все посты темы (форум)'
                            : 'Readability'}
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
                <div className="border-t border-white/5 px-2 py-1 text-[10px] text-white/35">
                  Показано до 12 из {preview.length} блоков
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-[240px] flex-1 rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          className="rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white hover:bg-surface-hover"
          onClick={() => webviewRef.current?.loadURL(url)}
        >
          Перейти
        </button>
        <button
          type="button"
          disabled={busy || pickBusy}
          onClick={() => void importCurrent()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40"
        >
          {busy ? 'Импорт…' : 'Импорт текущей страницы'}
        </button>
      </div>

      {note && (
        <div className="rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-app-muted">{note}</div>
      )}

      <div className="glass h-[520px] overflow-hidden rounded-2xl">
        <webview
          ref={webviewRef as React.RefObject<WebviewElement>}
          src={url}
          style={{ width: '100%', height: '100%' }}
          allowpopups
          partition="persist:lexpatrol-browser"
        />
      </div>
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
        <span className="min-w-[160px] text-xs text-white/70">{label}</span>
        <SelKind value={kind} onChange={onKind} />
        <input
          className="min-w-[160px] flex-1 rounded border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-white outline-none focus:border-accent/50"
          value={expr}
          onChange={(e) => onExpr(e.target.value)}
          spellCheck={false}
        />
        {onPick ? (
          <button
            type="button"
            title="Кликнуть по элементу во встроенном браузере ниже"
            disabled={pickDisabled}
            onClick={onPick}
            className="shrink-0 rounded border border-accent/30 bg-accent/10 px-2 py-1 text-[10px] text-accent hover:bg-accent/20 disabled:opacity-35"
          >
            Указать
          </button>
        ) : null}
      </div>
      {hint ? <p className="pl-[168px] text-[10px] text-white/35">{hint}</p> : null}
    </div>
  )
}
