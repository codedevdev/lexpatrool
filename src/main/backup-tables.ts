/**
 * Порядок таблиц в JSON-резервной копии (родительские раньше дочерних — удобно при ручном разборе).
 * При полном импорте порядок вставки тот же; очистка при foreign_keys=OFF — в любом порядке.
 */
export const LEX_BACKUP_TABLE_ORDER = [
  'categories',
  'sources',
  'documents',
  'sections',
  'articles',
  'clauses',
  'tags',
  'document_tags',
  'article_tag_assignments',
  'bookmarks',
  'notes',
  'retrieval_chunks',
  'ai_conversations',
  'ai_messages',
  'app_settings',
  'overlay_pins',
  'import_jobs',
  'ai_agents',
  'article_collections',
  'article_collection_items',
  'article_see_also',
  'cheat_sheets',
  'reader_recents'
] as const

export type LexBackupTableName = (typeof LEX_BACKUP_TABLE_ORDER)[number]
