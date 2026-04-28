import { useEffect, useState } from 'react'
import type { AiProviderConfig, AiAgentRecord, AiCompletePayload } from '@shared/types'

const SETTINGS_KEY = 'ai_provider_config'

const defaultCfg: AiProviderConfig = {
  provider: 'openai_compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.2,
  maxTokens: 1200,
  allowBroaderContext: false
}

const emptyAgentForm: Partial<AiAgentRecord> = {
  name: '',
  description: '',
  system_prompt_extra: '',
  temperature: null,
  max_tokens: null,
  model: null,
  provider: null,
  base_url: null,
  api_key: null
}

export function AiPage(): JSX.Element {
  const [cfg, setCfg] = useState<AiProviderConfig>(defaultCfg)
  const [agents, setAgents] = useState<AiAgentRecord[]>([])
  const [agentId, setAgentId] = useState<string>('')
  const [form, setForm] = useState<Partial<AiAgentRecord>>(emptyAgentForm)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [q, setQ] = useState('Какие статьи уместно проверить при задержании по демо-документу?')
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)

  useEffect(() => {
    void window.lawHelper.settings.get(SETTINGS_KEY).then((raw) => {
      if (!raw) return
      try {
        setCfg({ ...defaultCfg, ...(JSON.parse(raw) as AiProviderConfig) })
      } catch {
        /* ignore */
      }
    })
    void reloadAgents()
  }, [])

  async function reloadAgents(): Promise<void> {
    const list = await window.lawHelper.aiAgents.list()
    setAgents(list)
  }

  async function saveCfg(): Promise<void> {
    await window.lawHelper.settings.set(SETTINGS_KEY, JSON.stringify(cfg))
  }

  async function ask(): Promise<void> {
    setBusy(true)
    setWarn(null)
    setOut('')
    try {
      const needsKey = cfg.provider !== 'ollama'
      const agent = agents.find((a) => a.id === agentId)
      const keyFromAgent = agent?.api_key?.trim()
      const keyFromCfg = cfg.apiKey?.trim()
      if (needsKey && !keyFromCfg && !keyFromAgent) {
        setWarn('Укажите API ключ в базовом провайдере или в выбранном агенте.')
        return
      }
      const payload: AiCompletePayload = {
        cfg,
        question: q,
        agentId: agentId || null
      }
      const res = await window.lawHelper.ai.complete(payload)
      setOut(res.text)
    } catch (e) {
      setWarn(e instanceof Error ? e.message : 'Ошибка запроса')
    } finally {
      setBusy(false)
    }
  }

  async function saveAgent(): Promise<void> {
    if (!form.name?.trim()) return
    await window.lawHelper.aiAgents.save({
      ...form,
      id: editingId ?? undefined,
      name: form.name.trim()
    } as Partial<AiAgentRecord> & { name: string })
    setForm(emptyAgentForm)
    setEditingId(null)
    await reloadAgents()
  }

  async function deleteAgent(id: string): Promise<void> {
    await window.lawHelper.aiAgents.delete(id)
    if (agentId === id) setAgentId('')
    await reloadAgents()
  }

  function startEdit(a: AiAgentRecord): void {
    setEditingId(a.id)
    setForm({ ...a })
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">ИИ-ассистент</h1>
        <p className="mt-2 text-sm text-app-muted max-w-3xl">
          Базовый провайдер задаёт ключ по умолчанию. <strong className="text-app">Свои агенты</strong> задают роль
          (например, сотрудник LSPD в Los Santos) и доп. инструкции; при необходимости переопределяют модель/URL/ключ.
          Ответы только по импортированной базе (FTS). ИИ может ошибаться — сверяйтесь с оригиналом.
        </p>
      </header>

      <section className="glass space-y-4 rounded-2xl p-6">
        <h2 className="text-sm font-medium text-white">Базовый провайдер</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1 text-xs text-app-muted">
            Тип
            <select
              className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white"
              value={cfg.provider}
              onChange={(e) => setCfg({ ...cfg, provider: e.target.value as AiProviderConfig['provider'] })}
            >
              <option value="openai">OpenAI</option>
              <option value="openai_compatible">OpenAI-compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
              <option value="ollama">Ollama (локально)</option>
            </select>
          </label>
          <label className="block space-y-1 text-xs text-app-muted">
            Base URL (для compatible / Ollama)
            <input
              className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white"
              value={cfg.baseUrl ?? ''}
              onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
            />
          </label>
          <label className="block space-y-1 text-xs text-app-muted">
            API ключ по умолчанию
            <input
              type="password"
              className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white"
              value={cfg.apiKey ?? ''}
              onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
              placeholder="sk-…"
            />
          </label>
          <label className="block space-y-1 text-xs text-app-muted">
            Модель по умолчанию
            <input
              className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white"
              value={cfg.model}
              onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-app-muted">
          <input
            type="checkbox"
            checked={Boolean(cfg.allowBroaderContext)}
            onChange={(e) => setCfg({ ...cfg, allowBroaderContext: e.target.checked })}
          />
          Разрешить общие пояснения вне импортированного текста
        </label>
        <button
          type="button"
          onClick={() => void saveCfg()}
          className="rounded-lg border border-white/10 bg-surface-raised px-4 py-2 text-sm text-white hover:bg-surface-hover"
        >
          Сохранить базовый провайдер
        </button>
      </section>

      <section className="glass space-y-4 rounded-2xl p-6">
        <h2 className="text-sm font-medium text-white">Мои ИИ-агенты</h2>
        <p className="text-xs text-app-muted">
          Пример: «LSPD patrol» — отвечать кратко, ссылаться только на статьи из базы, не выдумывать нормы. Поля
          модели/ключа не обязательны — наследуются от базового провайдера.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1 text-xs text-app-muted md:col-span-2">
            Название
            <input
              className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white"
              value={form.name ?? ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="LSPD — патруль (Los Santos)"
            />
          </label>
          <label className="block space-y-1 text-xs text-app-muted md:col-span-2">
            Описание
            <input
              className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white"
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <label className="block space-y-1 text-xs text-app-muted md:col-span-2">
            Доп. system prompt (роль)
            <textarea
              className="min-h-[100px] w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white"
              value={form.system_prompt_extra ?? ''}
              onChange={(e) => setForm({ ...form, system_prompt_extra: e.target.value })}
              placeholder="Ты помогаешь сотруднику полиции LSPD в GTA5RP: отвечай по импортированным уставам…"
            />
          </label>
          <label className="block space-y-1 text-xs text-app-muted">
            Температура (пусто = из базы)
            <input
              className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white"
              value={form.temperature ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  temperature: e.target.value === '' ? null : Number(e.target.value)
                })
              }
              placeholder="0.2"
            />
          </label>
          <label className="block space-y-1 text-xs text-app-muted">
            Модель (опционально)
            <input
              className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white"
              value={form.model ?? ''}
              onChange={(e) => setForm({ ...form, model: e.target.value || null })}
            />
          </label>
          <label className="block space-y-1 text-xs text-app-muted md:col-span-2">
            Свой API ключ (опционально, хранится локально в SQLite)
            <input
              type="password"
              className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white"
              value={form.api_key ?? ''}
              onChange={(e) => setForm({ ...form, api_key: e.target.value || null })}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void saveAgent()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim"
          >
            {editingId ? 'Обновить агента' : 'Добавить агента'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null)
                setForm(emptyAgentForm)
              }}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-app-muted"
            >
              Отмена
            </button>
          )}
        </div>
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div>
                <div className="text-white">{a.name}</div>
                {a.description && <div className="text-xs text-app-muted">{a.description}</div>}
              </div>
              <div className="flex gap-2">
                <button type="button" className="text-accent hover:underline" onClick={() => startEdit(a)}>
                  Изменить
                </button>
                <button
                  type="button"
                  className="text-red-300 hover:underline"
                  onClick={() => void deleteAgent(a.id)}
                >
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="glass space-y-4 rounded-2xl p-6">
        <h2 className="text-sm font-medium text-white">Вопрос</h2>
        <label className="block space-y-1 text-xs text-app-muted">
          Агент (необязательно)
          <select
            className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="">— только базовый промпт —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <textarea
          className="min-h-[120px] w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void ask()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40"
        >
          {busy ? 'Запрос…' : 'Спросить'}
        </button>
        {warn && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{warn}</div>}
        {out && (
          <div className="rounded-lg border border-white/10 bg-surface-raised/80 p-4 text-sm text-app whitespace-pre-wrap">
            {out}
          </div>
        )}
      </section>
    </div>
  )
}
