import { v4 as uuid } from 'uuid'
import { describe, expect, it } from 'vitest'
import type { AiProviderConfig } from '../../shared/types'
import { createTestDatabase } from '../../test-utils/memory-db'
import { mergeAgentConfig } from './merge-agent-config'

const baseCfg = (): AiProviderConfig => ({
  provider: 'ollama',
  model: 'm',
  temperature: 0,
  maxTokens: 100
})

describe('mergeAgentConfig', () => {
  it('без agentId возвращает ту же cfg и пустой extra', () => {
    const db = createTestDatabase()
    try {
      const base = baseCfg()
      const r = mergeAgentConfig(db, base, null)
      expect(r.cfg).toBe(base)
      expect(r.extra).toBe('')
    } finally {
      db.close()
    }
  })

  it('подмешивает system_prompt_extra когда агент есть в БД', () => {
    const db = createTestDatabase()
    try {
      const id = uuid()
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO ai_agents (id, name, description, system_prompt_extra, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 0, ?, ?)`
      ).run(id, 'Agent', 'Доп. инструкции', now, now)

      const r = mergeAgentConfig(db, baseCfg(), id)
      expect(r.extra).toBe('Доп. инструкции')
      expect(r.cfg.provider).toBe('ollama')
    } finally {
      db.close()
    }
  })

  it('возвращает пустой extra если id агента не найден', () => {
    const db = createTestDatabase()
    try {
      const r = mergeAgentConfig(db, baseCfg(), 'missing-id')
      expect(r.extra).toBe('')
    } finally {
      db.close()
    }
  })
})
