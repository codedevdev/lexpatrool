import { describe, expect, it } from 'vitest'
import { buildMatchSnippet, buildMatchSnippetMulti, extractSearchTokens } from './search-tokens'

describe('extractSearchTokens', () => {
  it('возвращает пустой массив для пустого запроса', () => {
    expect(extractSearchTokens('')).toEqual([])
    expect(extractSearchTokens('   ')).toEqual([])
  })

  it('разбивает кириллические слова', () => {
    expect(extractSearchTokens('кража  оружие')).toContain('кража')
    expect(extractSearchTokens('кража  оружие')).toContain('оружие')
  })

  it('оставляет одиночную цифру как токен', () => {
    expect(extractSearchTokens('статья 8')).toContain('8')
  })

  it('добавляет десятичные номера из текста', () => {
    expect(extractSearchTokens('п. 10.3.1')).toContain('10.3.1')
  })
})

describe('buildMatchSnippet', () => {
  it('возвращает префикс когда нет совпадений', () => {
    const s = buildMatchSnippet('длинный текст без совпадений', ['zzz'], 40)
    expect(s.length).toBeLessThanOrEqual(41)
  })

  it('центрирует вокруг первого токена', () => {
    const body = 'aaa слово bbb'
    expect(buildMatchSnippet(body, ['слово'], 80)).toContain('слово')
  })
})

describe('buildMatchSnippetMulti', () => {
  it('возвращает пустую строку при maxLen < 80', () => {
    expect(buildMatchSnippetMulti('abc def', ['abc'], 50)).toBe('')
  })

  it('покрывает несколько вхождений', () => {
    const body = 'начало ' + 'x'.repeat(200) + ' конец с маркером1 и маркером2'
    const s = buildMatchSnippetMulti(body, ['маркером1', 'маркером2'], 200)
    expect(s).toContain('маркером1')
    expect(s).toContain('маркером2')
  })
})
