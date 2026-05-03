import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { CommandPalette } from './CommandPalette'
import { InAppUpdateBanner, type InAppBannerPayload } from './InAppUpdateBanner'
import { LEX_COMMUNITY_DISCORD_URL } from '../lib/app-links'
import brandLogo from '../assets/brand-logo.png'

const nav = [
  { to: '/', label: 'Обзор' },
  { to: '/patrol', label: 'На посту' },
  { to: '/import', label: 'Импорт' },
  { to: '/browser', label: 'Браузер' },
  { to: '/kb', label: 'База' },
  { to: '/collections', label: 'Подборки' },
  { to: '/cheats', label: 'Шпаргалки' },
  { to: '/ai', label: 'ИИ' },
  { to: '/notes', label: 'Заметки' },
  { to: '/settings', label: 'Настройки' }
]

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const [banner, setBanner] = useState<InAppBannerPayload | null>(null)
  const [updateToast, setUpdateToast] = useState<{ text: string; url: string } | null>(null)

  useEffect(() => {
    const off = window.lawHelper.update.onAvailable((p) => {
      setBanner({
        currentVersion: p.currentVersion,
        latestVersion: p.latestVersion,
        releaseUrl: p.releaseUrl,
        downloadUrl: p.downloadUrl,
        publishedAt: p.publishedAt,
        releaseNotes: p.releaseNotes,
        critical: p.critical
      })
    })
    return () => off()
  }, [])

  useEffect(() => {
    const off = window.lawHelper.update.onAfterUpdate((p) => {
      setUpdateToast({
        text: `Обновлено до v${p.newVersion} (было v${p.oldVersion}).`,
        url: p.releaseUrl
      })
    })
    return () => off()
  }, [])

  useEffect(() => {
    if (!updateToast) return
    const t = window.setTimeout(() => setUpdateToast(null), 9000)
    return () => window.clearTimeout(t)
  }, [updateToast])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-canvas text-app selection:bg-accent/25 selection:text-white">
      <div className="flex min-h-0 flex-1">
        <aside className="relative flex h-full min-h-0 w-56 shrink-0 flex-col overflow-y-auto border-r border-white/[0.06] bg-[#0c0e14]/95 backdrop-blur-xl lex-app-scroll before:pointer-events-none before:absolute before:inset-y-0 before:right-0 before:w-px before:bg-gradient-to-b before:from-transparent before:via-accent/20 before:to-transparent">
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
          <div className="mt-auto flex flex-col gap-2 px-4 pb-6">
            <button
              type="button"
              onClick={() => void window.lawHelper.overlay.show()}
              className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white hover:bg-surface-hover"
            >
              Показать оверлей
            </button>
            <button
              type="button"
              onClick={() => void window.lawHelper.toolOverlay.toggle('cheats')}
              className="w-full rounded-lg border border-accent/25 bg-accent/10 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/20"
            >
              Окно шпаргалок
            </button>
            <button
              type="button"
              onClick={() => void window.lawHelper.toolOverlay.toggle('collections')}
              className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-xs text-white/90 hover:bg-surface-hover"
            >
              Окно подборок
            </button>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
              <p className="text-[11px] font-medium text-white/90">Сообщество</p>
              <p className="mt-1 text-[10px] leading-relaxed text-app-muted">
                Поддержка, вопросы и обсуждения LexPatrol в Discord.
              </p>
              <button
                type="button"
                onClick={() => void window.lawHelper.shell.openExternal(LEX_COMMUNITY_DISCORD_URL)}
                className="mt-2 w-full rounded-lg border border-[#5865F2]/40 bg-[#5865F2]/15 px-3 py-2 text-xs font-medium text-white hover:bg-[#5865F2]/25"
              >
                Discord
              </button>
            </div>
          </div>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {banner ? <InAppUpdateBanner data={banner} onDismissed={() => setBanner(null)} /> : null}
          <div className="min-h-0 flex-1 overflow-y-auto lex-app-scroll">
            <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-8">{children}</div>
          </div>
        </main>
      </div>
      {updateToast ? (
        <div className="fixed bottom-6 left-1/2 z-[220] flex w-[min(92vw,28rem)] -translate-x-1/2 flex-col gap-2 rounded-xl border border-emerald-500/30 bg-[#0f1218]/95 px-4 py-3 text-sm text-emerald-50 shadow-xl backdrop-blur-md">
          <p className="leading-snug">{updateToast.text}</p>
          {updateToast.url ? (
            <button
              type="button"
              className="self-start text-xs font-medium text-accent underline-offset-2 hover:underline"
              onClick={() => void window.lawHelper.shell.openExternal(updateToast.url)}
            >
              Открыть страницу релиза
            </button>
          ) : null}
        </div>
      ) : null}
      <CommandPalette />
    </div>
  )
}
