/**
 * Сборка строки Electron Accelerator из KeyboardEvent (формат как у globalShortcut.register).
 * Требуется хотя бы один модификатор — иначе глобальная регистрация на Windows обычно нежелательна.
 */
export function keyboardEventToAccelerator(ev: KeyboardEvent): string | null {
  if (ev.repeat) return null
  const ignore = new Set([
    'ControlLeft',
    'ControlRight',
    'ShiftLeft',
    'ShiftRight',
    'AltLeft',
    'AltRight',
    'MetaLeft',
    'MetaRight'
  ])
  if (ignore.has(ev.code)) return null

  const parts: string[] = []
  if (ev.ctrlKey || ev.metaKey) parts.push('CommandOrControl')
  if (ev.altKey) parts.push('Alt')
  if (ev.shiftKey) parts.push('Shift')

  const key = codeToAcceleratorToken(ev.code)
  if (!key) return null

  parts.push(key)

  const hasMod = parts.some((p) => p === 'CommandOrControl' || p === 'Alt' || p === 'Shift')
  if (!hasMod) return null

  return parts.join('+')
}

function codeToAcceleratorToken(code: string): string | null {
  if (code === 'Space') return 'Space'
  if (code.startsWith('Key') && code.length === 4) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (/^F\d{1,2}$/.test(code)) return code

  const map: Record<string, string> = {
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`',
    IntlBackslash: '\\',
    Tab: 'Tab',
    Enter: 'Enter',
    Escape: 'Escape',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right'
  }
  return map[code] ?? null
}
