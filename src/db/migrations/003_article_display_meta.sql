-- Краткое описание «за что» и наказание для отображения в оверлее / памятке

ALTER TABLE articles ADD COLUMN summary_short TEXT;
ALTER TABLE articles ADD COLUMN penalty_hint TEXT;
ALTER TABLE articles ADD COLUMN display_meta_json TEXT NOT NULL DEFAULT '{}';
