import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * Хаб для сотрудников гос. организаций на GTA5RP (полиция, шериф, EMS, госструктуры).
 * Без привязки к конкретному ведомству РФ — ориентир Los Santos / типичный американский сеттинг RP.
 */

export const DEFAULT_QUICK_SEARCH_PRESETS: { label: string; q: string }[] = [
  { label: 'Задержание / арест', q: 'задержание арест Miranda' },
  { label: 'Кодексы / штрафы', q: 'штраф кодекс' },
  { label: 'Обыск / изъятие', q: 'обыск изъятие' },
  { label: 'Дорога / патруль', q: 'патруль транспорт' },
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
  'Справочник показывает только те документы, которые вы добавили в LexPatrol.',
  'Перед серьёзным решением или репортом откройте формулировку в читателе и убедитесь в тексте первоисточника.',
  'Набор кодексов и уставов определяется вашим сервером — при изменении правил обновите импорт.',
  'В режиме «фокус» на оверлее выделяются положения о санкциях и штрафах — удобно в патруле.'
]

export function GovernmentPage(): JSX.Element {
  const [stats, setStats] = useState({ docs: 0, articles: 0 })
  const [presets, setPresets] = useState<{ label: string; q: string }[]>(DEFAULT_QUICK_SEARCH_PRESETS)
  const [presetsReady, setPresetsReady] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<DraftRow[]>([])
  const [saveHint, setSaveHint] = useState<string | null>(null)

  useEffect(() => {
    void window.lawHelper.stats.summary().then((s) => setStats({ docs: s.documentCount, articles: s.articleCount }))
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
    <div className="space-y-10">
      <header className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-surface-raised/90 via-[#12151c] to-[#0d1118] p-8 shadow-glass">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/90">LexPatrol</p>
        <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-accent/85">GTA5RP · гос. организации</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Справочник для госорганов</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-app-muted">
          Здесь собраны <strong className="text-app/90">ваши</strong> импортированные законы, уставы и приказы. Сценарий —{' '}
          <strong className="text-white/90">LSPD</strong>, шериф, EMS и другие госструктуры в{' '}
          <strong className="text-white/90">Los Santos</strong>; состав базы вы задаёте сами через импорт.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-xs text-app-muted">
          <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1">Документов: {stats.docs}</span>
          <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1">Статей: {stats.articles}</span>
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="glass rounded-2xl p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Быстрый поиск</h2>
              <p className="mt-1 text-xs text-app-muted">
                Переход в базу знаний с готовым запросом. Список запросов можно изменить под свой сервер.
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

        <div className="glass rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-white">Импорт и оверлей</h2>
          <ul className="mt-3 space-y-3 text-sm text-app-muted">
            <li>
              <Link className="text-accent hover:underline" to="/import">
                Импорт текста/HTML
              </Link>{' '}
              — вставьте выдержки из устава, кодексов форума или PDF (текстом).
            </li>
            <li>
              <Link className="text-accent hover:underline" to="/browser">
                Встроенный браузер
              </Link>{' '}
              — войдите на форум вручную, затем «Импорт текущей страницы».
            </li>
            <li>
              Закрепите статьи на оверлее —{' '}
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => void window.lawHelper.overlay.show()}
              >
                показать оверлей
              </button>
              .
            </li>
          </ul>
        </div>
      </section>

      <section className="glass rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white">Напоминания</h2>
        <ul className="mt-4 space-y-3 text-sm text-app-muted">
          {REMINDERS.map((line) => (
            <li key={line} className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/80" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-dashed border-white/15 bg-surface/40 p-6">
        <h2 className="text-sm font-semibold text-white">ИИ под вашу роль</h2>
        <p className="mt-2 text-sm text-app-muted">
          В разделе «ИИ» можно задать агента с ролью и инструкциями (например, краткие ответы от лица LSPD со ссылками на статьи
          базы). Так выдерживается стиль игры, без смешения с реальными органами.
        </p>
        <Link to="/ai" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          Настроить провайдера и агентов →
        </Link>
      </section>
    </div>
  )
}
