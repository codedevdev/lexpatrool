import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import brandLogo from '../assets/brand-logo.png'

const nav = [
  { to: '/', label: 'Обзор' },
  { to: '/government', label: 'Гос. органы' },
  { to: '/import', label: 'Импорт' },
  { to: '/browser', label: 'Браузер' },
  { to: '/kb', label: 'База' },
  { to: '/ai', label: 'ИИ' },
  { to: '/notes', label: 'Заметки' },
  { to: '/settings', label: 'Настройки' }
]

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-canvas text-app selection:bg-accent/25 selection:text-white">
      <div className="flex h-screen">
        <aside className="relative w-56 shrink-0 border-r border-white/[0.06] bg-[#0c0e14]/95 backdrop-blur-xl before:pointer-events-none before:absolute before:inset-y-0 before:right-0 before:w-px before:bg-gradient-to-b before:from-transparent before:via-accent/20 before:to-transparent">
          <div className="px-4 py-5">
            <img
              src={brandLogo}
              alt=""
              className="mx-auto h-16 w-16 object-contain drop-shadow-[0_0_12px_rgba(91,140,255,0.35)]"
              width={64}
              height={64}
            />
            <div className="mt-3 text-xs uppercase tracking-widest text-app-muted">GTA5RP</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-white">LexPatrol</div>
            <p className="mt-2 text-xs text-app-muted leading-relaxed">
              Нормы и правила под рукой: импорт, поиск, оверлей для госорганов. Без вмешательства в игру.
            </p>
          </div>
          <nav className="px-2 pb-4 space-y-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    'block rounded-xl px-3 py-2.5 text-sm transition duration-150',
                    isActive
                      ? 'bg-gradient-to-r from-accent/20 to-white/5 text-white shadow-[inset_0_0_0_1px_rgba(91,140,255,0.25)]'
                      : 'text-app-muted hover:bg-white/[0.04] hover:text-app'
                  ].join(' ')
                }
                end={item.to === '/'}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="px-4 pb-6 mt-auto">
            <button
              type="button"
              onClick={() => void window.lawHelper.overlay.show()}
              className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white hover:bg-surface-hover"
            >
              Показать оверлей
            </button>
          </div>
        </aside>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
