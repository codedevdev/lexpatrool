import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

export function DashboardPage(): JSX.Element {
  const [version, setVersion] = useState<string>('')
  const [counts, setCounts] = useState({ docs: 0, sources: 0 })

  useEffect(() => {
    void window.lawHelper.getVersion().then(setVersion)
    void Promise.all([window.lawHelper.documents.list(), window.lawHelper.sources.list()]).then(
      ([d, s]) => {
        setCounts({ docs: (d as unknown[]).length, sources: (s as unknown[]).length })
      }
    )
  }, [])

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-white">
          LexPatrol <span className="text-base font-normal text-app-muted">— обзор</span>
        </h1>
        <p className="mt-2 text-sm text-app-muted max-w-2xl leading-relaxed">
          Справочник для <strong className="text-app/95">государственных организаций</strong> на GTA5RP-серверах
          (полиция Los Santos, шериф, EMS, госструктуры — как настроите сами). Импортируйте правила с форума,
          ищите по базе, закрепляйте статьи на оверлее. Окно поверх игры —{' '}
          <strong className="text-app/95">без инъекций</strong> в GTA5.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="glass rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wide text-app-muted">Документы</div>
          <div className="mt-2 text-3xl font-semibold text-white">{counts.docs}</div>
        </div>
        <div className="glass rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wide text-app-muted">Источники</div>
          <div className="mt-2 text-3xl font-semibold text-white">{counts.sources}</div>
        </div>
        <div className="glass rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wide text-app-muted">Версия</div>
          <div className="mt-2 text-lg font-mono text-white">{version || '…'}</div>
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
