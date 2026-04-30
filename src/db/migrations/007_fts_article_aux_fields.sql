-- Индекс FTS: не только body_clean + heading, но и краткое описание, наказание и ключевые поля display_meta_json (поиск по штрафам, УК и т.д.).
-- После применения пересобирается articles_fts из текущих статей.

DROP TRIGGER IF EXISTS articles_ai;
DROP TRIGGER IF EXISTS articles_au;
DROP TRIGGER IF EXISTS articles_ad;

DELETE FROM articles_fts;

INSERT INTO articles_fts(article_id, document_id, title, body)
SELECT
  a.id,
  a.document_id,
  a.heading,
  TRIM(
    COALESCE(a.body_clean, '') || ' ' ||
    COALESCE(a.summary_short, '') || ' ' ||
    COALESCE(a.penalty_hint, '') || ' ' ||
    COALESCE(json_extract(a.display_meta_json, '$.bailHint'), '') || ' ' ||
    COALESCE(json_extract(a.display_meta_json, '$.ukArticle'), '') || ' ' ||
    COALESCE(json_extract(a.display_meta_json, '$.jurisdiction'), '') || ' ' ||
    COALESCE(CAST(json_extract(a.display_meta_json, '$.stars') AS TEXT), '') || ' ' ||
    COALESCE(CAST(json_extract(a.display_meta_json, '$.fineUsd') AS TEXT), '') || ' ' ||
    COALESCE(CAST(json_extract(a.display_meta_json, '$.fineRub') AS TEXT), '')
  )
FROM articles a;

CREATE TRIGGER articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(article_id, document_id, title, body)
  VALUES (
    new.id,
    new.document_id,
    new.heading,
    TRIM(
      COALESCE(new.body_clean, '') || ' ' ||
      COALESCE(new.summary_short, '') || ' ' ||
      COALESCE(new.penalty_hint, '') || ' ' ||
      COALESCE(json_extract(new.display_meta_json, '$.bailHint'), '') || ' ' ||
      COALESCE(json_extract(new.display_meta_json, '$.ukArticle'), '') || ' ' ||
      COALESCE(json_extract(new.display_meta_json, '$.jurisdiction'), '') || ' ' ||
      COALESCE(CAST(json_extract(new.display_meta_json, '$.stars') AS TEXT), '') || ' ' ||
      COALESCE(CAST(json_extract(new.display_meta_json, '$.fineUsd') AS TEXT), '') || ' ' ||
      COALESCE(CAST(json_extract(new.display_meta_json, '$.fineRub') AS TEXT), '')
    )
  );
END;

CREATE TRIGGER articles_au AFTER UPDATE ON articles BEGIN
  DELETE FROM articles_fts WHERE article_id = old.id;
  INSERT INTO articles_fts(article_id, document_id, title, body)
  VALUES (
    new.id,
    new.document_id,
    new.heading,
    TRIM(
      COALESCE(new.body_clean, '') || ' ' ||
      COALESCE(new.summary_short, '') || ' ' ||
      COALESCE(new.penalty_hint, '') || ' ' ||
      COALESCE(json_extract(new.display_meta_json, '$.bailHint'), '') || ' ' ||
      COALESCE(json_extract(new.display_meta_json, '$.ukArticle'), '') || ' ' ||
      COALESCE(json_extract(new.display_meta_json, '$.jurisdiction'), '') || ' ' ||
      COALESCE(CAST(json_extract(new.display_meta_json, '$.stars') AS TEXT), '') || ' ' ||
      COALESCE(CAST(json_extract(new.display_meta_json, '$.fineUsd') AS TEXT), '') || ' ' ||
      COALESCE(CAST(json_extract(new.display_meta_json, '$.fineRub') AS TEXT), '')
    )
  );
END;

CREATE TRIGGER articles_ad AFTER DELETE ON articles BEGIN
  DELETE FROM articles_fts WHERE article_id = old.id;
END;
