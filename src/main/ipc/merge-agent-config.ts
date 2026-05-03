import type { Database } from 'better-sqlite3'
import type { AiProviderConfig } from '../../shared/types'

/** Доп. системный промпт агента из БД (без изменения базовой конфигурации провайдера). */
export function mergeAgentConfig(
  db: Database,
  base: AiProviderConfig,
  agentId?: string | null
): { cfg: AiProviderConfig; extra: string } {
  if (!agentId) return { cfg: base, extra: '' }
  const row = db
    .prepare('SELECT system_prompt_extra FROM ai_agents WHERE id = ?')
    .get(agentId) as { system_prompt_extra: string } | undefined
  if (!row) return { cfg: base, extra: '' }
  return { cfg: base, extra: row.system_prompt_extra ?? '' }
}
