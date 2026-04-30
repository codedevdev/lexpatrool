import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

export type ToolOverlayKind = 'cheats' | 'collections'

function Btn({
  children,
  onClick,
  title,
  accent
}: {
  children: ReactNode
  onClick: () => void
  title: string
  accent?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-lg border px-2 py-1 text-[11px] transition active:scale-95 ${
        accent
          ? 'border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20'
          : 'border-white/10 bg-white/[0.06] text-white/90 hover:bg-white/12'
      }`}
    >
      {children}
    </button>
  )
}

/** Общая рамка дополнительных окон (шпаргалки / подборки): перетаскивание, стыковка, Esc — скрыть. */
export function ToolOverlayFrame({
  which,
  title,
  subtitle,
  footerHint,
  children
}: {
  which: ToolOverlayKind
  title: string
  subtitle?: string
  footerHint?: string
  children: React.ReactNode
}): JSX.Element {
  const [interactionMode, setInteractionMode] = useState<'game' | 'interactive'>('game')

  useEffect(() => {
    void window.lawHelper.overlay.getInteractionMode().then(setInteractionMode).catch(() => {})
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        void window.lawHelper.toolOverlay.hide(which)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [which])

  return (
    <div
      className="box-border flex h-full min-h-0 max-h-full w-full max-w-full flex-1 flex-col rounded-xl border border-white/[0.12] bg-[#0a0d12] text-app shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_64px_rgba(0,0,0,0.55)]"
      style={{ WebkitFontSmoothing: 'antialiased' } as CSSProperties}
    >
      <header
        className="shrink-0 border-b border-white/[0.08] bg-black/25 px-2 py-2"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 pl-0.5">
            <span className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-white/95">{title}</span>
            {subtitle ? (
              <span className="mt-0.5 block truncate text-[9px] text-white/40">{subtitle}</span>
            ) : null}
          </div>
          <div
            className="flex shrink-0 flex-wrap items-center justify-end gap-1"
            style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          >
            <Btn title="Поверх окон" onClick={() => void window.lawHelper.toolOverlay.raise(which)}>
              ⧈
            </Btn>
            <Btn title="Слева" onClick={() => void window.lawHelper.toolOverlay.dock(which, 'left')}>
              ◀
            </Btn>
            <Btn title="Справа" onClick={() => void window.lawHelper.toolOverlay.dock(which, 'right')}>
              ▶
            </Btn>
            <Btn title="Угол" onClick={() => void window.lawHelper.toolOverlay.dock(which, 'top-right')}>
              ⤢
            </Btn>
            <Btn title="Скрыть (Esc)" accent onClick={() => void window.lawHelper.toolOverlay.hide(which)}>
              ✕
            </Btn>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden p-2" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
        {children}
      </div>
      {footerHint ? (
        <footer className="shrink-0 border-t border-white/[0.06] bg-black/20 px-2 py-1.5 text-[9px] text-white/40">
          {footerHint} · показ: {interactionMode === 'game' ? 'без фокуса' : 'с фокусом'}
        </footer>
      ) : null}
    </div>
  )
}
