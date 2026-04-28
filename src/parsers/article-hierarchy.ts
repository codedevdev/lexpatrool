/**
 * Иерархия номеров статей: 10.3 → 10.3.1 (подстатья), без жёсткой схемы УК — только префиксы с точкой.
 */

export type ArticleStackEntry = { id: string; articleNumber: string }

/**
 * Сбрасывает хвост стека, пока новый номер не станет прямым потомком вершины.
 * Возвращает parentId (если есть) и уровень вложенности (1 = корень документа).
 */
export function attachArticleToStack(
  stack: ArticleStackEntry[],
  articleNumber: string
): { parentId: string | null; level: number } {
  const num = articleNumber.trim()
  let parentId: string | null = null
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!
    if (num.startsWith(`${top.articleNumber}.`) && num !== top.articleNumber) {
      parentId = top.id
      break
    }
    stack.pop()
  }
  const level = parentId ? stack.length + 1 : 1
  return { parentId, level }
}
