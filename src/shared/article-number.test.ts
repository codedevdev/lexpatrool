import { describe, expect, it } from 'vitest'
import {
  articleNumberMatchesQuery,
  normalizeArticleNumberCore,
  parseArticleNumbersFromQuery,
  pickPrimaryArticleNumberFromQuery,
  rowTextMatchesArticleNumber,
  sqlLiteralVariantsForArticleNumber
} from './article-number'

describe('normalizeArticleNumberCore', () => {
  it('убирает № и запятые в пользу точек', () => {
    expect(normalizeArticleNumberCore('№ 8,1')).toBe('8.1')
  })

  it('схлопывает лишние точки', () => {
    expect(normalizeArticleNumberCore('1...2')).toBe('1.2')
  })
})

describe('parseArticleNumbersFromQuery', () => {
  it('находит номера после слова статья', () => {
    expect(parseArticleNumbersFromQuery('статья 8.1 про кражу')).toContain('8.1')
  })

  it('возвращает пустой массив без номеров', () => {
    expect(parseArticleNumbersFromQuery('просто текст')).toEqual([])
  })
})

describe('pickPrimaryArticleNumberFromQuery', () => {
  it('предпочитает подстатью 8.1 перед 8', () => {
    expect(pickPrimaryArticleNumberFromQuery('ст. 8 и статья 8.1')).toBe('8.1')
  })

  it('ловит номер в скобках как loose match', () => {
    expect(pickPrimaryArticleNumberFromQuery('текст (12.3) далее')).toBe('12.3')
  })
})

describe('articleNumberMatchesQuery', () => {
  it('совпадает после нормализации', () => {
    expect(articleNumberMatchesQuery('Статья 8.1', '8,1')).toBe(true)
  })

  it('возвращает false при пустом значении в БД', () => {
    expect(articleNumberMatchesQuery(null, '1')).toBe(false)
  })
})

describe('sqlLiteralVariantsForArticleNumber', () => {
  it('возвращает несколько вариантов строки', () => {
    const v = sqlLiteralVariantsForArticleNumber('8.1')
    expect(v.length).toBeGreaterThan(2)
    expect(v).toContain('8.1')
  })
})

describe('rowTextMatchesArticleNumber', () => {
  it('совпадает по полю article_number', () => {
    expect(rowTextMatchesArticleNumber('8.1', 'Заголовок', '8.1')).toBe(true)
  })

  it('находит номер в заголовке с границами слов', () => {
    expect(rowTextMatchesArticleNumber(null, 'Статья 8.1. Кража', '8.1')).toBe(true)
  })
})
