import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

type Props = {
  variant?: 'empty' | 'loading' | 'error'
  title: string
  description?: string
  /** Техническая строка ошибки (только variant error) */
  errorDetail?: string
  /** Доп. блок под кнопками */
  children?: ReactNode
}

/**
 * Пустое состояние маршрута: не «белый экран», а текст + куда уйти (назад / база / главная).
 */
export function RouteEmptyState({
  variant = 'empty',
  title,
  description,
  errorDetail,
  children
}: Props): JSX.Element {
  const navigate = useNavigate()

  if (variant === 'loading') {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#0c0e14]/80 p-10 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent" aria-hidden />
        <p className="mt-4 text-sm text-app-muted">{title}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/25 p-8 text-center">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {description ? <p className="mt-3 max-w-lg text-sm leading-relaxed text-app-muted">{description}</p> : null}
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
        >
          ← Назад
        </button>
        <button
          type="button"
          onClick={() => navigate('/kb')}
          className="rounded-lg border border-accent/35 bg-accent/15 px-4 py-2 text-sm text-accent hover:bg-accent/25"
        >
          База знаний
        </button>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-lg border border-white/10 bg-surface-raised px-4 py-2 text-sm text-app-muted hover:bg-surface-hover hover:text-white"
        >
          На главную
        </button>
      </div>
      {variant === 'error' && errorDetail ? (
        <pre className="mt-6 max-w-lg overflow-auto rounded-lg border border-red-500/20 bg-black/40 p-3 text-left font-mono text-xs text-red-200/90">
          {errorDetail}
        </pre>
      ) : null}
      {children}
    </div>
  )
}
