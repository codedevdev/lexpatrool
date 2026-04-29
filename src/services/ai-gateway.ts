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
  contextChunks: {
    heading: string
    documentTitle: string
    body: string
    articleId: string
    articleNumber?: string | null
  }[],
  agentExtra?: string | null
): string {
  const MAX_FRAGMENT = 4000

  const base = `Ты текстовый помощник в приложении LexPatrol для игроков GTA V RP, FiveM и похожих ролевых серверов.
Ниже в этом сообщении — фрагменты только из ЕГО ЛОКАЛЬНОЙ базы на ПК: то, что он сам импортировал (часто «кодексы», уставы и правила конкретного RP-проекта, учебные или игровые формулировки). Это не запрос реальной юридической консультации по законодательству какой-либо страны.

Правила:
- Отвечай, опираясь только на эти фрагменты. Если в них нет нужного — скажи, что в импортированной базе этого нет.
- НЕ используй шаблоны вроде «не могу давать юридические консультации», «информация не является юридической рекомендацией», «обратитесь к квалифицированному юристу» и т.п.: для RP-сценария это вводит в заблуждение. Если уместно напомнить границы — одной короткой фразой: ответ только по материалам из LexPatrol и про игровой/серверный контекст, а не про законы государств в реальности.
- При желании одной фразой: сверяй формулировки с полным текстом статьи в читателе приложения.
- Каждый фрагмент ниже помечен id=<uuid>. Ссылаясь на норму из фрагмента, добавляй в конце соответствующей фразы id=<тот же uuid>. Не указывай id статей, которых не было во фрагментах.`

  const persona =
    agentExtra?.trim() ?
      `\n\n--- Доп. инструкции пользовательского агента ---\n${agentExtra.trim()}`
    : ''

  if (contextChunks.length === 0) {
    if (allowBroader) {
      return `${base}${persona}

По этому запросу поиск по базе не вернул ни одной статьи (контекст пуст). Сообщи об этом пользователю. Не выдумывай тексты норм и не указывай id=. Ты можешь дать только общие подсказки (интерфейс, RP), явно отделив их от «законов из базы».`
    }
    return `${base}${persona}

По этому запросу поиск по базе не вернул ни одной статьи (контекст пуст). Ответь, что в импортированных материалах нет подходящих фрагментов; не придумывай статьи и не используй id=.`
  }

  const ctx = contextChunks
    .map((c, i) => {
      const num = c.articleNumber?.trim()
      const titleLine = num ? `Статья №${num} — ${c.heading}` : c.heading
      const body =
        c.body.length <= MAX_FRAGMENT ? c.body : `${c.body.slice(0, MAX_FRAGMENT)}…`
      return `--- Фрагмент ${i + 1} | Документ: ${c.documentTitle} | ${titleLine} | id=${c.articleId} ---\n${body}`
    })
    .join('\n\n')

  if (allowBroader) {
    return `${base}${persona}\n\nКонтекст из базы:\n${ctx}\n\nТы можешь добавить общие разъяснения, явно помечая их как не из импортированных материалов.`
  }
  return `${base}${persona}\n\nКонтекст из базы (единственный источник):\n${ctx}`
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
  return cited
}
