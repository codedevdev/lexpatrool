import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

export function DashboardPage(): JSX.Element {
  const [version, setVersion] = useState<string>('')
  const [counts, setCounts] = useState({ documents: 0, articles: 0 })
  const [statsLoading, setStatsLoading] = useState(true)

  useEffect(() => {
    void window.lawHelper.getVersion().then(setVersion)
    void window.lawHelper.stats
      .summary()
      .then((s) => setCounts({ documents: s.documentCount, articles: s.articleCount }))
      .catch(() => setCounts({ documents: 0, articles: 0 }))
      .finally(() => setStatsLoading(false))
  }, [])

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-white">
          LexPatrol <span className="text-base font-normal text-app-muted">— обзор</span>
        </h1>
        <p className="mt-2 text-sm text-app-muted max-w-2xl leading-relaxed">
          Справочник по правилам вашего сервера для роли в{' '}
          <strong className="text-app/95">государственных организациях</strong> (полиция Los Santos, шериф, EMS и другие
          структуры — по вашему сценарию). Импортируйте тексты, ищите по базе, закрепляйте статьи в отдельном окне оверлея
          поверх игры — это обычное окно Windows, не модификация клиента GTA5.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="glass rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wide text-app-muted">Документы</div>
          <div className="mt-2 text-3xl font-semibold text-white">
            {statsLoading ? '…' : counts.documents}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-app-muted">
            Импортированные материалы; каждый документ — отдельная единица в базе.
          </p>
        </div>
        <div className="glass rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wide text-app-muted">Статьи</div>
          <div className="mt-2 text-3xl font-semibold text-white">
            {statsLoading ? '…' : counts.articles}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-app-muted">
            Пункты после разбивки документов — по ним работают поиск и оверлей.
          </p>
        </div>
        <div className="glass rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wide text-app-muted">Версия приложения</div>
          <div className="mt-2 text-lg font-mono text-white">{version || '…'}</div>
          <p className="mt-2 text-[11px] leading-snug text-app-muted">
            Номер текущей установленной сборки.
          </p>
        </div>
      </section>

      <section className="glass rounded-2xl p-6">
        <h2 className="text-lg font-medium text-white">Быстрый старт</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-app-muted">
          <li>
            Загляните в{' '}
            <Link className="text-accent hover:underline" to="/government">
              Гос. органы
            </Link>{' '}
            — пресеты поиска и напоминания для патруля и смен.
          </li>
          <li>
            <Link className="text-accent hover:underline" to="/import">
              Импорт
            </Link>
            : вставьте текст закона, HTML или загрузите страницу через{' '}
            <Link className="text-accent hover:underline" to="/browser">
              браузер
            </Link>
            .
          </li>
          <li>
            <Link className="text-accent hover:underline" to="/kb">
              База знаний
            </Link>{' '}
            → читатель → «На оверлей» для игры.
          </li>
        </ol>
      </section>
    </div>
  )
}
