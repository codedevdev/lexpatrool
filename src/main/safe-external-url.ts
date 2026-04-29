/**
 * Разрешаем только обычные http/https URL для shell.openExternal / IPC.
 * Блокируем javascript:, file:, data:, bespoke-схемы и синтаксически неверные строки.
 */
export function isSafeExternalHttpUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  const s = raw.trim()
  if (!s || s.length > 8192) return false
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return false
  }
  return u.protocol === 'http:' || u.protocol === 'https:'
}
