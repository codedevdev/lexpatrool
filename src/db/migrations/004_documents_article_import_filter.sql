-- Режим импорта статей (все / с санкциями / только справочные) — для подписей в читателе и оверлее
ALTER TABLE documents ADD COLUMN article_import_filter TEXT;
