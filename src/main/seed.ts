import type { Database } from 'better-sqlite3'
import { v4 as uuid } from 'uuid'

const SEEDED_KEY = 'seeded_demo'

/** Sample seed for demo / first-run UX — not legal advice; placeholder text only. */
export function seedIfEmpty(db: Database): void {
  const count = db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number }
  if (count.c > 0) return

  /** Уже помечали сид — иначе при пустых документах повторный запуск дублирует данные и падает на UNIQUE(key). */
  const already = db.prepare(`SELECT 1 AS x FROM app_settings WHERE key = ? LIMIT 1`).get(SEEDED_KEY) as
    | { x: number }
    | undefined
  if (already) return

  const now = new Date().toISOString()
  const catId = uuid()
  db.prepare(
    `INSERT INTO categories (id, name, parent_id, color, sort_order) VALUES (?, ?, NULL, ?, 0)`
  ).run(catId, 'Кодексы и правила', '#5b8cff')

  const sourceId = uuid()
  db.prepare(
    `INSERT INTO sources (id, title, url, source_type, imported_at, tags_json, category_id, code_family, metadata_json)
     VALUES (?, ?, NULL, 'paste_text', ?, '[]', ?, 'internal_rules', '{}')`
  ).run(sourceId, 'Пример: внутренний регламент (демо)', now, catId)

  const docId = uuid()
  db.prepare(
    `INSERT INTO documents (id, source_id, title, slug, created_at, updated_at, category_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(docId, sourceId, 'Демо-документ: общие положения', 'demo-general', now, now, catId)

  const body = `Статья 1.1. Назначение\nДокумент создан для демонстрации поиска, оверлея и ИИ-контекста в приложении.\n\nСтатья 1.2. Использование\nИспользуйте только импортированные материалы и проверяйте первоисточник на форуме.\n\nСтатья 1.3. Ограничения\nПриложение не взаимодействует с игрой и не обходит защиту сайтов.`

  const a1 = uuid()
  const a2 = uuid()
  const a3 = uuid()

  db.prepare(
    `INSERT INTO articles (id, document_id, article_number, heading, level, sort_order, body_clean, path_json)
     VALUES (?, ?, ?, ?, 1, 1, ?, '["Демо"]')`
  ).run(a1, docId, '1.1', 'Статья 1.1. Назначение', 'Документ создан для демонстрации поиска, оверлея и ИИ-контекста в приложении.')

  db.prepare(
    `INSERT INTO articles (id, document_id, article_number, heading, level, sort_order, body_clean, path_json)
     VALUES (?, ?, ?, ?, 1, 2, ?, '["Демо"]')`
  ).run(a2, docId, '1.2', 'Статья 1.2. Использование', 'Используйте только импортированные материалы и проверяйте первоисточник на форуме.')

  db.prepare(
    `INSERT INTO articles (id, document_id, article_number, heading, level, sort_order, body_clean, path_json)
     VALUES (?, ?, ?, ?, 1, 3, ?, '["Демо"]')`
  ).run(a3, docId, '1.3', 'Статья 1.3. Ограничения', 'Приложение не взаимодействует с игрой и не обходит защиту сайтов.')

  const catGov = uuid()
  db.prepare(
    `INSERT INTO categories (id, name, parent_id, color, sort_order) VALUES (?, ?, NULL, ?, 1)`
  ).run(catGov, 'Гос. организации (LSPD / EMS и др.)', '#3ecf8e')

  const govSource = uuid()
  db.prepare(
    `INSERT INTO sources (id, title, url, source_type, imported_at, tags_json, category_id, code_family, metadata_json)
     VALUES (?, ?, NULL, 'paste_text', ?, ?, ?, 'gov_reference', '{}')`
  ).run(govSource, 'Шпаргалка: гос. органы (пример)', now, JSON.stringify(['lspd', 'government', 'gta5rp']), catGov)

  const govDoc = uuid()
  db.prepare(
    `INSERT INTO documents (id, source_id, title, slug, created_at, updated_at, category_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(govDoc, govSource, 'Госорганы: типовые напоминания (пример)', 'gov-cheatsheet', now, now, catGov)

  const govSplits = [
    {
      n: '1',
      h: 'Статья 1. Общие принципы',
      b: 'Действуйте по импортированным кодексам и уставам вашего GTA5RP сервера (LSPD, LSSD, EMS и т.д.). Перед мерой проверьте статью в читателе.'
    },
    { n: '2', h: 'Статья 2. Документирование', b: 'Фиксируйте обстоятельства согласно регламенту сервера, если он импортирован в базу.' },
    {
      n: '3',
      h: 'Статья 3. Санкции',
      b: 'Штраф или иная мера — только при наличии оснований в импортированном тексте. При сомнениях уточните у старшего состава в RP.'
    }
  ]
  govSplits.forEach((s, i) => {
    const aid = uuid()
    db.prepare(
      `INSERT INTO articles (id, document_id, article_number, heading, level, sort_order, body_clean, path_json)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(aid, govDoc, s.n, s.h, i + 1, s.b, JSON.stringify(['Гос. органы', s.h]))
  })

  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO NOTHING`
  ).run(SEEDED_KEY)
}
