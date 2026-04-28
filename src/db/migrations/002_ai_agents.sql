-- Custom user-defined AI agents (personas) — optional overrides merged with base provider config.

CREATE TABLE IF NOT EXISTS ai_agents (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  system_prompt_extra TEXT NOT NULL DEFAULT '',
  temperature REAL,
  max_tokens INTEGER,
  model TEXT,
  provider TEXT,
  base_url TEXT,
  api_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_sort ON ai_agents(sort_order ASC, name ASC);
