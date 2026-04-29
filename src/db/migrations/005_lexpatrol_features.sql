-- Сменные подборки, теги на статьях, «см. также», снимок текста до обновления, недавние, шпаргалки

CREATE TABLE IF NOT EXISTS article_collections (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS article_collection_items (
  collection_id TEXT NOT NULL REFERENCES article_collections(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON article_collection_items(collection_id, sort_order);

CREATE TABLE IF NOT EXISTS article_tag_assignments (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_article_tag_assignments_tag ON article_tag_assignments(tag_id);

CREATE TABLE IF NOT EXISTS article_see_also (
  id TEXT PRIMARY KEY NOT NULL,
  from_article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  to_article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (from_article_id, to_article_id),
  CHECK (from_article_id <> to_article_id)
);

CREATE INDEX IF NOT EXISTS idx_article_see_also_from ON article_see_also(from_article_id, sort_order);

ALTER TABLE articles ADD COLUMN previous_body_clean TEXT;
ALTER TABLE articles ADD COLUMN previous_captured_at TEXT;

CREATE TABLE IF NOT EXISTS cheat_sheets (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reader_recents (
  article_id TEXT PRIMARY KEY NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  opened_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reader_recents_opened ON reader_recents(opened_at);
