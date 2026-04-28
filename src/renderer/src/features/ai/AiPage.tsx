import { useCallback, useEffect, useState } from 'react'
import type { AiProviderConfig, AiAgentRecord, AiCompletePayload } from '@shared/types'

const SETTINGS_KEY = 'ai_provider_config'
/** После прохождения мастера или миграции со старой версии — показываем «хаб», а не мастер. */
const WIZARD_DONE_KEY = 'ai_wizard_completed'

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

type AiProv = AiProviderConfig['provider']

/** Только для этих типов в запросе реально используется поле Base URL. */
function usesConfigurableBaseUrl(p: AiProv): boolean {
  return p === 'openai_compatible' || p === 'ollama'
}

/** Подстановка по умолчанию при выборе типа сервиса (можно отредактировать). */
function recommendedBaseUrl(p: AiProv): string {
  switch (p) {
    case 'openai_compatible':
      return 'https://api.openai.com/v1'
    case 'ollama':
      return 'http://127.0.0.1:11434'
    default:
      return ''
  }
}

function BaseUrlHint({ provider }: { provider: 'openai_compatible' | 'ollama' }): JSX.Element {
  if (provider === 'openai_compatible') {
    return (
      <Hint>
        Укажите <strong className="font-medium text-app">корень</strong> OpenAI-совместимого API — путь обычно заканчивается на{' '}
        <code className="rounded bg-white/10 px-1 py-px text-[11px]">/v1</code>. LexPatrol сам добавит{' '}
        <code className="rounded bg-white/10 px-1 py-px text-[11px]">/chat/completions</code>. Примеры: OpenAI{' '}
        <code className="rounded bg-white/10 px-1 py-px text-[11px]">https://api.openai.com/v1</code>, Groq{' '}
        <code className="rounded bg-white/10 px-1 py-px text-[11px]">https://api.groq.com/openai/v1</code>, LM Studio на этом ПК — часто{' '}
        <code className="rounded bg-white/10 px-1 py-px text-[11px]">http://127.0.0.1:1234/v1</code>.
      </Hint>
    )
  }
  return (
    <Hint>
      Здесь только <strong className="font-medium text-app">хост и порт</strong> сервера Ollama,{' '}
      <strong className="font-medium text-app">без</strong>{' '}
      <code className="rounded bg-white/10 px-1 py-px text-[11px]">/v1</code> — запрос уходит на{' '}
      <code className="rounded bg-white/10 px-1 py-px text-[11px]">/api/chat</code>. На этом компьютере обычно{' '}
      <code className="rounded bg-white/10 px-1 py-px text-[11px]">http://127.0.0.1:11434</code>.
    </Hint>
  )
}

function FixedBaseUrlNotice({ provider }: { provider: AiProv }): JSX.Element {
  if (provider === 'openai') {
    return (
      <p className="mt-2 text-[11px] leading-relaxed text-app-muted/95">
        Используется официальный адрес OpenAI —{' '}
        <code className="rounded bg-white/10 px-1 py-px text-[11px]">api.openai.com/v1/chat/completions</code>. Поле Base URL не
        нужно: достаточно API-ключа и имени модели.
      </p>
    )
  }
  if (provider === 'anthropic') {
    return (
      <p className="mt-2 text-[11px] leading-relaxed text-app-muted/95">
        Запросы идут на{' '}
        <code className="rounded bg-white/10 px-1 py-px text-[11px]">api.anthropic.com</code> — этот адрес задан в программе и не
        меняется здесь.
      </p>
    )
  }
  if (provider === 'gemini') {
    return (
      <p className="mt-2 text-[11px] leading-relaxed text-app-muted/95">
        Google Gemini: ключ подставляется в запрос, URL сервиса задаёт приложение. Отдельный Base URL не используется.
      </p>
    )
  }
  return <p className="mt-2 text-[11px] text-app-muted/90">—</p>
}

const PROVIDER_OPTIONS: { id: AiProv; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'openai_compatible', label: 'OpenAI-compatible' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'ollama', label: 'Ollama (локально)' }
]

type AiTabId = 'provider' | 'agents' | 'ask'

const TABS: { id: AiTabId; label: string; hint: string }[] = [
  { id: 'provider', label: 'Провайдер', hint: 'ключ, модель, температура' },
  { id: 'agents', label: 'Агенты', hint: 'роли и инструкции' },
  { id: 'ask', label: 'Вопрос', hint: 'пробный запрос' }
]

function Hint({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="mt-1 text-[11px] leading-relaxed text-app-muted/95">{children}</p>
}

function TabPanel({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-app-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function AiHowItWorksGuide(): JSX.Element {
  return (
    <details className="rounded-xl border border-white/[0.08] bg-white/[0.03] open:bg-white/[0.05]">
      <summary className="cursor-pointer list-none px-4 py-3 font-medium text-white [&::-webkit-details-marker]:hidden">
        <span className="flex items-start justify-between gap-3">
          <span>
            Как это работает{' '}
            <span className="mt-0.5 block text-xs font-normal text-app-muted">
              от импорта до ответа — прочитай раз, дальше будет проще
            </span>
          </span>
          <span className="shrink-0 pt-0.5 text-app-muted">▼</span>
        </span>
      </summary>
      <div className="space-y-5 border-t border-white/[0.06] px-4 pb-4 pt-4 text-sm leading-relaxed text-app-muted">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-app">1. Откуда берутся «законы» в ответах</h3>
          <p>
            Только из того, что <strong className="text-app">вы сами загрузили</strong> в LexPatrol через «Импорт» /
            браузер. Тексты хранятся в базе на вашем компьютере (SQLite).
          </p>
          <p>
            Программа <strong className="text-app">не ходит в интернет за текстами статей</strong>, когда вы задаёте
            вопрос ИИ.
          </p>
        </section>
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-app">2. Что делает «Отправить вопрос»</h3>
          <ol className="list-decimal space-y-2 pl-5 marker:text-accent">
            <li>Ваш вопрос ищет подходящие статьи в локальной базе.</li>
            <li>Фрагменты попадают в контекст для нейросети.</li>
            <li>Провайдер генерирует ответ только из этого контекста и правил.</li>
          </ol>
        </section>
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-app">3. Вкладки настройки</h3>
          <ul className="list-disc space-y-2 pl-5 marker:text-white/40">
            <li>
              <strong className="text-app">Провайдер</strong> — API, ключ, модель.
            </li>
            <li>
              <strong className="text-app">Агенты</strong> — роль и стиль ответа.
            </li>
            <li>
              <strong className="text-app">Вопрос</strong> — пробный запрос.
            </li>
          </ul>
        </section>
        <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-app-muted">
          Итог: ИИ — <strong className="text-app">пересказ импортированных материалов</strong>, не замена юристу.
        </p>
      </div>
    </details>
  )
}

function maskKey(k: string): string {
  const t = k.trim()
  if (t.length <= 8) return t ? '••••••••' : '—'
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

/** Поля провайдера: короткая версия для мастера или полная для вкладки. */
function ProviderFields({
  cfg,
  setCfg,
  mode
}: {
  cfg: AiProviderConfig
  setCfg: React.Dispatch<React.SetStateAction<AiProviderConfig>>
  mode: 'wizard' | 'full'
}): JSX.Element {
  const needsKey = cfg.provider !== 'ollama'
  const configurable = usesConfigurableBaseUrl(cfg.provider)

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="text-xs font-medium text-app-muted">Тип сервиса</span>
        <select
          className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
          value={cfg.provider}
          onChange={(e) => {
            const next = e.target.value as AiProv
            setCfg((prev) => ({
              ...prev,
              provider: next,
              ...(usesConfigurableBaseUrl(next) ? { baseUrl: recommendedBaseUrl(next) } : { baseUrl: undefined })
            }))
          }}
        >
          {PROVIDER_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {mode === 'wizard' && <Hint>Куда у вас есть доступ. Для своей модели на ПК часто Ollama.</Hint>}
      </label>

      {configurable ? (
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-app-muted">Base URL</span>
          <input
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
            value={cfg.baseUrl ?? ''}
            onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
            placeholder={cfg.provider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1'}
          />
          <BaseUrlHint provider={cfg.provider === 'ollama' ? 'ollama' : 'openai_compatible'} />
        </label>
      ) : (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 sm:col-span-2">
          <p className="text-xs font-medium text-app-muted">Адрес API</p>
          <FixedBaseUrlNotice provider={cfg.provider} />
        </div>
      )}

      {needsKey && (
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-app-muted">API ключ</span>
          <input
            type="password"
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
            value={cfg.apiKey ?? ''}
            onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
            placeholder="sk-…"
          />
          <Hint>Хранится только у вас на диске.</Hint>
        </label>
      )}

      <label className="block sm:col-span-2">
        <span className="text-xs font-medium text-app-muted">Модель</span>
        <input
          className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white sm:max-w-md"
          value={cfg.model}
          onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
          placeholder="gpt-4o-mini"
        />
      </label>

      {mode === 'full' && (
        <>
          <label className="block">
            <span className="text-xs font-medium text-app-muted">Температура</span>
            <input
              type="number"
              step={0.1}
              min={0}
              max={2}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
              value={cfg.temperature}
              onChange={(e) => setCfg({ ...cfg, temperature: Number(e.target.value) })}
            />
            <Hint>
              Ниже — строже (0.2–0.4 для справок). Выше — свободнее, больше риск выдумок.
            </Hint>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-app-muted">Макс. токенов ответа</span>
            <input
              type="number"
              min={256}
              max={32000}
              step={64}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
              value={cfg.maxTokens}
              onChange={(e) => setCfg({ ...cfg, maxTokens: Number(e.target.value) })}
            />
            <Hint>Лимит длины ответа.</Hint>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 sm:col-span-2">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-white/20 bg-surface-raised text-accent focus:ring-accent"
              checked={Boolean(cfg.allowBroaderContext)}
              onChange={(e) => setCfg({ ...cfg, allowBroaderContext: e.target.checked })}
            />
            <span className="text-sm text-app-muted">
              <span className="font-medium text-white">Общие пояснения помимо цитат из базы</span>
            </span>
          </label>
        </>
      )}
    </div>
  )
}

type WizardStep = 0 | 1 | 2 | 3

const WIZARD_STEP_LABELS = ['Начало', 'Провайдер', 'Агент', 'Готово']

function WizardProgress({ step }: { step: WizardStep }): JSX.Element {
  return (
    <div className="mb-6 flex items-center justify-between gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${
              i <= step ? 'bg-accent text-white' : 'bg-white/10 text-app-muted'
            }`}
          >
            {i + 1}
          </div>
          <span className="hidden text-[10px] text-app-muted sm:block">{WIZARD_STEP_LABELS[i]}</span>
        </div>
      ))}
    </div>
  )
}

export function AiPage(): JSX.Element {
  const [bootstrapped, setBootstrapped] = useState(false)
  const [wizardDone, setWizardDone] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [wizardStep, setWizardStep] = useState<WizardStep>(0)
  const [wizardAgentName, setWizardAgentName] = useState('')
  const [wizardAgentPrompt, setWizardAgentPrompt] = useState('')

  const [activeTab, setActiveTab] = useState<AiTabId>('provider')
  const [cfg, setCfg] = useState<AiProviderConfig>(defaultCfg)
  const [agents, setAgents] = useState<AiAgentRecord[]>([])
  const [agentId, setAgentId] = useState<string>('')
  const [form, setForm] = useState<Partial<AiAgentRecord>>(emptyAgentForm)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [q, setQ] = useState('Какие статьи уместно проверить при задержании по демо-документу?')
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)
  const [saveToast, setSaveToast] = useState<string | null>(null)

  /** У агента свой провайдер или общий — от этого зависят подсказки к Base URL. */
  const effectiveAgentProv = (form.provider ?? cfg.provider) as AiProv
  const agentUsesConfigurableBase = usesConfigurableBaseUrl(effectiveAgentProv)

  const reloadAgents = useCallback(async (): Promise<void> => {
    const list = await window.lawHelper.aiAgents.list()
    setAgents(list)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [raw, doneFlag] = await Promise.all([
        window.lawHelper.settings.get(SETTINGS_KEY),
        window.lawHelper.settings.get(WIZARD_DONE_KEY)
      ])
      let nextCfg = defaultCfg
      if (raw) {
        try {
          nextCfg = { ...defaultCfg, ...(JSON.parse(raw) as AiProviderConfig) }
        } catch {
          /* ignore */
        }
      }
      let done = doneFlag === '1'
      const hasKey = (nextCfg.apiKey?.trim()?.length ?? 0) > 0
      const ollamaReady = nextCfg.provider === 'ollama'
      if (!done && (hasKey || ollamaReady)) {
        done = true
        await window.lawHelper.settings.set(WIZARD_DONE_KEY, '1')
      }
      if (cancelled) return
      setCfg(nextCfg)
      setWizardDone(done)
      setBootstrapped(true)
      await reloadAgents()
    })()
    return () => {
      cancelled = true
    }
  }, [reloadAgents])

  async function saveCfg(): Promise<void> {
    await window.lawHelper.settings.set(SETTINGS_KEY, JSON.stringify(cfg))
    setSaveToast('Сохранено')
    window.setTimeout(() => setSaveToast(null), 2500)
  }

  async function finishWizard(): Promise<void> {
    await window.lawHelper.settings.set(SETTINGS_KEY, JSON.stringify(cfg))
    if (wizardAgentName.trim()) {
      await window.lawHelper.aiAgents.save({
        name: wizardAgentName.trim(),
        description: null,
        system_prompt_extra: wizardAgentPrompt.trim(),
        temperature: null,
        max_tokens: null,
        model: null,
        provider: null,
        base_url: null,
        api_key: null
      } as Partial<AiAgentRecord> & { name: string })
    }
    await window.lawHelper.settings.set(WIZARD_DONE_KEY, '1')
    setWizardDone(true)
    setShowAdvanced(false)
    setWizardStep(0)
    setWizardAgentName('')
    setWizardAgentPrompt('')
    await reloadAgents()
    setSaveToast('Настройки ИИ сохранены')
    window.setTimeout(() => setSaveToast(null), 3000)
  }

  async function resetWizard(): Promise<void> {
    await window.lawHelper.settings.set(WIZARD_DONE_KEY, '0')
    setWizardDone(false)
    setWizardStep(0)
    setWizardAgentName('')
    setWizardAgentPrompt('')
  }

  async function skipWizard(): Promise<void> {
    await window.lawHelper.settings.set(WIZARD_DONE_KEY, '1')
    setWizardDone(true)
    setShowAdvanced(false)
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
    const effProv = (form.provider ?? cfg.provider) as AiProv
    await window.lawHelper.aiAgents.save({
      ...form,
      id: editingId ?? undefined,
      name: form.name.trim(),
      provider: form.provider?.trim() ? form.provider : null,
      base_url:
        usesConfigurableBaseUrl(effProv) && form.base_url?.trim() ? form.base_url.trim() : null,
      api_key: form.api_key?.trim() ? form.api_key : null
    } as Partial<AiAgentRecord> & { name: string })
    setForm(emptyAgentForm)
    setEditingId(null)
    await reloadAgents()
    setSaveToast('Агент сохранён')
    window.setTimeout(() => setSaveToast(null), 2500)
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

  const providerLabel: Record<AiProviderConfig['provider'], string> = {
    openai: 'OpenAI',
    openai_compatible: 'OpenAI-compatible',
    anthropic: 'Anthropic',
    gemini: 'Gemini',
    ollama: 'Ollama'
  }

  const needsKey = cfg.provider !== 'ollama'
  const providerOk = !needsKey || (cfg.apiKey?.trim()?.length ?? 0) > 0

  if (!bootstrapped) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center justify-center gap-3 py-24 text-app-muted">
        <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
        <p className="text-sm">Загрузка настроек…</p>
      </div>
    )
  }

  /* ---------- Мастер первого запуска ---------- */
  if (!wizardDone) {
    return (
      <div className="mx-auto max-w-xl pb-10">
        <WizardProgress step={wizardStep} />
        <div className="glass rounded-2xl border border-white/[0.08] p-6">
          {wizardStep === 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-white">Настроим ИИ за пару шагов</h2>
              <p className="text-sm leading-relaxed text-app-muted">
                Сначала подключим сервис с нейросетью (ключ и модель). Потом по желанию — роль «агента» (например, ответы в
                стиле патрульной службы). Всё можно изменить позже.
              </p>
              <ul className="list-disc space-y-2 pl-5 text-sm text-app-muted">
                <li>Ответы ИИ по-прежнему только из ваших импортированных документов.</li>
                <li>Ключ хранится только на этом компьютере.</li>
              </ul>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWizardStep(1)}
                  className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-dim"
                >
                  Далее
                </button>
                <button
                  type="button"
                  onClick={() => void skipWizard()}
                  className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-app-muted hover:bg-white/[0.04]"
                >
                  Пропустить — настрою позже
                </button>
              </div>
            </div>
          )}

          {wizardStep === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-white">Базовый провайдер</h2>
              <p className="text-sm text-app-muted">Укажите, куда слать запросы и какую модель использовать по умолчанию.</p>
              <ProviderFields cfg={cfg} setCfg={setCfg} mode="wizard" />
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWizardStep(0)}
                  className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-app-muted hover:bg-white/[0.04]"
                >
                  Назад
                </button>
                <button
                  type="button"
                  onClick={() => setWizardStep(2)}
                  disabled={needsKey && !cfg.apiKey?.trim()}
                  className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40"
                >
                  Далее
                </button>
              </div>
              {needsKey && !cfg.apiKey?.trim() && (
                <p className="text-xs text-amber-200/90">Введите API ключ или выберите Ollama.</p>
              )}
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-white">Агент (по желанию)</h2>
              <p className="text-sm text-app-muted">
                Агент задаёт тон ответа («отвечай как патрульный»). Можно пропустить — тогда только общие правила LexPatrol.
              </p>
              <label className="block">
                <span className="text-xs font-medium text-app-muted">Название агента</span>
                <input
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                  value={wizardAgentName}
                  onChange={(e) => setWizardAgentName(e.target.value)}
                  placeholder="Например: патруль — южный участок"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-app-muted">Инструкции (роль)</span>
                <textarea
                  className="mt-1.5 min-h-[100px] w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                  value={wizardAgentPrompt}
                  onChange={(e) => setWizardAgentPrompt(e.target.value)}
                  placeholder="Коротко: как формулировать ответы, без выдуманных статей…"
                />
              </label>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWizardStep(1)}
                  className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-app-muted hover:bg-white/[0.04]"
                >
                  Назад
                </button>
                <button type="button" onClick={() => setWizardStep(3)} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-dim">
                  Далее
                </button>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-white">Проверьте и сохраните</h2>
              <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm">
                <div className="flex justify-between gap-4 border-b border-white/[0.06] pb-2">
                  <span className="text-app-muted">Сервис</span>
                  <span className="text-right font-medium text-white">{providerLabel[cfg.provider]}</span>
                </div>
                <div className="flex justify-between gap-4 border-b border-white/[0.06] pb-2">
                  <span className="text-app-muted">Модель</span>
                  <span className="text-right text-white">{cfg.model || '—'}</span>
                </div>
                <div className="flex justify-between gap-4 border-b border-white/[0.06] pb-2">
                  <span className="text-app-muted">Ключ</span>
                  <span className="text-right text-white">{needsKey ? maskKey(cfg.apiKey ?? '') : 'не нужен (Ollama)'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-app-muted">Агент</span>
                  <span className="max-w-[60%] text-right text-white">
                    {wizardAgentName.trim() ? wizardAgentName.trim() : 'Не создаём'}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWizardStep(2)}
                  className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-app-muted hover:bg-white/[0.04]"
                >
                  Назад
                </button>
                <button
                  type="button"
                  onClick={() => void finishWizard()}
                  className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-dim"
                >
                  Сохранить и готово
                </button>
              </div>
            </div>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-app-muted">
          Уже настраивали? Если ключ сохранён в базе, экран откроется автоматически.
        </p>
      </div>
    )
  }

  /* ---------- Хаб после мастера + опционально расширенный редактор ---------- */
  return (
    <div className="mx-auto flex max-w-3xl flex-col pb-8">
      {saveToast && (
        <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-center text-sm text-emerald-100">
          {saveToast}
        </div>
      )}

      <header className="mb-4 shrink-0 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-white">ИИ-ассистент</h1>
          {!showAdvanced && (
            <button
              type="button"
              onClick={() => setShowAdvanced(true)}
              className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-app-muted hover:bg-white/[0.06] hover:text-white"
            >
              Полная настройка
            </button>
          )}
        </div>
        <p className="text-sm leading-snug text-app-muted">
          Ответы из <strong className="font-medium text-app">локальной базы</strong>. Проверяйте статьи в читателе.
        </p>
        <AiHowItWorksGuide />
      </header>

      {!showAdvanced && (
        <div className="mb-6 space-y-4">
          <div className="glass rounded-2xl border border-white/[0.08] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-app-muted">Что сейчас настроено</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/[0.06] pb-3">
                <dt className="text-app-muted">Провайдер</dt>
                <dd className="text-right font-medium text-white">{providerLabel[cfg.provider]}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/[0.06] pb-3">
                <dt className="text-app-muted">Модель</dt>
                <dd className="max-w-[70%] text-right text-white">{cfg.model}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2 border-b border-white/[0.06] pb-3">
                <dt className="text-app-muted">Ключ</dt>
                <dd className="text-right text-white">
                  {providerOk ? (
                    needsKey ? (
                      maskKey(cfg.apiKey ?? '')
                    ) : (
                      'Ollama — ключ не нужен'
                    )
                  ) : (
                    <span className="text-amber-200">Не задан — запросы не отправятся</span>
                  )}
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-app-muted">Агенты</dt>
                <dd className="text-right text-white">
                  {agents.length === 0 ? (
                    <span className="text-app-muted">Нет — только общий стиль</span>
                  ) : (
                    <span>{agents.map((a) => a.name).join(', ')}</span>
                  )}
                </dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAdvanced(true)
                  setActiveTab('provider')
                }}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim"
              >
                Изменить провайдера и параметры
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAdvanced(true)
                  setActiveTab('agents')
                }}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/[0.06]"
              >
                Агенты
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAdvanced(true)
                  setActiveTab('ask')
                }}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/[0.06]"
              >
                Пробный вопрос
              </button>
              <button
                type="button"
                onClick={() => void resetWizard()}
                className="ml-auto rounded-lg px-3 py-2 text-xs text-app-muted hover:text-white"
              >
                Пройти мастер снова
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdvanced && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowAdvanced(false)}
            className="text-sm text-accent hover:underline"
          >
            ← К сводке
          </button>
        </div>
      )}

      {showAdvanced && (
      <div className="glass flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.06] sm:flex-row">
        <nav
          className="-mx-0 flex shrink-0 gap-1 overflow-x-auto border-b border-white/[0.06] px-2 pb-2 pt-2 sm:mx-0 sm:w-52 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:px-2 sm:pb-2"
          role="tablist"
          aria-label="Разделы ИИ"
        >
          {TABS.map((tab) => {
            const active = activeTab === tab.id
            const extra =
              tab.id === 'agents' && agents.length > 0 ? (
                <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-app-muted">{agents.length}</span>
              ) : null
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm transition-colors sm:w-full sm:shrink sm:py-2.5 ${
                  active ? 'bg-accent/25 font-medium text-white' : 'text-app-muted hover:bg-white/[0.06] hover:text-white'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="flex items-baseline gap-1 whitespace-nowrap sm:whitespace-normal">
                  {tab.label}
                  {extra}
                </span>
                <span className="mt-0.5 hidden text-[11px] font-normal leading-tight opacity-80 sm:block">{tab.hint}</span>
              </button>
            )
          })}
        </nav>

        <div className="min-h-[min(70vh,520px)] flex-1 overflow-y-auto p-4 sm:p-5" role="tabpanel" aria-live="polite">
          {activeTab === 'provider' && (
            <TabPanel title="Базовый провайдер" subtitle="Все параметры подключения к API.">
              <ProviderFields cfg={cfg} setCfg={setCfg} mode="full" />
              <button
                type="button"
                onClick={() => void saveCfg()}
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-dim"
              >
                Сохранить провайдер
              </button>
            </TabPanel>
          )}

          {activeTab === 'agents' && (
            <TabPanel title="ИИ-агенты" subtitle="Роли и переопределения.">
              {agents.length > 0 && (
                <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] bg-white/[0.02]">
                  {agents.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="font-medium text-white">{a.name}</div>
                        {a.description && <div className="truncate text-xs text-app-muted">{a.description}</div>}
                      </div>
                      <div className="flex shrink-0 gap-3 text-sm">
                        <button type="button" className="text-accent hover:underline" onClick={() => startEdit(a)}>
                          Изменить
                        </button>
                        <button type="button" className="text-red-300/90 hover:underline" onClick={() => void deleteAgent(a.id)}>
                          Удалить
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4">
                <p className="mb-4 text-xs font-medium uppercase tracking-wide text-app-muted">
                  {editingId ? 'Редактирование агента' : 'Новый агент'}
                </p>
                <div className="grid gap-4">
                  <label className="block">
                    <span className="text-xs font-medium text-app-muted">Название</span>
                    <input
                      className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                      value={form.name ?? ''}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Патруль / департамент — кратко"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-app-muted">Описание</span>
                    <input
                      className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                      value={form.description ?? ''}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs font-medium text-app-muted">Тип API для этого агента</span>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                      value={form.provider ?? ''}
                      onChange={(e) => {
                        const v = e.target.value as AiProv | ''
                        if (!v) {
                          setForm({ ...form, provider: null, base_url: null })
                          return
                        }
                        setForm({
                          ...form,
                          provider: v,
                          base_url: usesConfigurableBaseUrl(v) ? recommendedBaseUrl(v) : null
                        })
                      }}
                    >
                      <option value="">Как во вкладке «Провайдер» ({providerLabel[cfg.provider]})</option>
                      {PROVIDER_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <Hint>
                      Обычно не трогают: роль задаётся промптом ниже. Переопределите, если этот агент должен ходить в другой сервис
                      или на другой компьютер с Ollama.
                    </Hint>
                  </label>

                  {agentUsesConfigurableBase ? (
                    <label className="block">
                      <span className="text-xs font-medium text-app-muted">Base URL для этого агента</span>
                      <input
                        className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                        value={form.base_url ?? ''}
                        onChange={(e) => setForm({ ...form, base_url: e.target.value || null })}
                        placeholder={recommendedBaseUrl(effectiveAgentProv)}
                      />
                      <Hint>
                        Оставьте пустым — возьмётся из вкладки «Провайдер»
                        {cfg.baseUrl ? (
                          <>
                            {' '}
                            (<code className="rounded bg-white/10 px-1 py-px text-[11px]">{cfg.baseUrl}</code>
                            ).
                          </>
                        ) : (
                          '.'
                        )}
                      </Hint>
                      <BaseUrlHint provider={effectiveAgentProv === 'ollama' ? 'ollama' : 'openai_compatible'} />
                    </label>
                  ) : (
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
                      <p className="text-xs font-medium text-app-muted">Адрес API для этого агента</p>
                      <FixedBaseUrlNotice provider={effectiveAgentProv} />
                    </div>
                  )}

                  <label className="block">
                    <span className="text-xs font-medium text-app-muted">Доп. инструкции (роль)</span>
                    <textarea
                      className="mt-1.5 min-h-[100px] w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                      value={form.system_prompt_extra ?? ''}
                      onChange={(e) => setForm({ ...form, system_prompt_extra: e.target.value })}
                    />
                    <Hint>Добавляется к системному промпту LexPatrol.</Hint>
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-medium text-app-muted">Температура</span>
                      <input
                        className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                        value={form.temperature ?? ''}
                        onChange={(e) =>
                          setForm({ ...form, temperature: e.target.value === '' ? null : Number(e.target.value) })
                        }
                        placeholder="Из провайдера"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-app-muted">Лимит токенов</span>
                      <input
                        className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                        value={form.max_tokens ?? ''}
                        onChange={(e) =>
                          setForm({ ...form, max_tokens: e.target.value === '' ? null : Number(e.target.value) })
                        }
                        placeholder="Из провайдера"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="text-xs font-medium text-app-muted">Другая модель</span>
                    <input
                      className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                      value={form.model ?? ''}
                      onChange={(e) => setForm({ ...form, model: e.target.value || null })}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-app-muted">Свой API ключ</span>
                    <input
                      type="password"
                      className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                      value={form.api_key ?? ''}
                      onChange={(e) => setForm({ ...form, api_key: e.target.value || null })}
                    />
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void saveAgent()}
                    className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-dim"
                  >
                    {editingId ? 'Сохранить' : 'Добавить агента'}
                  </button>
                  {editingId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null)
                        setForm(emptyAgentForm)
                      }}
                      className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-app-muted hover:bg-white/[0.04]"
                    >
                      Отмена
                    </button>
                  )}
                </div>
              </div>
            </TabPanel>
          )}

          {activeTab === 'ask' && (
            <TabPanel title="Пробный вопрос" subtitle="Проверка подключения.">
              <label className="block">
                <span className="text-xs font-medium text-app-muted">Агент</span>
                <select
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                >
                  <option value="">Только провайдер</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-app-muted">Вопрос</span>
                <textarea
                  className="mt-1.5 min-h-[140px] w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void ask()}
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40"
              >
                {busy ? 'Отправка…' : 'Отправить'}
              </button>
              {warn && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{warn}</div>
              )}
              {out && (
                <div>
                  <p className="mb-2 text-xs font-medium text-app-muted">Ответ</p>
                  <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-white/[0.08] bg-surface-raised/90 p-4 text-sm leading-relaxed text-app whitespace-pre-wrap">
                    {out}
                  </div>
                </div>
              )}
            </TabPanel>
          )}
        </div>
      </div>
      )}

      {/* Хаб: быстрый пробный вопрос без входа в полную настройку */}
      {!showAdvanced && wizardDone && (
        <div className="glass mt-4 rounded-2xl border border-white/[0.06] p-5">
          <h2 className="text-sm font-semibold text-white">Быстрый вопрос</h2>
          <p className="mt-1 text-xs text-app-muted">Без перехода в полную настройку.</p>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-app-muted">Агент</span>
            <select
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">Только провайдер</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <textarea
            className="mt-3 min-h-[100px] w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void ask()}
            className="mt-3 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40"
          >
            {busy ? 'Отправка…' : 'Отправить вопрос'}
          </button>
          {warn && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{warn}</div>
          )}
          {out && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-app-muted">Ответ</p>
              <div className="max-h-[36vh] overflow-y-auto rounded-xl border border-white/[0.08] bg-surface-raised/90 p-4 text-sm whitespace-pre-wrap">
                {out}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
