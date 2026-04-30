import type { AiCitation, AiProviderConfig } from '../shared/types'

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiCompletionResult {
  text: string
  raw?: unknown
  /** Предупреждение для пользователя (лимит токенов, фильтр и т.д.). */
  notice?: string | null
}

function headersForProvider(cfg: AiProviderConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.provider === 'openai' || cfg.provider === 'openai_compatible') {
    h['Authorization'] = `Bearer ${cfg.apiKey ?? ''}`
  }
  if (cfg.provider === 'anthropic') {
    h['x-api-key'] = cfg.apiKey ?? ''
    h['anthropic-version'] = '2023-06-01'
  }
  if (cfg.provider === 'gemini') {
    // API key passed as query param for Gemini REST
  }
  return h
}

function endpoint(cfg: AiProviderConfig): string {
  if (cfg.provider === 'ollama') {
    const base = (cfg.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '')
    return `${base}/api/chat`
  }
  if (cfg.provider === 'openai_compatible') {
    return `${cfg.baseUrl?.replace(/\/$/, '')}/chat/completions`
  }
  if (cfg.provider === 'anthropic') {
    return 'https://api.anthropic.com/v1/messages'
  }
  if (cfg.provider === 'gemini') {
    const key = cfg.apiKey ?? ''
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(key)}`
  }
  return 'https://api.openai.com/v1/chat/completions'
}

/** Тексты предупреждений при ограничениях провайдера (единый стиль в UI). */
const NOTICE_TRUNCATED_RU =
  'Ответ мог быть обрезан лимитом токенов: провайдер сообщил, что вывод не поместился в отведённый максимум. Увеличьте «Макс. токенов ответа» в разделе Полная настройка → Ответ модели или сократите запрос и контекст. При локальном LM Studio при сбоях на длинных вопросах по статьям дополнительно увеличьте Context length у загруженной модели — иначе длинный системный промпт с текстами статей может не помещаться во вход.'

const NOTICE_CONTENT_FILTER_RU =
  'Часть ответа недоступна из‑за фильтрации на стороне провайдера (content_filter).'

/** LM Studio / reasoning-модели часто заполняют только reasoning («Thinking Process»), content пустой — это не ответ пользователю. */
const NOTICE_REASONING_TRACE_ONLY_RU =
  'Модель вернула только скрытое рассуждение (reasoning), готового текста ответа в поле content нет — это не сбой LexPatrol. Увеличьте «Макс. токенов ответа» в настройках ИИ; в LM Studio при необходимости снизьте долю reasoning / отключите режим Thinking, чтобы хватило квоты на финальный ответ.'

function mergeNotices(...parts: (string | undefined)[]): string | null {
  const s = parts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
  return s.length ? s.join('\n\n') : null
}

function noticeFromOpenAiCompatibleChoice(choice: unknown): string | undefined {
  if (!choice || typeof choice !== 'object') return undefined
  const fr = (choice as { finish_reason?: string }).finish_reason
  if (fr === 'length') return NOTICE_TRUNCATED_RU
  if (fr === 'content_filter') return NOTICE_CONTENT_FILTER_RU
  return undefined
}

/** Пустой content в истории диалога даёт 400 у части OpenAI-compatible шлюзов (Groq, LM Studio, …). */
function ensureNonEmptyOpenAiMessageContent(messages: AiMessage[]): AiMessage[] {
  const placeholder = '…'
  return messages.map((m) => {
    const c = m.content
    if (typeof c === 'string' && c.trim().length > 0) return m
    return { ...m, content: placeholder }
  })
}

function clampOpenAiMaxTokens(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 4096
  return Math.min(128_000, Math.floor(n))
}

async function throwOpenAiCompatibleHttpError(res: Response): Promise<never> {
  let detail = ''
  try {
    const text = await res.text()
    detail = text
    const j = JSON.parse(text) as {
      error?: { message?: string; code?: string } | string
      message?: string
    }
    if (typeof j.error === 'object' && j.error?.message) detail = j.error.message
    else if (typeof j.error === 'string') detail = j.error
    else if (typeof j.message === 'string') detail = j.message
  } catch {
    /* оставляем detail как есть или пусто */
  }
  const short = detail ? ` — ${detail.replace(/\s+/g, ' ').slice(0, 600)}` : ''
  throw new Error(`OpenAI-compatible error: ${res.status}${short}`)
}

/**
 * Цепочки вида «Thinking Process», **Analyze the Request** — внутреннее рассуждение, не показывать как ответ.
 * Осмысленный текст в reasoning без таких маркеров оставляем (редкие совместимые API).
 */
function looksLikeHiddenReasoningTrace(s: string): boolean {
  const head = s.slice(0, 1800)
  if (/thinking\s*process\s*:/i.test(head)) return true
  if (/\*\*analyze\s+the\s+request/i.test(head)) return true
  if (/\*\*scan\s+the\s+context/i.test(head)) return true
  if (/\*\*formulate\s+the\s+answer/i.test(head)) return true
  if (/\*\*final\s+review\b/i.test(head)) return true
  const t = s.trimStart()
  if (/^\d+\.\s*\*\*analyze\b/im.test(t)) return true
  return false
}

/**
 * Некоторые OpenAI-совместимые шлюзы (LM Studio, Groq) кладут ответ в `content` (строка или массив частей).
 * Поле `reasoning_content` при пустом `content` часто содержит только внутреннее рассуждение — его не подставляем в ответ.
 */
function extractOpenAiCompatibleAssistantParts(message: unknown): {
  text: string
  suppressedReasoningTrace: boolean
} {
  if (!message || typeof message !== 'object') return { text: '', suppressedReasoningTrace: false }
  const m = message as {
    content?: unknown
    reasoning_content?: unknown
    refusal?: unknown
  }

  const rawContent = m.content
  if (typeof rawContent === 'string' && rawContent.trim()) {
    return { text: rawContent, suppressedReasoningTrace: false }
  }

  if (Array.isArray(rawContent)) {
    const parts = rawContent
      .map((p) => {
        if (p && typeof p === 'object') {
          const o = p as { type?: string; text?: string; content?: string }
          if (typeof o.text === 'string') return o.text
          if (typeof o.content === 'string') return o.content
        }
        return ''
      })
      .filter(Boolean)
    const joined = parts.join('\n').trim()
    if (joined) return { text: joined, suppressedReasoningTrace: false }
  }

  if (typeof m.reasoning_content === 'string' && m.reasoning_content.trim()) {
    const r = m.reasoning_content.trim()
    if (looksLikeHiddenReasoningTrace(r)) {
      return { text: '', suppressedReasoningTrace: true }
    }
    return { text: r, suppressedReasoningTrace: false }
  }
  if (typeof m.refusal === 'string' && m.refusal.trim()) {
    return { text: m.refusal.trim(), suppressedReasoningTrace: false }
  }
  if (typeof rawContent === 'string') return { text: rawContent, suppressedReasoningTrace: false }
  return { text: '', suppressedReasoningTrace: false }
}

/** Provider-agnostic chat completion (network I/O in main process for safer key handling). */
export async function completeChat(
  cfg: AiProviderConfig,
  messages: AiMessage[]
): Promise<AiCompletionResult> {
  const url = endpoint(cfg)

  if (cfg.provider === 'ollama') {
    const body = {
      model: cfg.model,
      messages,
      options: { temperature: cfg.temperature },
      stream: false
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`)
    const data = (await res.json()) as {
      message?: { content?: string }
      done_reason?: string
    }
    const text = data.message?.content ?? ''
    const notice = data.done_reason === 'length' ? NOTICE_TRUNCATED_RU : null
    return { text, notice, raw: data }
  }

  if (cfg.provider === 'gemini') {
    const parts = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))
    const body = { contents: parts }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error(`Gemini error: ${res.status}`)
    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: { text?: string }[] }
        finishReason?: string
      }>
    }
    const cand = data.candidates?.[0]
    const text = cand?.content?.parts?.map((p) => p.text).join('\n') ?? ''
    const fr = cand?.finishReason
    const notice =
      typeof fr === 'string' && fr.toUpperCase() === 'MAX_TOKENS' ? NOTICE_TRUNCATED_RU : null
    return { text, notice, raw: data }
  }

  if (cfg.provider === 'anthropic') {
    const system = messages.find((m) => m.role === 'system')?.content ?? ''
    const rest = messages.filter((m) => m.role !== 'system')
    const body = {
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      system,
      messages: rest.map((m) => ({ role: m.role, content: m.content }))
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: headersForProvider(cfg),
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error(`Anthropic error: ${res.status}`)
    const data = (await res.json()) as {
      content?: { text?: string }[]
      stop_reason?: string
    }
    const text = data.content?.map((c) => c.text).join('\n') ?? ''
    const notice = data.stop_reason === 'max_tokens' ? NOTICE_TRUNCATED_RU : null
    return { text, notice, raw: data }
  }

  const safeMessages = ensureNonEmptyOpenAiMessageContent(messages)
  const max_tokens = clampOpenAiMaxTokens(cfg.maxTokens)
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: safeMessages,
    max_tokens
  }
  const temp = cfg.temperature
  if (typeof temp === 'number' && !Number.isNaN(temp)) {
    body['temperature'] = Math.min(2, Math.max(0, temp))
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: headersForProvider(cfg),
    body: JSON.stringify(body)
  })
  if (!res.ok) await throwOpenAiCompatibleHttpError(res)
  const data = (await res.json()) as { choices?: unknown[] }
  const choice = data.choices?.[0]
  const message =
    choice && typeof choice === 'object' && 'message' in choice ?
      (choice as { message?: unknown }).message
    : undefined
  const parts = extractOpenAiCompatibleAssistantParts(message)
  let text = parts.text
  const notice = mergeNotices(
    noticeFromOpenAiCompatibleChoice(choice),
    parts.suppressedReasoningTrace ? NOTICE_REASONING_TRACE_ONLY_RU : undefined
  )
  if (!text.trim() && parts.suppressedReasoningTrace) {
    text =
      'Ответ не сформирован: ушёл лимит токенов на скрытое рассуждение модели. Увеличьте «Макс. токенов ответа» или уменьшите reasoning в LM Studio.'
  }
  return { text, notice, raw: data }
}

export type AiAnswerIntent = 'lookup' | 'situational' | 'general'

export function buildSystemPrompt(
  allowBroader: boolean,
  contextChunks: {
    heading: string
    documentTitle: string
    body: string
    articleId: string
    articleNumber?: string | null
  }[],
  agentExtra?: string | null,
  options?: { intent?: AiAnswerIntent; situationalEnabled?: boolean }
): string {
  const base = `Ты текстовый помощник в приложении LexPatrol для игроков GTA V RP, FiveM и похожих ролевых серверов.
Ниже в этом сообщении — фрагменты только из ЕГО ЛОКАЛЬНОЙ базы на ПК: то, что он сам импортировал (часто «кодексы», уставы и правила конкретного RP-проекта, учебные или игровые формулировки). Это не запрос реальной юридической консультации по законодательству какой-либо страны.

Правила:
- Отвечай, опираясь только на эти фрагменты. Если в них нет нужного — скажи, что в импортированной базе этого нет.
- Язык и вид ответа: по умолчанию отвечай на русском языке (интерфейс и контент базы — русские). Не выводи пошаговые «черновики» рассуждения и служебные заголовки на английском вроде Analyze the request, Step 1, Scan the context — пользователь должен видеть готовый связный ответ по делу, без внутренней разметки рассуждений.
- НЕ используй шаблоны вроде «не могу давать юридические консультации», «информация не является юридической рекомендацией», «обратитесь к квалифицированному юристу» и т.п.: для RP-сценария это вводит в заблуждение. Если уместно напомнить границы — одной короткой фразой: ответ только по материалам из LexPatrol и про игровой/серверный контекст, а не про законы государств в реальности.
- При желании одной фразой: сверяй формулировки с полным текстом статьи в читателе приложения.
- Каждый фрагмент ниже помечен id=<uuid>. Ссылаясь на норму из фрагмента, добавляй в конце соответствующей фразы id=<тот же uuid>. Не указывай id статей, которых не было во фрагментах.
- Ссылку для кнопки «В читателе» оформляй строго как id=<полный uuid из заголовка фрагмента, 36 символов с дефисами>. Не сокращай uuid до первых 8 символов без полной строки — иначе приложение не сможет привязать цитату к статье.`

  const intent = options?.intent ?? 'general'
  /** Для lookup в контекст кладётся больше текста статьи (подпункты, стадии); для остальных — умеренный лимит. */
  const maxFragment = intent === 'lookup' ? 14_000 : 4_000

  const situational =
    options?.situationalEnabled !== false && intent === 'situational'
      ? `

Ситуационный вопрос (квалификация события, «что будет за …», «как оформить …»). Структурируй ответ короткими блоками, без воды, в таком порядке:
1) Квалификация — одной фразой о чём идёт речь и какой это тип нарушения / процедуры по импортированной базе.
2) Норма — основные статьи, которые применимы (id=… после каждой ссылки на норму). Не перечисляй всё подряд — только релевантные.
3) Санкция — что грозит: штраф / арест / лишение / конфискация / срок (используй penalty_hint и поля display_meta из фрагмента, если они там есть).
4) Процессуальные действия — если в базе есть процессуальный кодекс или правила задержания/составления протокола, дай 1–3 пункта с id=…
5) Чего нет в базе — если каких-то аспектов вопроса не покрывают импортированные материалы, прямо скажи об этом одной строкой.
Не добавляй разделы, для которых не нашлось материалов. Не придумывай статьи, которых нет во фрагментах.`
      : ''

  const lookupHint =
    intent === 'lookup'
      ? `

Запрос про конкретную статью / номер из кодекса. Сформулируй короткий ответ: что предусматривает статья, как наказывается, к каким смежным нормам отсылает (если они есть во фрагментах). Учитывай нумерованные подпункты (2.1, 2.2…), стадии и примечания в теле статьи, если они попали во фрагмент. Обязательно поставь id=<uuid> рядом с упоминанием.`
      : ''

  const persona =
    agentExtra?.trim() ?
      `\n\n--- Доп. инструкции пользовательского агента ---\n${agentExtra.trim()}`
    : ''

  if (contextChunks.length === 0) {
    if (allowBroader) {
      return `${base}${situational}${lookupHint}${persona}

По этому запросу поиск по базе не вернул ни одной статьи (контекст пуст). Сообщи об этом пользователю. Не выдумывай тексты норм и не указывай id=. Ты можешь дать только общие подсказки (интерфейс, RP), явно отделив их от «законов из базы».`
    }
    return `${base}${situational}${lookupHint}${persona}

По этому запросу поиск по базе не вернул ни одной статьи (контекст пуст). Ответь, что в импортированных материалах нет подходящих фрагментов; не придумывай статьи и не используй id=.`
  }

  const ctx = contextChunks
    .map((c, i) => {
      const num = c.articleNumber?.trim()
      const titleLine = num ? `Статья №${num} — ${c.heading}` : c.heading
      const body =
        c.body.length <= maxFragment ? c.body : `${c.body.slice(0, maxFragment)}…`
      return `--- Фрагмент ${i + 1} | Документ: ${c.documentTitle} | ${titleLine} | id=${c.articleId} ---\n${body}`
    })
    .join('\n\n')

  if (allowBroader) {
    return `${base}${situational}${lookupHint}${persona}\n\nКонтекст из базы:\n${ctx}\n\nТы можешь добавить общие разъяснения, явно помечая их как не из импортированных материалов.`
  }
  return `${base}${situational}${lookupHint}${persona}\n\nКонтекст из базы (единственный источник):\n${ctx}`
}

/** Извлекает первый JSON-объект из текстового ответа модели (с фильтром «Thinking Process» и markdown-обёрток ``` ```). */
export function extractFirstJsonObject(text: string): unknown | null {
  if (!text) return null
  let s = text.trim()

  // Срезаем reasoning-обёртку, если она забилась в текст.
  const trimMarkers = [
    /^thinking\s*process\s*:[\s\S]*?\n\s*\n/i,
    /^analyze\s+the\s+request[\s\S]*?\n\s*\n/i,
    /^scan\s+the\s+context[\s\S]*?\n\s*\n/i
  ]
  for (const re of trimMarkers) {
    const next = s.replace(re, '')
    if (next.length < s.length) {
      s = next.trim()
      break
    }
  }

  const tryParse = (candidate: string): unknown | null => {
    try {
      return JSON.parse(candidate)
    } catch {
      return null
    }
  }

  // Сначала пробуем взять блок ```json ... ```, потом первое { ... }.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) {
    const parsed = tryParse(fence[1].trim())
    if (parsed) return parsed
  }

  // Поиск первой пары {} с балансом скобок (учитывая строки/экранирование).
  const start = s.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return tryParse(s.slice(start, i + 1))
      }
    }
  }
  return null
}

/**
 * Тонкая обёртка над `completeChat` для вспомогательных JSON-вызовов планировщика и реранкера.
 * Внутри: forced temperature=0, низкий max_tokens, защита от reasoning trace, парсинг первого JSON.
 */
export async function completeJson<T = unknown>(
  cfg: AiProviderConfig,
  messages: AiMessage[],
  options?: { maxTokens?: number; timeoutMs?: number }
): Promise<{ value: T | null; raw: string; notice?: string | null }> {
  const cap = Math.max(96, Math.min(2048, options?.maxTokens ?? 600))
  const sub: AiProviderConfig = {
    ...cfg,
    temperature: 0,
    maxTokens: cap
  }

  const result = await withTimeout(completeChat(sub, messages), options?.timeoutMs ?? 25_000)
  const value = extractFirstJsonObject(result.text) as T | null
  return { value, raw: result.text, notice: result.notice ?? null }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return p
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

export function parseCitationsFromAnswer(
  answer: string,
  chunks: {
    articleId: string
    documentId: string
    documentTitle: string
    heading: string
    articleNumber: string | null
  }[]
): AiCitation[] {
  const cited: AiCitation[] = []
  const seen = new Set<string>()
  const idPattern = /id=([a-f0-9-]{36})/gi
  let m: RegExpExecArray | null
  while ((m = idPattern.exec(answer)) !== null) {
    const id = m[1]!
    if (seen.has(id)) continue
    const ch = chunks.find((c) => c.articleId === id)
    if (ch) {
      seen.add(id)
      cited.push({
        articleId: ch.articleId,
        documentId: ch.documentId,
        documentTitle: ch.documentTitle,
        articleLabel: ch.articleNumber ? `Статья ${ch.articleNumber}` : ch.heading,
        excerpt: ch.heading
      })
    }
  }

  function resolveByUuidPrefix(prefix8: string):
    | (typeof chunks)[number]
    | undefined {
    const p = prefix8.toLowerCase()
    const hits = chunks.filter((c) => c.articleId.split('-')[0]!.toLowerCase() === p)
    return hits.length === 1 ? hits[0] : undefined
  }

  const partialPatterns: RegExp[] = [
    /\bid\s*[=:]?\s*([a-f0-9]{8})(?:-|[^\da-f]|$)/gi,
    /\bid\s+([a-f0-9]{8})(?:-|[^\da-f]|$)/gi
  ]
  for (const partialRe of partialPatterns) {
    partialRe.lastIndex = 0
    while ((m = partialRe.exec(answer)) !== null) {
      const prefix = m[1]?.toLowerCase()
      if (!prefix || prefix.length !== 8) continue
      const ch = resolveByUuidPrefix(prefix)
      if (!ch || seen.has(ch.articleId)) continue
      seen.add(ch.articleId)
      cited.push({
        articleId: ch.articleId,
        documentId: ch.documentId,
        documentTitle: ch.documentTitle,
        articleLabel: ch.articleNumber ? `Статья ${ch.articleNumber}` : ch.heading,
        excerpt: ch.heading
      })
    }
  }

  return cited
}
