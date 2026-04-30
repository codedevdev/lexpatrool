-- Семантический поиск: эмбеддинги статей хранятся локально, обновляются по запросу пользователя
-- (кнопка «Перестроить семантический индекс» в разделе ИИ). Тригеры на articles ставят dirty-флаг,
-- чтобы при следующем rebuild пересчитать только изменённые статьи.

CREATE TABLE IF NOT EXISTS article_embeddings (
  article_id   TEXT PRIMARY KEY NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  model        TEXT NOT NULL,
  dim          INTEGER NOT NULL,
  vector       BLOB NOT NULL,
  source_hash  TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_article_embeddings_model ON article_embeddings(model);

CREATE TABLE IF NOT EXISTS article_embeddings_dirty (
  article_id TEXT PRIMARY KEY NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  marked_at  TEXT NOT NULL
);

-- При первой миграции считаем все существующие статьи «грязными» — иначе кнопка ребилда
-- увидит пустой dirty-список и пользователь решит, что индекс уже готов.
INSERT OR IGNORE INTO article_embeddings_dirty(article_id, marked_at)
SELECT id, datetime('now') FROM articles;

CREATE TRIGGER IF NOT EXISTS articles_emb_dirty_ai AFTER INSERT ON articles BEGIN
  INSERT OR REPLACE INTO article_embeddings_dirty(article_id, marked_at)
  VALUES (new.id, datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS articles_emb_dirty_au AFTER UPDATE ON articles BEGIN
  INSERT OR REPLACE INTO article_embeddings_dirty(article_id, marked_at)
  VALUES (new.id, datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS articles_emb_dirty_ad AFTER DELETE ON articles BEGIN
  DELETE FROM article_embeddings WHERE article_id = old.id;
  DELETE FROM article_embeddings_dirty WHERE article_id = old.id;
END;
