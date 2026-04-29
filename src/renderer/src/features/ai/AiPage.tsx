import { useCallback, useEffect, useState } from 'react'
import type { AiProviderConfig, AiAgentRecord, AiCompletePayload, AiCitation } from '@shared/types'
import { AI_AGENT_PRESETS, type AiAgentPreset } from './agent-presets'

const SETTINGS_KEY = 'ai_provider_config'
/** После прохождения мастера или миграции со старой версии — показываем «хаб», а не мастер. */
const WIZARD_DONE_KEY = 'ai_wizard_completed'

const defaultCfg: AiProviderConfig = {
  provider: 'openai_compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.2,
  /** Локальные модели (LM Studio и т.п.) и длинные юридические ответы; 1200 часто обрывает текст по лимиту API. */
  maxTokens: 4096,
  allowBroaderContext: false
}

const emptyAgentForm: Partial<AiAgentRecord> = {
  name: '',
  description: '',
  system_prompt_extra: ''
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

type AiTabId = 'connection' | 'generation' | 'agents'

const TABS: { id: AiTabId; label: string; hint: string }[] = [
  { id: 'connection', label: 'Подключение', hint: 'тип API, адрес, ключ, модель' },
  { id: 'generation', label: 'Ответ модели', hint: 'температура, длина, контекст' },
  { id: 'agents', label: 'Агенты', hint: 'роли и инструкции' }
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
            браузер. Тексты хранятся в базе на вашем компьютере (SQLite). Обычно это нормы и справки для{' '}
            <strong className="text-app">GTA V RP / FiveM</strong> и похожих серверов, а не обязательно тексты
            действующего права какой-либо страны.
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
              <strong className="text-app">Подключение</strong> — тип API, адрес, ключ, модель.
            </li>
            <li>
              <strong className="text-app">Ответ модели</strong> — температура, лимит токенов, расширение контекста.
            </li>
            <li>
              <strong className="text-app">Агенты</strong> — роль и стиль ответа.
            </li>
          </ul>
          <p className="text-xs">
            Проверить запрос можно в блоке <strong className="text-app">«Быстрый вопрос»</strong> на этой же странице — отдельная вкладка не нужна.
          </p>
        </section>
        <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-app-muted">
          Итог: ИИ — <strong className="text-app">пересказ и навигация по вашим импортированным материалам</strong> для
          игрового сценария. Это не замена реальному юристу и не консультация по законам государств вне контекста RP.
        </p>
      </div>
    </details>
  )
}

function AiProviderSetupGuide(): JSX.Element {
  return (
    <details className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.03] open:bg-white/[0.05]">
      <summary className="cursor-pointer list-none px-4 py-3 font-medium text-white [&::-webkit-details-marker]:hidden">
        <span className="flex items-start justify-between gap-3">
          <span>
            Как подключить ИИ и модель{' '}
            <span className="mt-0.5 block text-xs font-normal text-app-muted">
              ChatGPT в облаке, LM Studio на ПК, что скачать и сколько это стоит
            </span>
          </span>
          <span className="shrink-0 pt-0.5 text-app-muted">▼</span>
        </span>
      </summary>
      <div className="space-y-5 border-t border-white/[0.06] px-4 pb-4 pt-4 text-sm leading-relaxed text-app-muted">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-app">1. Два типичных варианта</h3>
          <ul className="list-disc space-y-2 pl-5 marker:text-white/40">
            <li>
              <strong className="text-app">Облако (OpenAI и др.)</strong> — запрос уходит в интернет на сервис
              (например API ChatGPT / GPT-4o-mini). Нужен аккаунт и API-ключ, оплата обычно по токенам (см. ниже).
            </li>
            <li>
              <strong className="text-app">Локально на вашем ПК</strong> — модель крутится у вас (например через{' '}
              <strong className="text-app">LM Studio</strong> или Ollama). Запросы к ней не тарифицируются по токенам
              как у OpenAI; платите разве что за электричество и железо.
            </li>
          </ul>
          <p>
            В LexPatrol в полной настройке выберите тип <strong className="text-app">OpenAI-compatible</strong> для LM
            Studio (адрес вида <code className="rounded bg-white/10 px-1 py-px text-[11px]">http://127.0.0.1:1234/v1</code>
            ) или <strong className="text-app">Ollama</strong>, если поднимаете Ollama отдельно.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-app">2. ChatGPT / OpenAI API</h3>
          <p>
            «ChatGPT» в браузере и <strong className="text-app">API для разработчиков</strong> — разные продукты: для
            LexPatrol нужен именно <strong className="text-app">ключ API</strong> (модели вроде{' '}
            <code className="rounded bg-white/10 px-1 py-px text-[11px]">gpt-4o-mini</code>).
          </p>
          <p>
            Где взять: зарегистрируйтесь на{' '}
            <a
              href="https://platform.openai.com/"
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent hover:underline"
            >
              platform.openai.com
            </a>
            , раздел API keys, создайте секретный ключ и вставьте его в LexPatrol. Актуальные цены и лимиты — на официальной
            странице <strong className="text-app">Pricing</strong> у OpenAI (цифры часто меняются, в приложении их не
            дублируем).
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-app">3. LM Studio (бесплатно, локально)</h3>
          <ol className="list-decimal space-y-2 pl-5 marker:text-accent">
            <li>
              Скачайте приложение с{' '}
              <a href="https://lmstudio.ai/" target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
                lmstudio.ai
              </a>{' '}
              (Windows/macOS/Linux).
            </li>
            <li>Во вкладке поиска моделей найдите нужную, выберите размер квантизации (чем меньше гигабайты — тем легче для RAM и диска).</li>
            <li>Скачайте модель, откройте вкладку чата или включите локальный сервер (Developer / Local Server).</li>
            <li>
              Убедитесь, что сервер слушает порт по умолчанию <strong className="text-app">1234</strong> и путь{' '}
              <code className="rounded bg-white/10 px-1 py-px text-[11px]">/v1</code> — в LexPatrol укажите Base URL{' '}
              <code className="rounded bg-white/10 px-1 py-px text-[11px]">http://127.0.0.1:1234/v1</code>.
            </li>
            <li>
              Поле <strong className="text-app">API ключ</strong> при локальном сервере можно заполнить любой
              несекретной заглушкой (например <code className="rounded bg-white/10 px-1 py-px text-[11px]">lm-studio</code>
              ) — LM Studio для локального режима ключ не проверяет, а LexPatrol требует непустое значение.
            </li>
          </ol>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-app">4. Относительно лёгкие модели, но с нормальным ответом</h3>
          <p>
            Точные имена в каталоге LM Studio меняются; ориентируйтесь на <strong className="text-app">размер на диске</strong>{' '}
            и <strong className="text-app">квантизацию</strong> (часто <code className="rounded bg-white/10 px-1 py-px text-[11px]">Q4_K_M</code> — разумный баланс качества и веса).
          </p>
          <ul className="list-disc space-y-1.5 pl-5 marker:text-white/40">
            <li>
              Семейства <strong className="text-app">Gemma 2</strong> (2B / 9B) — компактно, хорошо следуют инструкциям.
            </li>
            <li>
              <strong className="text-app">Llama 3.2</strong> 3B Instruct — очень лёгкая, для простых вопросов по базе.
            </li>
            <li>
              <strong className="text-app">Qwen2.5</strong> 7B Instruct — чуть тяжелее, часто лучше держит контекст и русский.
            </li>
            <li>
              <strong className="text-app">Phi-3</strong> / <strong className="text-app">Phi-3.5</strong> mini — маленькие, быстрые; для длинных юридически плотных ответов может не хватить «глубины».
            </li>
          </ul>
          <p className="text-xs">
            Ориентир по RAM: модель в Q4 обычно занимает порядка своего размера в гигабайтах + запас под систему; если
            не влезает — возьмите меньшую или более агрессивную квантизацию.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-app">5. Кратко про деньги</h3>
          <ul className="list-disc space-y-1.5 pl-5 marker:text-white/40">
            <li>
              <strong className="text-app">LM Studio и скачивание моделей</strong> — без оплаты самому сервису; платите
              только за интернет/диск/ПК.
            </li>
            <li>
              <strong className="text-app">OpenAI и другие облачные API</strong> — платный доступ по тарифу провайдера;
              сумму смотрите на их сайте в разделе цен.
            </li>
            <li>
              <strong className="text-app">LexPatrol</strong> — приложение само по себе не продаёт токены; оно лишь
              отправляет ваш запрос туда, куда вы настроили провайдер.
            </li>
          </ul>
        </section>

        <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-app-muted">
          После настройки откройте <strong className="text-app">Полная настройка</strong> → «Подключение» и при желании
          «Ответ модели» / «Агенты», сохраните изменения и проверьте ответ в блоке <strong className="text-app">«Быстрый
          вопрос»</strong> на этой странице.
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

/** Поля провайдера: мастер, вкладка «Подключение» или «Ответ модели». */
function ProviderFields({
  cfg,
  setCfg,
  mode
}: {
  cfg: AiProviderConfig
  setCfg: React.Dispatch<React.SetStateAction<AiProviderConfig>>
  mode: 'wizard' | 'connection' | 'generation'
}): JSX.Element {
  const needsKey = cfg.provider !== 'ollama'
  const configurable = usesConfigurableBaseUrl(cfg.provider)

  if (mode === 'generation') {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">Случайность ответа</p>
          <label className="mt-3 block max-w-md">
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
            <Hint>Ниже — строже и предсказуемее (0.2–0.4 для справок). Выше — свободнее, выше риск отхода от текста базы.</Hint>
          </label>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">Длина ответа</p>
          <label className="mt-3 block max-w-md">
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
            <Hint>
              Лимит на стороне модели. Если ответ обрывается на полуслове — увеличьте (для LM Studio часто 4096–8192).
            </Hint>
          </label>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">Расширение контекста</p>
          <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-white/20 bg-surface-raised text-accent focus:ring-accent"
              checked={Boolean(cfg.allowBroaderContext)}
              onChange={(e) => setCfg({ ...cfg, allowBroaderContext: e.target.checked })}
            />
            <span className="text-sm text-app-muted">
              <span className="font-medium text-white">Разрешить общие пояснения помимо цитат из базы</span>
              <span className="mt-1 block text-xs leading-relaxed opacity-90">
                Если включено, модель может добавить короткие пояснения вне импортированных фрагментов, явно помечая их.
                По умолчанию ответ строится только из вашей базы.
              </span>
            </span>
          </label>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">Сервис</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-app-muted">Тип API</span>
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
            {mode === 'wizard' ? (
              <Hint>Куда у вас есть доступ. Своя модель на ПК — чаще OpenAI-compatible (LM Studio) или Ollama.</Hint>
            ) : (
              <Hint>Смена типа подставит типичный адрес; при необходимости поправьте поле ниже.</Hint>
            )}
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
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 sm:col-span-2">
              <p className="text-xs font-medium text-app-muted">Адрес API</p>
              <FixedBaseUrlNotice provider={cfg.provider} />
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">Доступ и модель</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {needsKey && (
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-app-muted">API ключ</span>
              <input
                type="password"
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                value={cfg.apiKey ?? ''}
                onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
                placeholder="sk-… или заглушка для LM Studio"
              />
              <Hint>Хранится только локально. Для LM Studio на ПК часто достаточно любой несекретной строки.</Hint>
            </label>
          )}

          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-app-muted">Идентификатор модели</span>
            <input
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white sm:max-w-xl"
              value={cfg.model}
              onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
              placeholder="gpt-4o-mini или имя модели из LM Studio"
            />
            <Hint>Как в документации провайдера или в списке моделей LM Studio / Ollama.</Hint>
          </label>
        </div>
      </div>
    </div>
  )
}

function AgentPresetPicker({
  selectedId,
  onSelect,
  onCustom,
  compact
}: {
  selectedId: string | null
  onSelect: (p: AiAgentPreset) => void
  onCustom?: () => void
  compact?: boolean
}): JSX.Element {
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <p className="text-xs font-medium text-app-muted">
        {compact
          ? 'Шаблоны ролей: подставят название, описание и блок «Доп. инструкции». Всё можно править ниже.'
          : 'Готовые роли для GTA V RP / LexPatrol — нажмите карточку, поля ниже заполнятся; затем можно отредактировать вручную.'}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {AI_AGENT_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p)}
            className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
              selectedId === p.id
                ? 'border-accent/60 bg-accent/15 ring-1 ring-accent/40'
                : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
            }`}
          >
            <div className="font-medium text-white">{p.name}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-app-muted">{p.description}</div>
          </button>
        ))}
      </div>
      {onCustom && (
        <button
          type="button"
          onClick={() => onCustom()}
          className={`w-full rounded-lg border px-3 py-2 text-xs transition-colors ${
            selectedId === null
              ? 'border-white/15 bg-white/[0.05] text-app-muted'
              : 'border-white/10 text-app-muted hover:bg-white/[0.04]'
          }`}
        >
          Свой вариант — без шаблона (поля не очищаются)
        </button>
      )}
    </div>
  )
}

type WizardStep = 0 | 1 | 2 | 3

/** Подсветка ссылок вида id=<uuid> или [id=<uuid>] — открытие статьи в читателе. */
function AiAnswerRich({ text, citations }: { text: string; citations: AiCitation[] }): JSX.Element {
  const byId = new Map(citations.map((c) => [c.articleId, c]))
  const nodes: React.ReactNode[] = []
  let last = 0
  let chipKey = 0
  const re = /(?:\[)?id=([a-f0-9-]{36})(?:\])?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const id = m[1]!
    const cite = byId.get(id)
    const label = cite ? cite.articleLabel : `id ${id.slice(0, 8)}…`
    const tip = cite ? `${cite.documentTitle}\n${cite.excerpt}` : 'Статья не найдена в контексте запроса'
    nodes.push(
      <button
        key={`cite-${chipKey++}-${id}`}
        type="button"
        title={tip}
        disabled={!cite}
        onClick={() => {
          if (cite) void window.lawHelper.openReader(cite.documentId, cite.articleId)
        }}
        className={`mx-0.5 inline-flex max-w-[min(100%,18rem)] align-baseline rounded border px-1.5 py-0.5 text-left text-xs font-medium leading-snug transition-colors ${
          cite
            ? 'cursor-pointer border-accent/45 bg-accent/15 text-accent hover:bg-accent/28'
            : 'cursor-default border-white/10 bg-white/[0.04] text-app-muted'
        }`}
      >
        <span className="truncate">{label}</span>
      </button>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-app">{nodes}</div>
}

function AiCitationFooter({ citations }: { citations: AiCitation[] }): JSX.Element | null {
  if (citations.length === 0) return null
  return (
    <div className="mt-3 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-3">
      <p className="text-xs font-medium text-app-muted">Упомянутые в ответе статьи</p>
      <ul className="mt-2 space-y-2">
        {citations.map((c) => (
          <li
            key={c.articleId}
            className="flex flex-wrap items-start justify-between gap-2 gap-y-1 border-b border-white/[0.06] pb-2 last:border-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-white">{c.articleLabel}</div>
              <div className="truncate text-xs text-app-muted" title={c.documentTitle}>
                {c.documentTitle}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void window.lawHelper.openReader(c.documentId, c.articleId)}
              className="shrink-0 rounded-md border border-white/12 bg-white/[0.06] px-2.5 py-1 text-xs text-white hover:bg-white/[0.12]"
            >
              В читателе
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

const WIZARD_STEP_LABELS = ['Начало', 'Подключение', 'Агент', 'Готово']

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
  /** Шаблон агента в мастере: подсветка карточки и описание при сохранении. */
  const [wizardPresetId, setWizardPresetId] = useState<string | null>(null)
  const [agentFormPresetId, setAgentFormPresetId] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<AiTabId>('connection')
  const [cfg, setCfg] = useState<AiProviderConfig>(defaultCfg)
  const [agents, setAgents] = useState<AiAgentRecord[]>([])
  const [agentId, setAgentId] = useState<string>('')
  const [form, setForm] = useState<Partial<AiAgentRecord>>(emptyAgentForm)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [q, setQ] = useState('Какие статьи уместно проверить при задержании по демо-документу?')
  const [out, setOut] = useState('')
  const [citations, setCitations] = useState<AiCitation[]>([])
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)
  const [saveToast, setSaveToast] = useState<string | null>(null)

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
          if (nextCfg.maxTokens === 1200) {
            nextCfg = { ...nextCfg, maxTokens: 4096 }
            await window.lawHelper.settings.set(SETTINGS_KEY, JSON.stringify(nextCfg))
          }
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
      const presetMeta = wizardPresetId !== null ? AI_AGENT_PRESETS.find((p) => p.id === wizardPresetId) : undefined
      await window.lawHelper.aiAgents.save({
        name: wizardAgentName.trim(),
        description: presetMeta?.description?.trim() || null,
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
    setWizardPresetId(null)
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
    setWizardPresetId(null)
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
    setCitations([])
    try {
      const needsKey = cfg.provider !== 'ollama'
      const keyFromCfg = cfg.apiKey?.trim()
      if (needsKey && !keyFromCfg) {
        setWarn('Укажите API ключ в разделе «Подключение».')
        return
      }
      const payload: AiCompletePayload = {
        cfg,
        question: q,
        agentId: agentId || null
      }
      const res = await window.lawHelper.ai.complete(payload)
      setOut(res.text)
      setCitations(Array.isArray(res.citations) ? (res.citations as AiCitation[]) : [])
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
      name: form.name.trim(),
      description: form.description?.trim() ? form.description.trim() : null,
      system_prompt_extra: form.system_prompt_extra ?? '',
      temperature: null,
      max_tokens: null,
      model: null,
      provider: null,
      base_url: null,
      api_key: null
    } as Partial<AiAgentRecord> & { name: string })
    setForm(emptyAgentForm)
    setEditingId(null)
    setAgentFormPresetId(null)
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
    setAgentFormPresetId(null)
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
      <div className="mx-auto flex max-w-4xl flex-col items-center justify-center gap-3 py-24 text-app-muted">
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
                <li>
                  Ответы только из ваших импортированных текстов (часто нормы для GTA V RP / FiveM), а не из интернета и
                  не как официальная юридическая справка по стране.
                </li>
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
                Агент задаёт тон ответа. Можно выбрать готовую роль или заполнить поля вручную. Пропустить шаг —
                тогда только общие правила LexPatrol.
              </p>
              <AgentPresetPicker
                selectedId={wizardPresetId}
                onSelect={(p) => {
                  setWizardPresetId(p.id)
                  setWizardAgentName(p.name)
                  setWizardAgentPrompt(p.system_prompt_extra)
                }}
                onCustom={() => setWizardPresetId(null)}
              />
              <label className="block">
                <span className="text-xs font-medium text-app-muted">Название агента</span>
                <input
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                  value={wizardAgentName}
                  onChange={(e) => {
                    setWizardAgentName(e.target.value)
                    setWizardPresetId(null)
                  }}
                  placeholder="Например: патруль — южный участок"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-app-muted">Инструкции (роль)</span>
                <textarea
                  className="mt-1.5 min-h-[100px] w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                  value={wizardAgentPrompt}
                  onChange={(e) => {
                    setWizardAgentPrompt(e.target.value)
                    setWizardPresetId(null)
                  }}
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
    <div className="mx-auto flex max-w-4xl flex-col pb-8">
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
          Ответы только по <strong className="font-medium text-app">вашей импортированной базе</strong> (GTA V RP / FiveM и
          др.): не реальная юриспруденция. Проверяйте статьи в читателе.
        </p>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3 py-3 text-xs leading-relaxed text-amber-50/90">
          <p className="font-semibold text-amber-100">Важно про доверие</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-4">
            <li>
              ИИ может ошибаться или обобщать; не опирайтесь на ответ как на единственное доказательство в RP или OOC.
            </li>
            <li>
              В контекст попадают только фрагменты из вашей локальной базы — если документ не импортирован, модель его
              «не знает».
            </li>
            <li>
              С включённым ключом запросы уходят выбранному провайдеру (облако или ваш LM Studio / Ollama). Отключите
              раздел, если не хотите внешних запросов.
            </li>
          </ul>
        </div>
        <AiHowItWorksGuide />
        <AiProviderSetupGuide />
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
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setShowAdvanced(true)
                  setActiveTab('connection')
                }}
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-dim"
              >
                Подключение и модель
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAdvanced(true)
                  setActiveTab('generation')
                }}
                className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-white hover:bg-white/[0.06]"
              >
                Ответ модели
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAdvanced(true)
                  setActiveTab('agents')
                }}
                className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-white hover:bg-white/[0.06]"
              >
                Агенты
              </button>
              <button
                type="button"
                onClick={() => void resetWizard()}
                className="rounded-lg px-3 py-2 text-xs text-app-muted hover:text-white sm:ml-auto"
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
          className="-mx-0 flex shrink-0 gap-1 overflow-x-auto border-b border-white/[0.06] px-2 pb-2 pt-2 sm:mx-0 sm:w-56 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:px-2 sm:pb-2"
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
          {activeTab === 'connection' && (
            <TabPanel
              title="Подключение к API"
              subtitle="Тип сервиса, адрес, ключ и имя модели. Сохраните, затем проверьте запрос в блоке «Быстрый вопрос» ниже."
            >
              <ProviderFields cfg={cfg} setCfg={setCfg} mode="connection" />
              <button
                type="button"
                onClick={() => void saveCfg()}
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-dim"
              >
                Сохранить подключение
              </button>
            </TabPanel>
          )}

          {activeTab === 'generation' && (
            <TabPanel
              title="Параметры ответа"
              subtitle="Общие для всех запросов к ИИ (включая запросы с выбранным агентом)."
            >
              <ProviderFields cfg={cfg} setCfg={setCfg} mode="generation" />
              <button
                type="button"
                onClick={() => void saveCfg()}
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-dim"
              >
                Сохранить параметры
              </button>
            </TabPanel>
          )}

          {activeTab === 'agents' && (
            <TabPanel
              title="ИИ-агенты"
              subtitle="Только роль: название, описание и дополнительные инструкции. API, ключ и модель задаются в «Подключении» и «Ответ модели»."
            >
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
                {!editingId && (
                  <div className="mb-4">
                    <AgentPresetPicker
                      compact
                      selectedId={agentFormPresetId}
                      onSelect={(p) => {
                        setAgentFormPresetId(p.id)
                        setForm((f) => ({
                          ...f,
                          name: p.name,
                          description: p.description,
                          system_prompt_extra: p.system_prompt_extra
                        }))
                      }}
                      onCustom={() => setAgentFormPresetId(null)}
                    />
                  </div>
                )}
                <div className="grid gap-4">
                  <label className="block">
                    <span className="text-xs font-medium text-app-muted">Название</span>
                    <input
                      className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                      value={form.name ?? ''}
                      onChange={(e) => {
                        setAgentFormPresetId(null)
                        setForm({ ...form, name: e.target.value })
                      }}
                      placeholder="Патруль / департамент — кратко"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-app-muted">Описание</span>
                    <input
                      className="mt-1.5 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                      value={form.description ?? ''}
                      onChange={(e) => {
                        setAgentFormPresetId(null)
                        setForm({ ...form, description: e.target.value })
                      }}
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs font-medium text-app-muted">Доп. инструкции (роль)</span>
                    <textarea
                      className="mt-1.5 min-h-[100px] w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2.5 text-sm text-white"
                      value={form.system_prompt_extra ?? ''}
                      onChange={(e) => {
                        setAgentFormPresetId(null)
                        setForm({ ...form, system_prompt_extra: e.target.value })
                      }}
                    />
                    <Hint>Добавляется к системному промпту LexPatrol. Параметры API и модели — только в «Подключении» и «Ответ модели».</Hint>
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
                        setAgentFormPresetId(null)
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

        </div>
      </div>
      )}

      {/* Хаб: быстрый пробный вопрос без входа в полную настройку */}
      {!showAdvanced && wizardDone && (
        <div className="glass mt-4 rounded-2xl border border-white/[0.06] p-5">
          <h2 className="text-sm font-semibold text-white">Быстрый вопрос</h2>
          <p className="mt-1 text-xs text-app-muted">
            Без перехода в полную настройку. Длинный ответ — прокрутка в рамке ниже; при обрыве на полуслове увеличьте
            «Макс. токенов ответа» в разделе <strong className="font-medium text-app">Полная настройка → Ответ модели</strong>.
          </p>
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
              <div className="lex-ai-answer-scroll min-h-[10rem] max-h-[min(72vh,640px)] overflow-y-auto break-words rounded-xl border border-white/[0.08] bg-surface-raised/90 p-4">
                <AiAnswerRich text={out} citations={citations} />
                <AiCitationFooter citations={citations} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
