-- LexPatrol — SQLite schema (FTS5 + normalized legal content)

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  source_type TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  refreshed_at TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  code_family TEXT,
  revision TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  raw_html TEXT,
  raw_text TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT REFERENCES sources(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw_html TEXT,
  raw_text TEXT,
  normalized_json TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  parent_section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
  parent_article_id TEXT REFERENCES articles(id) ON DELETE CASCADE,
  article_number TEXT,
  heading TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  body_clean TEXT NOT NULL DEFAULT '',
  body_raw TEXT,
  path_json TEXT NOT NULL DEFAULT '[]',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS clauses (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  label TEXT,
  body TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS document_tags (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(article_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT REFERENCES articles(id) ON DELETE CASCADE,
  scenario_key TEXT,
  title TEXT,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retrieval_chunks (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  article_id TEXT REFERENCES articles(id) ON DELETE CASCADE,
  chunk_text TEXT NOT NULL,
  chunk_meta_json TEXT NOT NULL DEFAULT '{}',
  embedding_provider TEXT,
  embedding_blob BLOB
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  provider TEXT,
  model TEXT
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS overlay_pins (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(article_id)
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_id);
CREATE INDEX IF NOT EXISTS idx_articles_document ON articles(document_id);
CREATE INDEX IF NOT EXISTS idx_notes_article ON notes(article_id);

-- Standalone FTS (explicit article_id for stable joins with TEXT PKs)
CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  article_id UNINDEXED,
  document_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 1'
);

CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(article_id, document_id, title, body)
  VALUES (new.id, new.document_id, new.heading, new.body_clean);
END;

CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
  DELETE FROM articles_fts WHERE article_id = old.id;
  INSERT INTO articles_fts(article_id, document_id, title, body)
  VALUES (new.id, new.document_id, new.heading, new.body_clean);
END;

CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  DELETE FROM articles_fts WHERE article_id = old.id;
END;
