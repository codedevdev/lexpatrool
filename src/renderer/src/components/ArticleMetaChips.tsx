import type { ReactNode } from 'react'
import {
  JURISDICTION_LABELS,
  SEVERITY_LABELS,
  SEVERITY_TOOLTIPS,
  type ArticleDisplayMeta
} from '@parsers/article-enrichment'

type ChipSize = 'sm' | 'md'

interface ArticleMetaChipsProps {
  meta: ArticleDisplayMeta
  /** В оверлее карточки должна быть компактнее, в читателе — стандартного размера. */
  size?: ChipSize
  /** Скрыть «Залог …» (например, в карточке читателя залог рендерится отдельно). */
  omitBail?: boolean
  /** Скрыть «★ N · тяжесть» — например, если рядом отрисован собственный индикатор. */
  omitStars?: boolean
  /** Класс контейнера (по умолчанию — отступ сверху и flex-wrap). */
  className?: string
}

const SIZE_CLASS: Record<ChipSize, string> = {
  sm: 'rounded px-1.5 py-0.5 text-[10px] leading-none',
  md: 'rounded-full px-2.5 py-1 text-xs leading-none'
}

const STARS_CHARS = '★★★★★'

function chip(
  size: ChipSize,
  bg: string,
  fg: string,
  key: string,
  content: ReactNode,
  title?: string
): JSX.Element {
  return (
    <span
      key={key}
      className={`${SIZE_CLASS[size]} ${bg} ${fg} max-w-full truncate`}
      title={title}
    >
      {content}
    </span>
  )
}

export function ArticleMetaChips({
  meta,
  size = 'md',
  omitBail,
  omitStars,
  className
}: ArticleMetaChipsProps): JSX.Element | null {
  const chips: ReactNode[] = []

  if (meta.jurisdiction) {
    const j = JURISDICTION_LABELS[meta.jurisdiction]
    const bg =
      meta.jurisdiction === 'R'
        ? 'bg-emerald-500/15'
        : meta.jurisdiction === 'F'
          ? 'bg-sky-500/15'
          : 'bg-slate-400/15'
    const fg =
      meta.jurisdiction === 'R'
        ? 'text-emerald-100/95'
        : meta.jurisdiction === 'F'
          ? 'text-sky-100/95'
          : 'text-slate-100/90'
    chips.push(
      chip(
        size,
        bg,
        fg,
        'jur',
        <>
          <span className="font-semibold">{meta.jurisdiction}</span>
          <span className="ml-1 opacity-90">{j.short}</span>
        </>,
        j.tooltip
      )
    )
  }

  if (meta.criminalRecord) {
    chips.push(
      chip(
        size,
        'bg-rose-500/15',
        'text-rose-100/95',
        'cr',
        <span className="font-semibold tracking-wide">CR · Судимость</span>,
        'CR · даёт судимость (criminal record)'
      )
    )
  }

  if (!omitStars && meta.stars != null && meta.stars > 0) {
    const n = Math.min(5, Math.max(1, Math.round(meta.stars)))
    const tier = meta.severityTier
    const tierLabel = tier ? SEVERITY_LABELS[tier] : null
    const tierTooltip = tier ? SEVERITY_TOOLTIPS[tier] : `${n} звёзд розыска`
    chips.push(
      chip(
        size,
        'bg-amber-500/15',
        'text-amber-100/95',
        'stars',
        <>
          <span aria-hidden="true">{STARS_CHARS.slice(0, n)}</span>
          <span className="ml-1 opacity-95">{n}*</span>
          {tierLabel ? <span className="ml-1 opacity-80">· {tierLabel}</span> : null}
        </>,
        tierTooltip
      )
    )
  }

  if (meta.fineUsd != null && meta.fineUsd > 0) {
    chips.push(
      chip(
        size,
        'bg-emerald-500/15',
        'text-emerald-100/90',
        'usd',
        `${Math.round(meta.fineUsd).toLocaleString('ru-RU')}$`,
        'Штраф / упомянутая сумма в USD'
      )
    )
  }

  if (meta.fineRub != null && meta.fineRub > 0) {
    chips.push(
      chip(
        size,
        'bg-emerald-500/15',
        'text-emerald-100/90',
        'rub',
        `${Math.round(meta.fineRub).toLocaleString('ru-RU')} ₽`,
        'Штраф / упомянутая сумма в рублях'
      )
    )
  }

  if (!omitBail && meta.bailHint?.trim()) {
    const b = meta.bailHint.trim()
    chips.push(
      chip(
        size,
        'bg-sky-500/15',
        'text-sky-100/95',
        'bail',
        <>Залог · {b.length > 48 ? `${b.slice(0, 45)}…` : b}</>,
        b
      )
    )
  }

  if (meta.ukArticle) {
    chips.push(
      chip(
        size,
        'bg-violet-500/15',
        'text-violet-100/90',
        'uk',
        `УК ${meta.ukArticle}`,
        'Ссылка на статью УК (упомянута в теле)'
      )
    )
  }

  if (!chips.length) return null
  return (
    <div className={className ?? 'mt-3 flex flex-wrap items-center gap-1.5'}>
      {chips}
    </div>
  )
}
