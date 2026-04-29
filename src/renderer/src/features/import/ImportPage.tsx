import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { ImportPayload, SourceType } from '@shared/types'

type ArticleFilter = NonNullable<ImportPayload['articleFilter']>

const SOURCE_OPTIONS: {
  value: SourceType
  title: string
  subtitle: string
  badge: string
}[] = [
  {
    value: 'paste_text',
    title: 'Чистый текст',
    subtitle: 'Вставка из буфера: правила, выдержки, распознанный PDF.',
    badge: 'TXT'
  },
  {
    value: 'paste_html',
    title: 'HTML',
    subtitle: 'Разметка страницы — из «Исходный код» или инструментов разработчика.',
    badge: 'HTML'
  },
  {
    value: 'web_page',
    title: 'Веб-страница',
    subtitle: 'Сырой HTML страницы; для входа по логину используйте «Браузер».',
    badge: 'WEB'
  },
  {
    value: 'forum_thread',
    title: 'Тред форума',
    subtitle: 'HTML темы — часто удобнее загрузить через встроенный браузер.',
    badge: 'ФОРУМ'
  }
]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function labelSource(v: SourceType): string {
  return SOURCE_OPTIONS.find((o) => o.value === v)?.title ?? v
}

function labelFilter(f: ArticleFilter): string {
  if (f === 'with_sanctions') return 'Только блоки с санкциями'
  if (f === 'without_sanctions') return 'Только без санкций'
  return 'Все блоки'
}

const PIPELINE_PHASES: { title: string; detail: string }[] = [
  { title: 'Подготовка', detail: 'Источник и документ в локальной базе' },
  { title: 'Извлечение текста', detail: 'Для HTML — очистка через Readability; для текста — без изменений по сути' },
  { title: 'Структура статей', detail: 'Эвристики заголовков и фильтр блоков' },
  { title: 'Сохранение', detail: 'Запись статей в SQLite' }
]

export function ImportPage(): JSX.Element {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const replaceDocumentId = useMemo(() => searchParams.get('replace')?.trim() ?? '', [searchParams])

  const [step, setStep] = useState(1)
  const [title, setTitle] = useState('Новый импорт')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [sourceType, setSourceType] = useState<SourceType>('paste_text')
  const [split, setSplit] = useState(true)
  const [articleFilter, setArticleFilter] = useState<ArticleFilter>('all')

  const [busy, setBusy] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [pipelinePhase, setPipelinePhase] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const textOk = text.trim().length > 0
  const titleOk = title.trim().length > 0

  const summaryLines = useMemo(
    () => [
      { k: 'Документ', v: title.trim() || '—' },
      { k: 'Формат', v: labelSource(sourceType) },
      { k: 'Объём', v: `${text.length.toLocaleString()} симв.` },
      { k: 'Разбивка', v: split ? 'Да, эвристика статей' : 'Нет, один блок' },
      { k: 'Фильтр', v: labelFilter(articleFilter) },
      { k: 'URL', v: url.trim() || '—' }
    ],
    [title, sourceType, text.length, split, articleFilter, url]
  )

  const goNext = useCallback(() => {
    setStep((s) => Math.min(4, s + 1))
  }, [])

  const goBack = useCallback(() => {
    setStep((s) => Math.max(1, s - 1))
  }, [])

  const runImport = useCallback(async () => {
    setError(null)
    setBusy(true)
    setOverlayOpen(true)
    setPipelinePhase(0)

    const payload: ImportPayload = {
      title,
      url: url || undefined,
      sourceType,
      rawText: sourceType === 'paste_html' ? undefined : text,
      rawHtml: sourceType === 'paste_html' ? text : undefined,
      splitArticles: split,
      articleFilter
    }

    const timers: ReturnType<typeof setTimeout>[] = []
    timers.push(setTimeout(() => setPipelinePhase(1), 360))
    timers.push(setTimeout(() => setPipelinePhase(2), 720))

    try {
      let documentId: string
      if (replaceDocumentId) {
        const res = await window.lawHelper.import.replaceDocument({
          documentId: replaceDocumentId,
          ...payload
        })
        if (!res.ok) {
          const msg =
            res.error === 'document_not_found'
              ? 'Документ не найден.'
              : res.error === 'no_source'
                ? 'У документа нет источника для обновления.'
                : `Ошибка: ${res.error}`
          timers.forEach(clearTimeout)
          setError(msg)
          setPipelinePhase(0)
          return
        }
        documentId = res.documentId
      } else {
        const res = await window.lawHelper.import.payload(payload)
        documentId = res.documentId
      }
      timers.forEach(clearTimeout)
      setPipelinePhase(3)
      await sleep(480)
      setOverlayOpen(false)
      setPipelinePhase(0)
      navigate(`/reader/${documentId}`)
    } catch (err) {
      timers.forEach(clearTimeout)
      setError(err instanceof Error ? err.message : 'Ошибка импорта')
      setPipelinePhase(0)
    } finally {
      setBusy(false)
    }
  }, [articleFilter, navigate, replaceDocumentId, sourceType, split, text, title, url])

  const closeOverlay = useCallback(() => {
    if (busy) return
    setOverlayOpen(false)
    setError(null)
    setPipelinePhase(0)
  }, [busy])

  return (
    <div className="relative min-h-0 space-y-8">
      <header className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-[#121822]/95 via-[#0d121a]/92 to-[#080b10]/95 p-6 md:p-8">
        <div className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-accent/12 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent/90">Локальная база</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-[1.75rem]">Импорт материалов</h1>
          {replaceDocumentId ? (
            <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/95">
              Режим <strong className="text-white">обновления документа</strong>: после импорта статьи сопоставятся по
              номеру и заголовку; при изменении текста сохранится предыдущая версия для сравнения в читателе. Закладки на
              удалённые при сопоставлении статьи могут пропасть.
              <span className="mt-1.5 block text-[11px] text-amber-100/75">
                Нужен сайт с авторизацией? То же обновление — во встроенном{' '}
                <Link
                  className="font-medium text-white underline decoration-white/30 hover:decoration-white/60"
                  to={`/browser?replace=${encodeURIComponent(replaceDocumentId)}`}
                >
                  браузере
                </Link>
                .
              </span>
            </div>
          ) : null}
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-app-muted">
            Текст или HTML обрабатываются в приложении: извлечение текста (в т.ч. Readability), разбор на статьи и запись в SQLite.
            Страницы с авторизацией удобнее открыть во встроенном{' '}
            <Link className="font-medium text-accent hover:underline" to="/browser">
              браузере
            </Link>
            .
          </p>
        </div>
      </header>

      {/* Step rail */}
      <nav className="flex flex-wrap items-center gap-2 md:gap-3" aria-label="Шаги импорта">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="flex items-center gap-2 md:gap-3">
            <button
              type="button"
              disabled={n > step || busy}
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
            {n < 4 ? <span className="hidden h-px w-4 bg-white/15 md:block md:w-8" /> : null}
          </div>
        ))}
        <span className="ml-auto hidden text-[11px] text-white/35 md:inline">
          {step === 1 && 'Формат'}
          {step === 2 && 'Содержимое'}
          {step === 3 && 'Разбор'}
          {step === 4 && 'Запуск'}
        </span>
      </nav>

      <div className="glass rounded-2xl p-6 md:p-8">
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Шаг 1 — формат источника</h2>
              <p className="mt-1 text-sm text-app-muted">От этого зависит, как парсер читает поле ниже на следующем шаге.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {SOURCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSourceType(opt.value)}
                  className={`flex flex-col rounded-2xl border p-4 text-left transition md:p-5 ${
                    sourceType === opt.value
                      ? 'border-accent/45 bg-accent/[0.12] shadow-[inset_0_0_0_1px_rgba(91,140,255,0.2)]'
                      : 'border-white/[0.08] bg-black/20 hover:border-white/15 hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-md border border-white/10 bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-accent/95">
                      {opt.badge}
                    </span>
                    {sourceType === opt.value ? (
                      <span className="text-[10px] font-medium text-accent">выбрано</span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-[15px] font-semibold text-white">{opt.title}</p>
                  <p className="mt-2 text-[12px] leading-relaxed text-app-muted">{opt.subtitle}</p>
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/[0.06] pt-6">
              <button
                type="button"
                onClick={goNext}
                className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-dim"
              >
                Далее
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Шаг 2 — содержимое</h2>
              <p className="mt-1 text-sm text-app-muted">
                {sourceType === 'paste_html' || sourceType === 'web_page' || sourceType === 'forum_thread'
                  ? 'Вставьте HTML: контент страницы или треда. Заголовок документа можно отредактировать ниже.'
                  : 'Вставьте текст кодекса, правил или статьи.'}
              </p>
            </div>

            <label className="block space-y-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Название документа</span>
              <input
                className="w-full rounded-xl border border-white/10 bg-surface-raised px-4 py-3 text-sm text-white outline-none ring-offset-0 transition focus:border-accent/55 focus:ring-2 focus:ring-accent/25"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Например: УК штатов — выдержка"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">
                Исходный URL <span className="font-normal text-white/35">(необязательно)</span>
              </span>
              <input
                className="w-full rounded-xl border border-white/10 bg-surface-raised px-4 py-3 text-sm text-white outline-none focus:border-accent/55 focus:ring-2 focus:ring-accent/25"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://forum.example/…"
              />
            </label>

            <label className="block space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Текст или HTML</span>
                <span className="font-mono text-[10px] tabular-nums text-white/35">{text.length.toLocaleString()} симв.</span>
              </div>
              <textarea
                className="min-h-[min(45vh,22rem)] w-full resize-y rounded-xl border border-white/10 bg-[#0a0d12]/90 px-4 py-3 font-mono text-[13px] leading-relaxed text-white/95 outline-none focus:border-accent/55 focus:ring-2 focus:ring-accent/25"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  sourceType === 'paste_text'
                    ? 'Вставьте текст…'
                    : 'Вставьте HTML или фрагмент страницы…'
                }
                spellCheck={false}
              />
            </label>

            {(sourceType === 'web_page' || sourceType === 'forum_thread') && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3 text-[12px] leading-relaxed text-amber-50/95">
                Нужна авторизация на сайте? Откройте страницу во вкладке{' '}
                <Link className="font-semibold text-amber-200 underline-offset-2 hover:underline" to="/browser">
                  Браузер
                </Link>{' '}
                и импортируйте оттуда — так сохранятся cookies и доступ к закрытым темам.
              </div>
            )}

            <div className="flex flex-wrap justify-between gap-2 border-t border-white/[0.06] pt-6">
              <button
                type="button"
                onClick={goBack}
                className="rounded-xl border border-white/12 px-5 py-2.5 text-sm text-app-muted hover:bg-white/[0.05] hover:text-white"
              >
                Назад
              </button>
              <button
                type="button"
                disabled={!textOk || !titleOk}
                onClick={goNext}
                className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40"
              >
                Далее
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Шаг 3 — как разобрать текст</h2>
              <p className="mt-1 text-sm text-app-muted">
                Авторазбивка использует эвристики по номерам статей и заголовкам; при необходимости потом подправьте статьи в базе.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.07] bg-black/25 p-4">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-white/20 bg-surface-raised text-accent focus:ring-accent"
                checked={split}
                onChange={(e) => setSplit(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium text-white">Разбить на статьи автоматически</span>
                <span className="mt-1 block text-[12px] leading-relaxed text-app-muted">
                  Если выключить — весь текст попадёт в один блок (редко нужно для длинных кодексов).
                </span>
              </span>
            </label>

            <label className="block space-y-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Фильтр блоков после разбивки</span>
              <select
                className="w-full rounded-xl border border-white/10 bg-surface-raised px-4 py-3 text-sm text-white outline-none focus:border-accent/55 focus:ring-2 focus:ring-accent/25"
                value={articleFilter}
                onChange={(e) => setArticleFilter(e.target.value as ArticleFilter)}
              >
                <option value="all">Все блоки</option>
                <option value="with_sanctions">Только с наказанием / штрафом / санкциями</option>
                <option value="without_sanctions">Только справочные (без санкций)</option>
              </select>
            </label>

            <div className="flex flex-wrap justify-between gap-2 border-t border-white/[0.06] pt-6">
              <button
                type="button"
                onClick={goBack}
                className="rounded-xl border border-white/12 px-5 py-2.5 text-sm text-app-muted hover:bg-white/[0.05] hover:text-white"
              >
                Назад
              </button>
              <button type="button" onClick={goNext} className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-dim">
                Далее
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Шаг 4 — проверка и импорт</h2>
              <p className="mt-1 text-sm text-app-muted">Убедитесь в параметрах и запустите разбор. Откроется читатель нового документа.</p>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#080b10]/95">
              <div className="border-b border-white/[0.06] bg-black/30 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">Сводка</p>
              </div>
              <dl className="divide-y divide-white/[0.05]">
                {summaryLines.map((row) => (
                  <div key={row.k} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                    <dt className="text-[12px] text-app-muted">{row.k}</dt>
                    <dd className="max-w-[min(100%,28rem)] text-right text-[13px] font-medium text-white/95">{row.v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>
            )}

            <div className="flex flex-wrap justify-between gap-2 border-t border-white/[0.06] pt-6">
              <button
                type="button"
                onClick={goBack}
                disabled={busy}
                className="rounded-xl border border-white/12 px-5 py-2.5 text-sm text-app-muted hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
              >
                Назад
              </button>
              <button
                type="button"
                disabled={busy || !textOk || !titleOk}
                onClick={() => void runImport()}
                className="rounded-xl bg-gradient-to-r from-accent to-[#5b7cff] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_8px_32px_rgba(91,140,255,0.35)] hover:brightness-110 disabled:opacity-40"
              >
                {busy ? 'Обработка…' : 'Запустить импорт'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Progress overlay */}
      {overlayOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/72 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-progress-title"
        >
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.1] bg-gradient-to-b from-[#121722]/98 to-[#07090e]/98 shadow-[0_24px_80px_rgba(0,0,0,0.65)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
            <div className="border-b border-white/[0.06] px-6 py-5">
              <p id="import-progress-title" className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent/90">
                Разбор документа
              </p>
              <p className="mt-2 text-lg font-semibold text-white">
                {error ? 'Не удалось завершить' : pipelinePhase >= 3 ? 'Готово' : 'Обрабатываем…'}
              </p>
              {!error && pipelinePhase < 3 ? (
                <p className="mt-1 text-[12px] text-app-muted">Пожалуйста, подождите — выполняется локальный парсинг.</p>
              ) : null}
            </div>

            <div className="space-y-0 px-6 py-4">
              {PIPELINE_PHASES.map((ph, i) => {
                const done = error ? false : i < pipelinePhase || (i === pipelinePhase && pipelinePhase >= 3)
                const active = !error && i === pipelinePhase && pipelinePhase < 3
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

            {error ? (
              <div className="border-t border-white/[0.06] px-6 py-4">
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-100">{error}</p>
                <button
                  type="button"
                  onClick={closeOverlay}
                  className="mt-4 w-full rounded-xl border border-white/12 py-2.5 text-sm font-medium text-white hover:bg-white/[0.06]"
                >
                  Закрыть и исправить
                </button>
              </div>
            ) : (
              <div className="border-t border-white/[0.06] px-6 py-4">
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-accent to-[#7e9cff] transition-all duration-500 ease-out"
                    style={{
                      width: `${Math.min(100, ((pipelinePhase + 1) / PIPELINE_PHASES.length) * 100)}%`
                    }}
                  />
                </div>
                <p className="mt-3 text-center text-[10px] text-white/35">Данные не отправляются в интернет — только ваш ПК.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
