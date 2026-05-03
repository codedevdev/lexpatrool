/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { humanizeAcceleratorForUi, keyboardEventToAccelerator } from './hotkey-format'

describe('keyboardEventToAccelerator', () => {
  it('возвращает null для повторного keydown', () => {
    const ev = new KeyboardEvent('keydown', { repeat: true, code: 'KeyA', ctrlKey: true })
    expect(keyboardEventToAccelerator(ev)).toBeNull()
  })

  it('собирает Ctrl+Shift+буква', () => {
    const ev = new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, shiftKey: true })
    expect(keyboardEventToAccelerator(ev)).toBe('CommandOrControl+Shift+Z')
  })

  it('возвращает null без модификатора', () => {
    const ev = new KeyboardEvent('keydown', { code: 'KeyA' })
    expect(keyboardEventToAccelerator(ev)).toBeNull()
  })
})

describe('humanizeAcceleratorForUi', () => {
  it('подменяет CommandOrControl на Ctrl для не-Mac UA', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Windows NT', configurable: true })
    expect(humanizeAcceleratorForUi('CommandOrControl+F')).toContain('Ctrl')
  })
})
