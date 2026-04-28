import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * Раздел быстрого доступа к нормам для роли (полиция, EMS и др.). UI: «На посту». Маршрут /patrol; редиректы с /government и /mvd.
 */

export const DEFAULT_QUICK_SEARCH_PRESETS: { label: string; q: string }[] = [
  { label: 'Задержание / арест', q: 'задержание арест Miranda' },
  { label: 'Кодексы / штрафы', q: 'штраф кодекс' },
  { label: 'Обыск / изъятие', q: 'обыск изъятие' },
  { label: 'Дорога / выезд', q: 'патруль транспорт' },
  { label: 'Оружие', q: 'оружие ношение' },
  { label: 'EMS / мед. помощь', q: 'медицинская помощь EMS' }
]

const SETTINGS_KEY = 'government_quick_search_presets'

const MAX_PRESETS = 24
const MAX_LABEL = 80
const MAX_QUERY = 400

function parseStoredPresets(json: string | null): { label: string; q: string }[] | null {
  if (!json?.trim()) return null
  try {
    const data = JSON.parse(json) as unknown
    if (!Array.isArray(data)) return null
    const out: { label: string; q: string }[] = []
    for (const row of data) {
      if (!row || typeof row !== 'object') continue
      const o = row as Record<string, unknown>
      const label = typeof o.label === 'string' ? o.label.trim() : ''
      const q = typeof o.q === 'string' ? o.q.trim() : ''
      if (!label || !q) continue
      out.push({
        label: label.slice(0, MAX_LABEL),
        q: q.slice(0, MAX_QUERY)
      })
      if (out.length >= MAX_PRESETS) break
    }
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

type DraftRow = { id: string; label: string; q: string }

const REMINDERS = [
  {
    title: 'Только ваша база',
    text: 'LexPatrol ищет по документам, которые вы сами импортировали. Пустой результат — не «баг», а отсутствие текста в базе.'
  },
  {
    title: 'Сверка с первоисточником',
    text: 'Перед репортом, наказанием в роли или спором в OOC откройте статью в читателе и прочитайте формулировку дословно.'
  },
  {
    title: 'Правила сервера меняются',
    text: 'Если администрация обновила уставы или кодексы — заново импортируйте актуальные версии.'
  },
  {
    title: 'Оверлей в фокусе',
    text: 'Режим «Фокус» на оверлее подсвечивает санкции и штрафы — удобно не листать длинный текст в игре.'
  }
]

export function GovernmentPage(): JSX.Element {
  const [stats, setStats] = useState({ docs: 0, articles: 0 })
  const [presets, setPresets] = useState<{ label: string; q: string }[]>(DEFAULT_QUICK_SEARCH_PRESETS)
  const [presetsReady, setPresetsReady] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<DraftRow[]>([])
  const [saveHint, setSaveHint] = useState<string | null>(null)
  const [hkDisp, setHkDisp] = useState({
    toggle: 'Ctrl+Shift+Space',
    search: 'Ctrl+Shift+F',
    clickThrough: 'Ctrl+Shift+G'
  })

  useEffect(() => {
    void window.lawHelper.stats.summary().then((s) => setStats({ docs: s.documentCount, articles: s.articleCount }))
  }, [])

  useEffect(() => {
    void window.lawHelper.hotkeys
      .get()
      .then((h) => setHkDisp(h.display))
      .catch(() => {})
  }, [])

  useEffect(() => {
    void window.lawHelper.settings.get(SETTINGS_KEY).then((raw) => {
      const parsed = parseStoredPresets(raw)
      setPresets(parsed ?? DEFAULT_QUICK_SEARCH_PRESETS)
      setPresetsReady(true)
    })
  }, [])

  const openEditor = useCallback(() => {
    setSaveHint(null)
    setDraft(
      presets.map((p, i) => ({
        id: `preset-${i}-${p.label.slice(0, 12)}`,
        label: p.label,
        q: p.q
      }))
    )
    setEditing(true)
  }, [presets])

  const cancelEditor = useCallback(() => {
    setEditing(false)
    setSaveHint(null)
  }, [])

  const savePresets = useCallback(async (): Promise<void> => {
    const cleaned = draft
      .map((r) => ({ label: r.label.trim(), q: r.q.trim() }))
      .filter((r) => r.label.length > 0 && r.q.length > 0)
      .slice(0, MAX_PRESETS)
      .map((r) => ({
        label: r.label.slice(0, MAX_LABEL),
        q: r.q.slice(0, MAX_QUERY)
      }))

    if (!cleaned.length) {
      setSaveHint('Нужна хотя бы одна пара «название + запрос», либо нажмите «К умолчанию».')
      return
    }

    await window.lawHelper.settings.set(SETTINGS_KEY, JSON.stringify(cleaned))
    setPresets(cleaned)
    setEditing(false)
    setSaveHint(null)
  }, [draft])

  const resetDraftToDefaults = useCallback(() => {
    setDraft(
      DEFAULT_QUICK_SEARCH_PRESETS.map((p, i) => ({
        id: `def-${i}`,
        label: p.label,
        q: p.q
      }))
    )
    setSaveHint(null)
  }, [])

  const addRow = useCallback(() => {
    setDraft((rows) => {
      if (rows.length >= MAX_PRESETS) return rows
      return [...rows, { id: crypto.randomUUID(), label: '', q: '' }]
    })
  }, [])

  const removeRow = useCallback((id: string) => {
    setDraft((rows) => rows.filter((r) => r.id !== id))
  }, [])

  const updateRow = useCallback((id: string, field: 'label' | 'q', value: string) => {
    setDraft((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }, [])

  return (
    <div className="space-y-8">
      <header className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-[#101522]/95 via-[#0c111a]/92 to-[#080c12]/95 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] md:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/80">Нормы для роли</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">На посту</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-app-muted">
            Здесь — <strong className="text-white/90">к работе в характере</strong> службы: закрепите нужное в базе, доберитесь до
            формулировки одним кликом, выведите материал в оверлей. Подходит полиции, EMS, пожарным и любой госслужбе на вашем
            сервере — что именно читать, задаёт <strong className="text-white/90">ваш</strong> импорт и правила фракции.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-black/35 px-3 py-1.5 font-mono tabular-nums text-white/90">
              Документов: {stats.docs}
            </span>
            <span className="rounded-full border border-white/10 bg-black/35 px-3 py-1.5 font-mono tabular-nums text-white/90">
              Статей: {stats.articles}
            </span>
          </div>
        </div>
      </header>

      <section className="glass rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white">Как пользоваться LexPatrol на посту</h2>
        <p className="mt-1 text-xs text-app-muted">
          От импорта документов до игры и заметок после инцидента — одна цепочка в приложении.
        </p>
        <ol className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <li className="rounded-xl border border-white/[0.06] bg-black/25 px-4 py-4">
            <span className="font-mono text-[10px] text-accent/90">01</span>
            <p className="mt-2 text-[13px] font-medium text-white">Подготовить базу</p>
            <p className="mt-1.5 text-[11px] leading-snug text-app-muted">
              Импорт актуальных кодексов и уставов — без этого поиск и оверлей пусты.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link className="text-[11px] font-medium text-accent hover:underline" to="/import">
                Импорт
              </Link>
              <span className="text-white/20">·</span>
              <Link className="text-[11px] font-medium text-accent hover:underline" to="/browser">
                Браузер
              </Link>
            </div>
          </li>
          <li className="rounded-xl border border-white/[0.06] bg-black/25 px-4 py-4">
            <span className="font-mono text-[10px] text-accent/90">02</span>
            <p className="mt-2 text-[13px] font-medium text-white">Найти до игры</p>
            <p className="mt-1.5 text-[11px] leading-snug text-app-muted">
              Ниже — кнопки с запросами под типичные ситуации; запросы можно подстроить под ваш форум.
            </p>
            <Link className="mt-3 inline-block text-[11px] font-medium text-accent hover:underline" to="/kb">
              База знаний →
            </Link>
          </li>
          <li className="rounded-xl border border-white/[0.06] bg-black/25 px-4 py-4">
            <span className="font-mono text-[10px] text-accent/90">03</span>
            <p className="mt-2 text-[13px] font-medium text-white">В игре</p>
            <p className="mt-1.5 text-[11px] leading-snug text-app-muted">
              Оверлей поверх окна: закрепы статей и поиск по базе ({hkDisp.search}). Переключение мыши — {hkDisp.clickThrough}.
            </p>
            <button
              type="button"
              className="mt-3 text-[11px] font-medium text-accent hover:underline"
              onClick={() => void window.lawHelper.overlay.show()}
            >
              Показать оверлей
            </button>
          </li>
          <li className="rounded-xl border border-white/[0.06] bg-black/25 px-4 py-4">
            <span className="font-mono text-[10px] text-accent/90">04</span>
            <p className="mt-2 text-[13px] font-medium text-white">После инцидента</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-app-muted">
              Вкладка «Заметки» — для любых записей: общий текст по смене или пометки к конкретной статье. Чтобы привязать
              заметку к статье, сначала добавьте её в <strong className="font-medium text-white/75">закладки</strong> в читателе,
              затем в заметке выберите эту статью — так проще собрать материал к репорту или разбору.
            </p>
            <Link className="mt-3 inline-block text-[11px] font-medium text-accent hover:underline" to="/notes">
              Заметки и закладки →
            </Link>
          </li>
        </ol>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="glass rounded-2xl p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Быстрый поиск по ситуации</h2>
              <p className="mt-1 text-xs leading-relaxed text-app-muted">
                Каждая кнопка открывает базу знаний с уже введённым запросом. Настройте под свои формулировки на форуме — кнопка
                «Изменить запросы».
              </p>
            </div>
            {!editing ? (
              <button
                type="button"
                onClick={() => openEditor()}
                disabled={!presetsReady}
                className="shrink-0 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.08] disabled:opacity-40"
              >
                Изменить запросы
              </button>
            ) : null}
          </div>

          {!editing ? (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {presetsReady &&
                  presets.map((p, idx) => (
                    <Link
                      key={`${idx}-${p.label}`}
                      to={`/kb?q=${encodeURIComponent(p.q)}`}
                      className="rounded-xl border border-white/10 bg-surface-raised/80 px-3 py-2 text-xs text-white transition hover:border-accent/40 hover:bg-surface-hover"
                    >
                      {p.label}
                    </Link>
                  ))}
              </div>
              <Link to="/kb" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                Открыть всю базу →
              </Link>
            </>
          ) : (
            <div className="mt-4 space-y-3">
              {saveHint ? <p className="text-xs text-amber-200/90">{saveHint}</p> : null}
              <div className="max-h-[min(52vh,28rem)] space-y-2 overflow-y-auto pr-1">
                {draft.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/25 p-3 sm:flex-row sm:items-end"
                  >
                    <label className="block min-w-0 flex-1 space-y-1 text-[10px] uppercase tracking-wide text-app-muted">
                      Название кнопки
                      <input
                        value={row.label}
                        onChange={(e) => updateRow(row.id, 'label', e.target.value)}
                        maxLength={MAX_LABEL}
                        placeholder="Например: Обыск"
                        className="w-full rounded-lg border border-white/10 bg-surface-raised px-2 py-1.5 text-xs text-white outline-none focus:border-accent/50"
                      />
                    </label>
                    <label className="block min-w-0 flex-[2] space-y-1 text-[10px] uppercase tracking-wide text-app-muted">
                      Поисковый запрос
                      <input
                        value={row.q}
                        onChange={(e) => updateRow(row.id, 'q', e.target.value)}
                        maxLength={MAX_QUERY}
                        placeholder="Слова через пробел…"
                        className="w-full rounded-lg border border-white/10 bg-surface-raised px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-accent/50"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      className="shrink-0 rounded-lg border border-red-500/25 px-2 py-1.5 text-[11px] text-red-200/90 hover:bg-red-500/10 sm:mb-0.5"
                      title="Удалить"
                    >
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => addRow()}
                  disabled={draft.length >= MAX_PRESETS}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-app-muted hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
                >
                  Добавить строку
                </button>
                <button
                  type="button"
                  onClick={() => resetDraftToDefaults()}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-app-muted hover:bg-white/[0.06] hover:text-white"
                >
                  К умолчанию
                </button>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-white/5 pt-4">
                <button
                  type="button"
                  onClick={() => void savePresets()}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim"
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={() => cancelEditor()}
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm text-app-muted hover:bg-white/[0.04]"
                >
                  Отмена
                </button>
              </div>
              <p className="text-[10px] text-app-muted">
                Не более {MAX_PRESETS} строк; пустые отбрасываются. Настройки хранятся на этом компьютере вместе с базой.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="glass rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-white">Импорт и оверлей</h2>
            <ul className="mt-3 space-y-3 text-sm text-app-muted">
              <li>
                <Link className="font-medium text-accent hover:underline" to="/import">
                  Импорт текста/HTML
                </Link>{' '}
                — уставы, кодексы с форума или выдержки из PDF текстом.
              </li>
              <li>
                <Link className="font-medium text-accent hover:underline" to="/browser">
                  Встроенный браузер
                </Link>{' '}
                — авторизация на форуме и импорт открытой страницы.
              </li>
              <li>
                Окно поверх игры:{' '}
                <button
                  type="button"
                  className="font-medium text-accent hover:underline"
                  onClick={() => void window.lawHelper.overlay.show()}
                >
                  показать оверлей
                </button>{' '}
                · скрыть / показать —{' '}
                <span className="font-mono text-[11px] text-white/70">{hkDisp.toggle}</span>.
              </li>
            </ul>
          </div>

          <div className="glass rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-white">Горячие клавиши</h2>
            <p className="mt-1 text-xs text-app-muted">
              Глобальные сочетания работают, пока запущен LexPatrol. Изменить можно в настройках.
            </p>
            <dl className="mt-4 space-y-2 border-t border-white/[0.06] pt-4 text-[11px] text-app-muted">
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-mono text-white/75">{hkDisp.toggle}</dt>
                <dd>показать / скрыть оверлей</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-mono text-white/75">{hkDisp.search}</dt>
                <dd>фокус поиска по базе в оверлее</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-mono text-white/75">{hkDisp.clickThrough}</dt>
                <dd>клики в игру или в панель оверлея</dd>
              </div>
            </dl>
            <Link to="/settings" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
              Настройки →
            </Link>
          </div>
        </div>
      </section>

      <section className="glass rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white">Напоминания на посту</h2>
        <ul className="mt-5 grid gap-4 md:grid-cols-2">
          {REMINDERS.map((item) => (
            <li key={item.title} className="rounded-xl border border-white/[0.05] bg-black/20 px-4 py-4">
              <p className="text-[13px] font-medium text-white/95">{item.title}</p>
              <p className="mt-2 text-[12px] leading-relaxed text-app-muted">{item.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-dashed border-white/15 bg-surface/40 p-6">
        <h2 className="text-sm font-semibold text-white">ИИ под стиль сценария</h2>
        <p className="mt-2 text-sm leading-relaxed text-app-muted">
          В разделе «ИИ» можно задать агента с инструкциями под вашу фракцию: короткие ответы со ссылками на статьи из базы,
          без смешения с реальными госорганами. Провайдер и ключи задаёте вы.
        </p>
        <Link to="/ai" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          ИИ и агенты →
        </Link>
      </section>
    </div>
  )
}
