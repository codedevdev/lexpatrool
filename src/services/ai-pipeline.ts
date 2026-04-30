/**
 * Конвейер ответа ИИ:
 *  1. (опц.) LLM-планировщик: переписывает вопрос в поисковую форму (ключевые темы, кодексы, номера статей, intent).
 *  2. Гибридный retrieval: keyword (FTS + LIKE + article-num) + embeddings (cosine) + pinned из истории чата.
 *     Слияние через Reciprocal Rank Fusion.
 *  3. (опц.) LLM-реранкер: оставляет 8–12 самых релевантных фрагментов.
 *  4. Финальный completeChat с ситуационным системным промптом.
 *
 * Все опциональные стадии падают gracefully на простой keyword-поиск, как раньше.
 */

import type { Database } from 'better-sqlite3'
import type {
  AiCitation,
  AiPipelineReport,
  AiProviderConfig,
  AiRetrievalHit,
  AiRetrievalSource
} from '../shared/types'
import {
  type AiAnswerIntent,
  type AiMessage,
  buildSystemPrompt,
  completeChat,
  completeJson,
  parseCitationsFromAnswer
} from './ai-gateway'
import {
  type FtsRow,
  type KeywordCandidate,
  loadArticleRowsByIds,
  retrieveKeywordCandidates,
  rowToPromptChunk,
  rowToShortSnippet
} from './retrieval'
import { semanticSearch } from './embeddings'
import { parseArticleNumbersFromQuery } from '../shared/article-number'
import {
  codexHintRootsForCanonicalKeys,
  documentTitleMatchesCodexRoots,
  extractCodexCanonicalKeys,
  extractCodexHintRoots
} from '../shared/legal-code-abbrev'

export interface RunAiPipelineInput {
  db: Database
  cfg: AiProviderConfig
  agentExtra: string
  /** Текущий вопрос пользователя (без обрамления). */
  question: string
  /** Предыдущие реплики только для chat-режима (без текущего вопроса). */
  history?: { role: 'user' | 'assistant'; content: string }[]
  /** Принудительно подцепить эти статьи (например, из citations прошлых ответов чата). */
  pinnedArticleIds?: string[]
  /** Не подмешивать вот эти id (пользователь снял закреп). */
  excludePinnedIds?: string[]
}

export interface RunAiPipelineResult {
  text: string
  citations: AiCitation[]
  notice: string | null
  retrieved: AiRetrievalHit[]
  pipeline: AiPipelineReport
}

/** Сколько кандидатов берём из каждого источника и сколько фрагментов идёт в финальный промпт. */
const KEYWORD_TOPK = 30
const EMBEDDING_TOPK = 30
const FINAL_CONTEXT_LIMIT = 12
const RERANK_INPUT_LIMIT = 24
const RERANK_OUTPUT = 10

/** Reciprocal Rank Fusion — стандартный k=60 даёт мягкое слияние. */
const RRF_K = 60

interface ScoredRow {
  row: FtsRow
  score: number
  sources: Set<AiRetrievalSource>
  /** Лучший rank по любому источнику (для тай-брейкера). */
  bestRank: number
}

/** Главный вход. */
export async function runAiPipeline(input: RunAiPipelineInput): Promise<RunAiPipelineResult> {
  const { db, cfg, agentExtra, question, history = [] } = input
  const trimmed = question.trim()

  const exclude = new Set((input.excludePinnedIds ?? []).filter(Boolean))
  const pinnedIds = (input.pinnedArticleIds ?? []).filter((id) => id && !exclude.has(id))

  const pipeline: AiPipelineReport = {
    searchQuery: trimmed,
    stages: { planner: 'off', embeddings: 'off', rerank: 'off' },
    counts: { keyword: 0, embedding: 0, pinned: 0, finalContext: 0 }
  }

  // ---------- 1. Planner ----------
  const plannerEnabled = cfg.pipeline?.plannerEnabled !== false
  let intent: AiAnswerIntent = guessHeuristicIntent(trimmed)
  if (plannerEnabled) {
    pipeline.stages.planner = 'on'
    try {
      const plan = await runPlanner(cfg, history, trimmed)
      if (plan) {
        if (plan.searchQuery && plan.searchQuery.length > 0) {
          pipeline.searchQuery = plan.searchQuery
        }
        if (plan.intent) intent = plan.intent
        pipeline.intent = plan.intent ?? intent
        pipeline.plannerKeywords = plan.keywords
        pipeline.plannerArticleNumbers = plan.articleNumbers
        pipeline.plannerCodexHints = plan.codexHints
      } else {
        pipeline.stages.planner = 'failed'
      }
    } catch {
      pipeline.stages.planner = 'failed'
    }
  } else {
    pipeline.intent = intent
  }
  if (!pipeline.intent) pipeline.intent = intent

  const keysCurrentTurn = extractCodexCanonicalKeys([
    trimmed,
    ...(pipeline.plannerCodexHints ?? [])
  ])
  const userNamedCodexInMessage = extractCodexCanonicalKeys(trimmed).length > 0

  // ---------- 2. Hybrid retrieval ----------
  const queryForRetrieval = combineRetrievalQuery(trimmed, history, pipeline, {
    skipTailUserMessages: userNamedCodexInMessage
  })
  const articleNumberQueryForRetrieval =
    keysCurrentTurn.length > 0
      ? dedupeRetrievalParts([
          trimmed,
          pipeline.searchQuery && pipeline.searchQuery.trim() !== trimmed ? pipeline.searchQuery.trim() : ''
        ])
      : undefined
  const candidates = retrieveKeywordCandidates(db, queryForRetrieval, {
    limit: KEYWORD_TOPK,
    ...(articleNumberQueryForRetrieval
      ? { articleNumberQuery: articleNumberQueryForRetrieval }
      : {})
  })
  pipeline.counts.keyword = candidates.length

  // Pinned: догружаем строки и встраиваем как «нулевой» rank (приоритет на финальное место).
  const pinnedRows = pinnedIds.length ? loadArticleRowsByIds(db, pinnedIds) : new Map<string, FtsRow>()
  pipeline.counts.pinned = pinnedRows.size

  let embeddingHits: { articleId: string; score: number }[] = []
  const embeddingsEnabled = Boolean(cfg.embeddings?.enabled)
  if (embeddingsEnabled) {
    try {
      const hits = await semanticSearch(db, cfg, queryForRetrieval, EMBEDDING_TOPK)
      pipeline.stages.embeddings = hits.length === 0 ? 'unavailable' : 'on'
      embeddingHits = hits.map((h) => ({ articleId: h.articleId, score: h.score }))
      pipeline.counts.embedding = embeddingHits.length
    } catch {
      pipeline.stages.embeddings = 'failed'
    }
  }

  // ---------- 2b. Слияние через RRF ----------
  let merged = mergeCandidates(db, {
    keyword: candidates,
    embedding: embeddingHits,
    pinnedRows
  })

  // ---------- 2c. Жёсткий фильтр по кодексу (если пользователь явно его назвал) ----------
  // Цель: на «Процессуальный кодекс ст. 8.1» не выдавать УК 8.1, даже если он сильнее по BM25.
  // Pinned-статьи всегда уважаем — пользователь сам их закрепил.
  const codexHintsConversation = [
    ...(pipeline.plannerCodexHints ?? []),
    trimmed,
    ...history.filter((m) => m.role === 'user').slice(-2).map((m) => m.content)
  ].filter(Boolean)
  const codexRoots =
    keysCurrentTurn.length > 0
      ? codexHintRootsForCanonicalKeys(keysCurrentTurn)
      : extractCodexHintRoots(codexHintsConversation)
  if (keysCurrentTurn.length > 0) {
    pipeline.codexScope = 'current'
  } else if (codexRoots.length > 0) {
    pipeline.codexScope = 'conversation'
  }
  if (codexRoots.length) {
    const matched = merged.filter(
      (m) =>
        pinnedRows.has(m.row.article_id) ||
        documentTitleMatchesCodexRoots(m.row.document_title, codexRoots)
    )
    // Применяем фильтр, если осталось хоть что-то ОТ ИСКОМОГО кодекса (а не только пины),
    // иначе откатываемся: лучше дать менее точный ответ, чем пустой.
    const matchedNonPinned = matched.filter((m) => !pinnedRows.has(m.row.article_id))
    if (matchedNonPinned.length >= 1) {
      merged = matched
      pipeline.codexHintsApplied = codexRoots
      pipeline.codexFilterApplied = true
    } else {
      pipeline.codexHintsApplied = codexRoots
      pipeline.codexFilterApplied = false
    }
  }

  // Если совсем пусто и pinned тоже нет — делаем «пустой контекст» путь.
  if (merged.length === 0) {
    return finalizeAnswerWithEmptyContext(input, pipeline)
  }

  // ---------- 3. Rerank ----------
  const rerankEnabled = cfg.pipeline?.rerankEnabled !== false && merged.length > FINAL_CONTEXT_LIMIT
  let chosen: ScoredRow[] = merged.slice(0, FINAL_CONTEXT_LIMIT)
  if (rerankEnabled) {
    pipeline.stages.rerank = 'on'
    try {
      const ranked = await runReranker(cfg, trimmed, merged.slice(0, RERANK_INPUT_LIMIT), codexRoots)
      if (ranked && ranked.length >= 3) {
        const idMap = new Map(merged.map((m) => [m.row.article_id, m]))
        const orderedSelected: ScoredRow[] = []
        for (const id of ranked) {
          const m = idMap.get(id)
          if (!m) continue
          m.sources.add('rerank-llm')
          orderedSelected.push(m)
          if (orderedSelected.length >= RERANK_OUTPUT) break
        }
        if (orderedSelected.length >= 3) chosen = orderedSelected
      } else if (!ranked || ranked.length === 0) {
        pipeline.stages.rerank = 'failed'
      }
    } catch {
      pipeline.stages.rerank = 'failed'
    }
  }

  // Pinned гарантированно остаются в финальном контексте.
  for (const id of pinnedRows.keys()) {
    if (chosen.find((c) => c.row.article_id === id)) continue
    const row = pinnedRows.get(id)
    if (!row) continue
    chosen.push({
      row,
      score: 0.001,
      sources: new Set<AiRetrievalSource>(['chat-pinned']),
      bestRank: 999
    })
    if (chosen.length >= FINAL_CONTEXT_LIMIT + 4) break
  }

  // ---------- 4. Финальный ответ ----------
  pipeline.counts.finalContext = chosen.length

  const intentForPrompt = pipeline.intent ?? intent
  const wantsFullArticleBody =
    intentForPrompt === 'lookup' || parseArticleNumbersFromQuery(trimmed).length > 0

  const promptChunks = chosen.map((c, i) =>
    rowToPromptChunk(db, c.row, queryForRetrieval, {
      articleBodyMode: wantsFullArticleBody && i < 3 ? 'full' : 'snippet'
    })
  )
  const sys = buildSystemPrompt(
    Boolean(cfg.allowBroaderContext),
    promptChunks.map((c) => ({
      heading: c.heading,
      documentTitle: c.documentTitle,
      body: c.body,
      articleId: c.articleId,
      articleNumber: c.articleNumber
    })),
    agentExtra,
    {
      intent: pipeline.intent ?? intent,
      situationalEnabled: cfg.pipeline?.situationalPrompt !== false
    }
  )

  const wrappedUser = `Вопрос:\n${trimmed}\n\nСледуй системному сообщению. Где опираешься на фрагмент из контекста — укажи id=<uuid> из заголовка этого фрагмента.`

  const messages: AiMessage[] = [{ role: 'system', content: sys }]
  for (const m of history) {
    messages.push({ role: m.role, content: m.content })
  }
  messages.push({ role: 'user', content: wrappedUser })

  const result = await completeChat(cfg, messages)

  const citations = parseCitationsFromAnswer(
    result.text,
    promptChunks.map((c) => ({
      articleId: c.articleId,
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      heading: c.heading,
      articleNumber: c.articleNumber
    }))
  )

  const retrieved: AiRetrievalHit[] = chosen.map((c) => ({
    articleId: c.row.article_id,
    documentId: c.row.document_id,
    documentTitle: c.row.document_title,
    articleNumber: c.row.article_number,
    heading: c.row.heading,
    score: clampScore(c.score),
    sources: [...c.sources],
    snippet: rowToShortSnippet(c.row, queryForRetrieval) || null
  }))

  return {
    text: result.text,
    citations,
    notice: result.notice ?? null,
    retrieved,
    pipeline
  }
}

/* ============================== helpers ============================== */

function clampScore(s: number): number {
  if (!isFinite(s)) return 0
  if (s < 0) return 0
  if (s > 1) return 1
  return s
}

function guessHeuristicIntent(q: string): AiAnswerIntent {
  if (!q) return 'general'
  const lower = q.toLowerCase()

  if (parseArticleNumbersFromQuery(q).length > 0) return 'lookup'
  if (/\bстать(я|и|е|ю|ёй)\b/i.test(q)) return 'lookup'

  const situationalMarkers = [
    /\bчто\s+(будет|грозит|положено|следует)\b/u,
    /\bкак(ое|ая|ое|ие)?\s+наказани/u,
    /\bкак(ое|ая)?\s+ответственн/u,
    /\bштраф\b/u,
    /\bесли\b.*\?$/u,
    /\bкак\s+(оформить|задержать|составить|выписать|провести)/u,
    /\bпроцедур\w*/u,
    /\bпорядок\b/u
  ]
  for (const re of situationalMarkers) {
    if (re.test(lower)) return 'situational'
  }

  return 'general'
}

function dedupeRetrievalParts(parts: string[]): string {
  const seen = new Set<string>()
  const dedup: string[] = []
  for (const p of parts) {
    const k = p.trim()
    if (!k) continue
    if (seen.has(k)) continue
    seen.add(k)
    dedup.push(k)
  }
  return dedup.join('\n\n')
}

function combineRetrievalQuery(
  current: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  pipeline: AiPipelineReport,
  opts?: { skipTailUserMessages?: boolean }
): string {
  const parts: string[] = []
  if (pipeline.searchQuery && pipeline.searchQuery !== current) {
    parts.push(pipeline.searchQuery)
  }
  if (history.length && !opts?.skipTailUserMessages) {
    const tailUser = history
      .filter((m) => m.role === 'user')
      .slice(-2)
      .map((m) => m.content.trim())
      .filter((s) => s.length > 0)
    parts.push(...tailUser)
  }
  parts.push(current)

  return dedupeRetrievalParts(parts)
}

function mergeCandidates(
  db: Database,
  input: {
    keyword: KeywordCandidate[]
    embedding: { articleId: string; score: number }[]
    pinnedRows: Map<string, FtsRow>
  }
): ScoredRow[] {
  const map = new Map<string, ScoredRow>()

  // 1) keyword RRF.
  const keywordSourceLabel: Record<KeywordCandidate['source'], AiRetrievalSource> = {
    'article-num': 'article-num',
    fts: 'fts',
    like: 'fts',
    reference: 'fts',
    mention: 'fts'
  }

  input.keyword.forEach((c, i) => {
    const id = c.row.article_id
    const inc = 1 / (RRF_K + i + 1)
    const existing = map.get(id)
    if (existing) {
      existing.score += inc
      existing.sources.add(keywordSourceLabel[c.source])
      if (i < existing.bestRank) existing.bestRank = i
    } else {
      map.set(id, {
        row: c.row,
        score: inc,
        sources: new Set<AiRetrievalSource>([keywordSourceLabel[c.source]]),
        bestRank: i
      })
    }
  })

  // 2) embedding RRF — нужны строки для тех id, которых нет в keyword/pinned.
  const missingIds: string[] = []
  for (const h of input.embedding) {
    if (!map.has(h.articleId) && !input.pinnedRows.has(h.articleId)) {
      missingIds.push(h.articleId)
    }
  }
  const loadedExtra = missingIds.length ? loadArticleRowsByIds(db, missingIds) : new Map<string, FtsRow>()

  input.embedding.forEach((h, i) => {
    const inc = 1 / (RRF_K + i + 1)
    const existing = map.get(h.articleId)
    if (existing) {
      existing.score += inc
      existing.sources.add('embedding')
      if (i < existing.bestRank) existing.bestRank = i
      return
    }
    const pinnedRow = input.pinnedRows.get(h.articleId)
    if (pinnedRow) {
      // pinned добавим ниже; embedding-источник уже припишем здесь.
      return
    }
    const row = loadedExtra.get(h.articleId)
    if (!row) return
    map.set(h.articleId, {
      row,
      score: inc,
      sources: new Set<AiRetrievalSource>(['embedding']),
      bestRank: i
    })
  })

  // 3) pinned: гарантированный буст в самом верху.
  for (const [id, row] of input.pinnedRows.entries()) {
    const existing = map.get(id)
    if (existing) {
      existing.sources.add('chat-pinned')
      existing.score += 1 / (RRF_K + 1)
    } else {
      map.set(id, {
        row,
        score: 1 / (RRF_K + 1),
        sources: new Set<AiRetrievalSource>(['chat-pinned']),
        bestRank: 0
      })
    }
  }

  return [...map.values()].sort((a, b) => b.score - a.score || a.bestRank - b.bestRank)
}

/* ============================== Planner ============================== */

interface PlannerResult {
  searchQuery: string
  intent?: AiAnswerIntent
  keywords?: string[]
  articleNumbers?: string[]
  codexHints?: string[]
}

async function runPlanner(
  cfg: AiProviderConfig,
  history: { role: 'user' | 'assistant'; content: string }[],
  current: string
): Promise<PlannerResult | null> {
  const sys = `Ты помогаешь подготовить поисковый запрос по локальной базе кодексов и уставов RP-сервера GTA V / FiveM (LexPatrol).
Цель: вернуть JSON-объект, который описывает запрос пользователя в форме, удобной для FTS5 + семантического поиска по статьям.

Формат строго JSON, без пояснений и markdown-блоков. Поля:
{
  "searchQuery": "короткая поисковая фраза 3-12 слов на русском, ключевые термины из вопроса + RP-сленг → нормальные термины + аббревиатуры кодексов раскрыты",
  "intent": "lookup" | "situational" | "general",
  "keywords": ["..."],
  "articleNumbers": ["8.1", "12"],
  "codexHints": ["уголовный", "процессуальный", "административный", ...]
}

Правила:
- intent "lookup" — пользователь спрашивает про конкретную статью (есть номер или явная отсылка «статья N»).
- intent "situational" — описывает ситуацию ("что будет за …", "как оформить …", "какое наказание").
- intent "general" — всё остальное (вопрос про интерфейс, общий обзор и т.п.).
- searchQuery должен быть на русском и содержать ключевые СУЩЕСТВИТЕЛЬНЫЕ из вопроса. Расшифруй очевидные RP-термины: «копы» → «полиция», «зк» → «заключённый», «пк» → «процессуальный кодекс», «ук» → «уголовный».
- articleNumbers — все номера статей, упомянутые в вопросе (или пусто).
- codexHints — корни названий кодексов на русском, если очевидны: «уголовный», «процессуальный», «административный», «налоговый», «трудовой», «правила сервера», … (или пусто).
- Не выдумывай статьи и кодексы, которых нет в формулировке вопроса.
- Поля codexHints и articleNumbers заполняй только по **текущему** вопросу (последнее сообщение «Текущий вопрос пользователя»). Предыдущие реплики в диалоге — для понимания контекста, но не переноси из них кодекс или номер статьи, если в текущем вопросе пользователь явно переключился на другой кодекс или другую тему.
- Если не уверен — оставь поле пустым массивом или верни короткий searchQuery как есть.`

  const messages: AiMessage[] = [{ role: 'system', content: sys }]
  const userTail = history.filter((m) => m.role === 'user').slice(-2)
  for (const m of userTail) {
    messages.push({ role: 'user', content: m.content })
  }
  messages.push({
    role: 'user',
    content: `Текущий вопрос пользователя:\n${current}\n\nВерни ТОЛЬКО JSON по формату выше. Никакого текста до или после.`
  })

  const { value } = await completeJson<{
    searchQuery?: string
    intent?: string
    keywords?: unknown
    articleNumbers?: unknown
    codexHints?: unknown
  }>(cfg, messages, { maxTokens: 320, timeoutMs: 25_000 })

  if (!value || typeof value !== 'object') return null

  const intentRaw = typeof value.intent === 'string' ? value.intent : ''
  const intent: AiAnswerIntent | undefined =
    intentRaw === 'lookup' || intentRaw === 'situational' || intentRaw === 'general'
      ? intentRaw
      : undefined
  const searchQuery = typeof value.searchQuery === 'string' ? value.searchQuery.trim() : ''
  if (!searchQuery && !intent) return null

  return {
    searchQuery: searchQuery || current,
    intent,
    keywords: toStringArray(value.keywords),
    articleNumbers: toStringArray(value.articleNumbers),
    codexHints: toStringArray(value.codexHints)
  }
}

function toStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((s) => s.length > 0)
    .slice(0, 16)
}

/* ============================== Reranker ============================== */

async function runReranker(
  cfg: AiProviderConfig,
  question: string,
  candidates: ScoredRow[],
  codexRoots: string[] = []
): Promise<string[] | null> {
  if (candidates.length === 0) return null

  const items = candidates.map((c, i) => {
    const num = c.row.article_number?.trim()
    const title = num ? `Статья ${num} — ${c.row.heading}` : c.row.heading
    const sum = (c.row.summary_short ?? c.row.body_clean).trim().slice(0, 280).replace(/\s+/g, ' ')
    return `${i + 1}. id=${c.row.article_id} | ${c.row.document_title} | ${title}\n   ${sum}`
  })

  const codexNote = codexRoots.length
    ? `\nВажно: пользователь явно ограничил поиск кодексом (корни названия документа: ${codexRoots
        .map((r) => `"${r}"`)
        .join(
          ', '
        )}). Сначала бери статьи, чьё название документа содержит один из этих корней; статьи из других кодексов добавляй только если в указанном кодексе таких статей нет.`
    : ''

  const sys = `Ты выбираешь самые релевантные статьи под вопрос пользователя из базы LexPatrol.
Тебе дан список кандидатов. Верни JSON формата:
{ "ids": ["<uuid>", "<uuid>", ...] }
Правила:
- Не более 10 id, в порядке важности (важная — первая).
- ID копируй ровно как в строке "id=…" (uuid с дефисами, 36 символов).
- Игнорируй кандидатов, не имеющих отношения к вопросу.
- Если все кандидаты слабо релевантны — верни верхние 3.
- Никакого текста кроме JSON.${codexNote}`

  const user = `Вопрос:\n${question}\n\nКандидаты:\n${items.join('\n')}\n\nВерни JSON.`

  const { value } = await completeJson<{ ids?: unknown }>(
    cfg,
    [
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ],
    { maxTokens: 400, timeoutMs: 25_000 }
  )

  if (!value || typeof value !== 'object') return null
  if (!Array.isArray(value.ids)) return null
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of value.ids) {
    if (typeof raw !== 'string') continue
    const id = raw.trim().toLowerCase()
    if (!/^[a-f0-9-]{36}$/.test(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= 12) break
  }
  return out.length > 0 ? out : null
}

/* ============================== Empty context fallback ============================== */

async function finalizeAnswerWithEmptyContext(
  input: RunAiPipelineInput,
  pipeline: AiPipelineReport
): Promise<RunAiPipelineResult> {
  const { cfg, agentExtra, question, history = [] } = input
  const sys = buildSystemPrompt(Boolean(cfg.allowBroaderContext), [], agentExtra, {
    intent: pipeline.intent,
    situationalEnabled: cfg.pipeline?.situationalPrompt !== false
  })
  const wrappedUser = `Вопрос:\n${question.trim()}\n\nСледуй системному сообщению.`
  const messages: AiMessage[] = [{ role: 'system', content: sys }]
  for (const m of history) messages.push({ role: m.role, content: m.content })
  messages.push({ role: 'user', content: wrappedUser })
  const result = await completeChat(cfg, messages)
  return {
    text: result.text,
    citations: [],
    notice: result.notice ?? null,
    retrieved: [],
    pipeline: { ...pipeline, counts: { ...pipeline.counts, finalContext: 0 } }
  }
}
