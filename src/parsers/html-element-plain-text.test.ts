import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { elementPlainTextPreservingBreaks } from './html-element-plain-text'

describe('elementPlainTextPreservingBreaks', () => {
  it('сохраняет br как перевод строки', () => {
    const dom = new JSDOM('<div>a<br>b</div>')
    const el = dom.window.document.body.querySelector('div')!
    expect(elementPlainTextPreservingBreaks(el)).toContain('a\nb')
  })

  it('добавляет перевод после блочных тегов', () => {
    const dom = new JSDOM('<div><p>one</p><p>two</p></div>')
    const el = dom.window.document.body.querySelector('div')!
    const t = elementPlainTextPreservingBreaks(el)
    expect(t).toContain('one')
    expect(t).toContain('two')
  })
})
