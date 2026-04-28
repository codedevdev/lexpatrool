/**
 * Текст DOM-узла с переводами строк (для эвристик splitIntoArticles).
 */

export function elementPlainTextPreservingBreaks(root: Element): string {
  const parts: string[] = []
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      parts.push(node.textContent ?? '')
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'br') {
      parts.push('\n')
      return
    }
    const block =
      /^(p|div|li|tr|h[1-6]|blockquote|section|article|table|thead|tbody|dd|dt|pre)$/i.test(
        tag
      ) || el.classList.contains('bbWrapper')
    for (const c of el.childNodes) {
      walk(c)
    }
    if (block) parts.push('\n')
  }
  walk(root)
  return parts
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+\n/g, '\n')
    .replace(/\n[ \t\f\v]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
