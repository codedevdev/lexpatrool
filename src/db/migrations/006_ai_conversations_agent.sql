-- Привязка сохранённого диалога к выбранному ИИ-агенту (опционально).
ALTER TABLE ai_conversations ADD COLUMN agent_id TEXT;
