import type { AiCitation, AiProviderConfig } from '../shared/types'

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiCompletionResult {
  text: string
  raw?: unknown
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
    const data = (await res.json()) as { message?: { content?: string } }
    return { text: data.message?.content ?? '', raw: data }
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
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') ?? ''
    return { text, raw: data }
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
    const data = (await res.json()) as { content?: { text?: string }[] }
    const text = data.content?.map((c) => c.text).join('\n') ?? ''
    return { text, raw: data }
  }

  const body = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: headersForProvider(cfg),
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`OpenAI-compatible error: ${res.status}`)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content ?? ''
  return { text, raw: data }
}

export function buildSystemPrompt(
  allowBroader: boolean,
  contextChunks: { heading: string; documentTitle: string; body: string; articleId: string }[],
  agentExtra?: string | null
): string {
  const base = `Ты помощник по материалам, импортированным пользователем в приложение LexPatrol (локальная база для RP-сценариев).
Всегда опирайся на приведённый контекст. Если ответа нет в контексте — скажи об этом явно.
Укажи предупреждение: ответ может быть неточным; проверяй оригинальные статьи.
Формат ссылок: [ID статьи] в конце предложения при цитировании.`

  const ctx = contextChunks
    .map(
      (c, i) =>
        `--- Фрагмент ${i + 1} | Документ: ${c.documentTitle} | ${c.heading} | id=${c.articleId} ---\n${c.body.slice(0, 3500)}`
    )
    .join('\n\n')

  const persona =
    agentExtra?.trim() ?
      `\n\n--- Доп. инструкции пользовательского агента ---\n${agentExtra.trim()}`
    : ''

  if (allowBroader) {
    return `${base}${persona}\n\nКонтекст из базы:\n${ctx}\n\nТы можешь добавить общие разъяснения, явно помечая их как не из импортированных материалов.`
  }
  return `${base}${persona}\n\nКонтекст из базы (единственный источник):\n${ctx}`
}

export function parseCitationsFromAnswer(
  answer: string,
  chunks: { articleId: string; documentTitle: string; heading: string; articleNumber: string | null }[]
): AiCitation[] {
  const cited: AiCitation[] = []
  const idPattern = /id=([a-f0-9-]{36})/gi
  let m: RegExpExecArray | null
  while ((m = idPattern.exec(answer)) !== null) {
    const id = m[1]
    const ch = chunks.find((c) => c.articleId === id)
    if (ch) {
      cited.push({
        articleId: ch.articleId,
        documentTitle: ch.documentTitle,
        articleLabel: ch.articleNumber ? `Статья ${ch.articleNumber}` : ch.heading,
        excerpt: ch.heading
      })
    }
  }
  return cited
}
