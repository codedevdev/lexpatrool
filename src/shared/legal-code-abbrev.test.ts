import { describe, expect, it } from 'vitest'
import {
  codexHintRootsForCanonicalKeys,
  documentTitleMatchesCodexRoots,
  extractCodexCanonicalKeys,
  extractCodexHintRoots
} from './legal-code-abbrev'

describe('extractCodexCanonicalKeys', () => {
  it('detects UK and PK independently', () => {
    expect(extractCodexCanonicalKeys('10.3.1 УК что за статья')).toEqual(['уголовный'])
    expect(extractCodexCanonicalKeys('ст. 8.1 процессуальный кодекс')).toEqual(['процессуальный'])
    expect(extractCodexCanonicalKeys('pk')).toEqual(['процессуальный'])
  })

  it('returns empty when no codex named', () => {
    expect(extractCodexCanonicalKeys('что в статье 5')).toEqual([])
    expect(extractCodexCanonicalKeys('')).toEqual([])
  })

  it('lists keys in order when multiple texts', () => {
    const prev = '10.3.1 УК что за статья'
    const next = 'Процессуальный кодекс статья 8.1'
    expect(extractCodexCanonicalKeys([prev, next])).toEqual(['уголовный', 'процессуальный'])
    expect(extractCodexCanonicalKeys(next)).toEqual(['процессуальный'])
  })
})

describe('codexHintRootsForCanonicalKeys + filter', () => {
  it('narrows to procedural roots only for PK turn', () => {
    const keys = extractCodexCanonicalKeys('Процессуальный кодекс ст. 8.1')
    const roots = codexHintRootsForCanonicalKeys(keys)
    expect(roots).toContain('процессуальн')
    expect(documentTitleMatchesCodexRoots('Уголовный кодекс Majestic', roots)).toBe(false)
    expect(documentTitleMatchesCodexRoots('Процессуальный кодекс', roots)).toBe(true)
  })
})

describe('extractCodexHintRoots (aggregate)', () => {
  it('union roots from multiple hints', () => {
    const roots = extractCodexHintRoots(['УК 10', 'ПК 8'])
    expect(roots).toContain('уголовн')
    expect(roots).toContain('процессуальн')
  })
})
