import { describe, expect, it } from 'vitest'
import { filterArticleSplits, textHasSanctionSignals } from './article-import-filter'
import type { SplitArticle } from './article-split'

function split(n: string | null, h: string, b: string): SplitArticle {
  return { articleNumber: n, heading: h, body: b }
}

describe('filterArticleSplits', () => {
  it('в режиме all возвращает все блоки', () => {
    const splits = [split('1', 'A', 'текст'), split('2', 'B', 'ещё')]
    expect(filterArticleSplits(splits, 'all').length).toBe(2)
  })

  it('with_sanctions оставляет блок с классификатором (R, CR)', () => {
    const splits = [split('10', 'Статья', 'Наказание (A, CR) штраф')]
    const out = filterArticleSplits(splits, 'with_sanctions')
    expect(out.length).toBe(1)
  })

  it('without_sanctions отсекает блок с явным Наказание:', () => {
    const splits = [split('1', 'X', 'Наказание: штраф 1000 руб')]
    const out = filterArticleSplits(splits, 'without_sanctions')
    expect(out.length).toBe(0)
  })
})

describe('textHasSanctionSignals', () => {
  it('находит маркер штрафа в мягком режиме', () => {
    expect(textHasSanctionSignals('штраф 500 рублей за нарушение')).toBe(true)
  })

  it('находит табличный маркер | 1000* в balanced', () => {
    expect(textHasSanctionSignals('Санкция по таблице | 1000* за проступок')).toBe(true)
  })
})
