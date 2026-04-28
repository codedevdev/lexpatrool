import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * Хаб для сотрудников гос. организаций на GTA5RP (полиция, шериф, EMS, госструктуры).
 * Без привязки к конкретному ведомству РФ — ориентир Los Santos / типичный американский сеттинг RP.
 */

const SEARCH_PRESETS = [
  { label: 'Задержание / арест', q: 'задержание арест Miranda' },
  { label: 'Кодексы / штрафы', q: 'штраф кодекс' },
  { label: 'Обыск / изъятие', q: 'обыск изъятие' },
  { label: 'Дорога / патруль', q: 'патруль транспорт' },
  { label: 'Оружие', q: 'оружие ношение' },
  { label: 'EMS / мед. помощь', q: 'медицинская помощь EMS' }
]

const REMINDERS = [
  'Все ответы и шпаргалки опираются только на то, что вы сами импортировали из правил сервера и форума.',
  'Перед репортом или жёсткой мерой перепроверьте статью в читателе — ИИ и оверлей могут ошибаться.',
  'Роль LSPD / LSSD / EMS задаётся вашим сервером: подставьте свои уставы и кодексы через «Импорт».',
  'Оверлей в режиме «фокус» подсвечивает строки со штрафами и санкциями — удобно в патруле.'
]

export function GovernmentPage(): JSX.Element {
  const [stats, setStats] = useState({ docs: 0, sources: 0 })

  useEffect(() => {
    void Promise.all([window.lawHelper.documents.list(), window.lawHelper.sources.list()]).then(([d, s]) =>
      setStats({ docs: (d as unknown[]).length, sources: (s as unknown[]).length })
    )
  }, [])

  return (
    <div className="space-y-10">
      <header className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-surface-raised/90 via-[#12151c] to-[#0d1118] p-8 shadow-glass">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/90">LexPatrol</p>
        <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-accent/85">GTA5RP · гос. организации</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Справочник для госорганов</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-app-muted">
          Единый справочник по <strong className="text-app/90">импортированным</strong> законам, уставам и приказам вашего сервера.
          Подходит для сценариев в духе <strong className="text-white/90">LSPD</strong>, шерифа, EMS и других государственных структур в{' '}
          <strong className="text-white/90">Los Santos</strong> — без привязки к реальным ведомствам; вы сами задаёте контент базы.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-xs text-app-muted">
          <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1">Документов: {stats.docs}</span>
          <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1">Источников: {stats.sources}</span>
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="glass rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-white">Быстрый поиск</h2>
          <p className="mt-1 text-xs text-app-muted">Запросы подставляются в базу знаний — отредактируйте под свой сервер.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {SEARCH_PRESETS.map((p) => (
              <Link
                key={p.label}
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
          На странице «ИИ» создайте агента с ролью вроде: «Сотрудник LSPD, отвечай кратко, ссылайся только на статьи из базы,
          указывай id статьи». Так выровняете тон под полицию Los Santos, не смешивая с реальными органами.
        </p>
        <Link to="/ai" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          Настроить провайдера и агентов →
        </Link>
      </section>
    </div>
  )
}
