import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import brandLogo from '../assets/brand-logo.png'

const nav = [
  { to: '/', label: 'Обзор' },
  { to: '/patrol', label: 'На посту' },
  { to: '/import', label: 'Импорт' },
  { to: '/browser', label: 'Браузер' },
  { to: '/kb', label: 'База' },
  { to: '/ai', label: 'ИИ' },
  { to: '/notes', label: 'Заметки' },
  { to: '/settings', label: 'Настройки' }
]

const DISMISS_UPDATE_KEY = 'lexpatrol-dismiss-update-version'

type UpdateBanner = {
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  downloadUrl: string
  publishedAt?: string
  releaseNotes?: string
}

function fmtReleaseDate(iso?: string): string {
  if (!iso?.trim()) return ''
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const [banner, setBanner] = useState<UpdateBanner | null>(null)

  useEffect(() => {
    const off = window.lawHelper.update.onAvailable((p) => {
      try {
        if (localStorage.getItem(DISMISS_UPDATE_KEY) === p.latestVersion) return
      } catch {
        /* ignore */
      }
      setBanner(p)
    })
    return () => off()
  }, [])

  function dismissBanner(): void {
    if (banner) {
      try {
        localStorage.setItem(DISMISS_UPDATE_KEY, banner.latestVersion)
      } catch {
        /* ignore */
      }
    }
    setBanner(null)
  }

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
            <div className="mt-3 text-[10px] uppercase tracking-[0.2em] text-app-muted">RP · справочник</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-white">LexPatrol</div>
            <p className="mt-2 text-xs text-app-muted leading-relaxed">
              Локальная база норм и быстрый поиск; оверлей — отдельное окно поверх игры. Не привязано к конкретному серверу.
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
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {banner ? (
            <div
              className="shrink-0 border-b border-emerald-500/25 bg-emerald-500/[0.08] px-4 py-3 sm:px-8"
              role="status"
            >
              <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-sm text-emerald-50/95">
                  <span className="font-semibold text-white">Доступна новая версия</span>{' '}
                  <span className="text-emerald-100/85">
                    {banner.currentVersion} → {banner.latestVersion}
                  </span>
                  {fmtReleaseDate(banner.publishedAt) ? (
                    <span className="ml-2 text-xs text-emerald-100/55">· {fmtReleaseDate(banner.publishedAt)}</span>
                  ) : null}
                  <span className="mt-1 block text-xs leading-snug text-emerald-100/70">
                    Откроется страница с файлом: скачайте установщик, закройте LexPatrol и запустите его — как при обычной
                    установке программы.
                  </span>
                  {banner.releaseNotes ? (
                    <p className="mt-2 max-h-[4.5rem] overflow-y-auto whitespace-pre-wrap rounded-md border border-emerald-500/20 bg-black/20 px-2 py-1.5 text-[11px] leading-relaxed text-emerald-50/90">
                      {banner.releaseNotes}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-white/15 bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.12]"
                    onClick={() => window.lawHelper.shell.openExternal(banner.releaseUrl)}
                  >
                    Страница релиза
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-emerald-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
                    onClick={() => window.lawHelper.shell.openExternal(banner.downloadUrl)}
                  >
                    Скачать файл
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-emerald-100/90 hover:bg-white/[0.06]"
                    onClick={() => dismissBanner()}
                  >
                    Позже
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-8">{children}</div>
          </div>
        </main>
      </div>
    </div>
  )
}
