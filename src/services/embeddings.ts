/**
 * Семантический поиск по статьям через эмбеддинги.
 * Хранение: таблица `article_embeddings` (BLOB Float32, little-endian) + `article_embeddings_dirty`.
 * Провайдер-агностичный клиент: OpenAI / OpenAI-compatible (LM Studio / Groq / vLLM) / Ollama / Gemini.
 *
 * Эмбеддинги нормализуются по L2 при сохранении — для запроса считается косинус = dot product.
 */

import { createHash } from 'crypto'
import type { Database } from 'better-sqlite3'
import type {
  AiEmbeddingsConfig,
  AiEmbeddingsProgress,
  AiEmbeddingsStatus,
  AiProviderConfig
} from '../shared/types'

/** Текст, по которому считается эмбеддинг для статьи (heading + summary + начало body). */
const ARTICLE_BODY_SLICE = 1500

/** Размер пачки для запроса embeddings (OpenAI допускает большие батчи; LM Studio/Ollama лучше скромнее). */
const DEFAULT_BATCH_SIZE = 64

/** Тайм-аут одного embed-запроса (мс). Без него зависший локальный сервер блокировал бы UI ребилда. */
const EMBED_REQUEST_TIMEOUT_MS = 60_000

/** Канонические дефолтные модели по типу провайдера — подставляются в UI как hint. */
export const DEFAULT_EMBEDDING_MODELS: Record<
  NonNullable<AiEmbeddingsConfig['provider']>,
  string
> = {
  openai: 'text-embedding-3-small',
  openai_compatible: 'text-embedding-nomic-embed-text-v1.5',
  ollama: 'nomic-embed-text',
  gemini: 'text-embedding-004'
}

/**
 * Эффективный конфиг embeddings: учитывает «наследовать от основного провайдера».
 * Бросает при конфликте (например, Anthropic не имеет /embeddings).
 */
export function resolveEmbeddingsCfg(main: AiProviderConfig): {
  provider: NonNullable<AiEmbeddingsConfig['provider']>
  baseUrl: string | undefined
  apiKey: string | undefined
  model: string
  enabled: boolean
} {
  const e = main.embeddings
  if (!e || !e.enabled) {
    return {
      provider: 'openai',
      baseUrl: undefined,
      apiKey: undefined,
      model: '',
      enabled: false
    }
  }

  let provider: NonNullable<AiEmbeddingsConfig['provider']>
  let baseUrl: string | undefined
  let apiKey: string | undefined

  if (e.inheritFromMain) {
    if (main.provider === 'anthropic') {
      throw new Error(
        'Anthropic не имеет /embeddings. Снимите «Наследовать от основного провайдера» и укажите OpenAI / Ollama / LM Studio для эмбеддингов.'
      )
    }
    provider = main.provider
    baseUrl = main.baseUrl
    apiKey = main.apiKey
  } else {
    provider = e.provider ?? 'openai'
    baseUrl = e.baseUrl
    apiKey = e.apiKey
  }

  const model = (e.model ?? '').trim() || DEFAULT_EMBEDDING_MODELS[provider]
  return { provider, baseUrl, apiKey, model, enabled: true }
}

/** Хеш «исходника» для статьи: меняется → пересчёт; такой же → пропускаем. */
export function articleSourceHash(input: {
  heading: string
  articleNumber: string | null
  summaryShort: string | null
  bodyClean: string
  documentTitle: string
}): string {
  const text = [
    input.documentTitle.trim(),
    input.articleNumber?.trim() ?? '',
    input.heading.trim(),
    input.summaryShort?.trim() ?? '',
    input.bodyClean.slice(0, ARTICLE_BODY_SLICE)
  ].join('\n')
  return createHash('sha1').update(text).digest('hex')
}

export function articleEmbeddingInputText(input: {
  heading: string
  articleNumber: string | null
  summaryShort: string | null
  penaltyHint: string | null
  bodyClean: string
  documentTitle: string
}): string {
  const num = input.articleNumber?.trim()
  const titleLine = num ? `Статья ${num} — ${input.heading.trim()}` : input.heading.trim()
  const parts: string[] = [
    `Документ: ${input.documentTitle.trim()}`,
    titleLine
  ]
  const sum = input.summaryShort?.trim()
  if (sum) parts.push(`Кратко: ${sum}`)
  const pen = input.penaltyHint?.trim()
  if (pen) parts.push(`Санкция: ${pen}`)
  const body = input.bodyClean.trim().slice(0, ARTICLE_BODY_SLICE)
  if (body) parts.push(body)
  return parts.join('\n')
}

function l2Normalize(v: Float32Array): Float32Array {
  let s = 0
  for (let i = 0; i < v.length; i++) {
    const x = v[i] ?? 0
    s += x * x
  }
  const n = Math.sqrt(s)
  if (!isFinite(n) || n < 1e-12) return v
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = (v[i] ?? 0) / n
  return out
}

function vectorToBuffer(v: Float32Array): Buffer {
  // Float32Array little-endian (x86/ARM little — стандарт). Копируем для безопасности.
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

function bufferToVector(buf: Buffer | Uint8Array, dim: number): Float32Array {
  // SQLite BLOB через better-sqlite3 приходит как Buffer. Делаем копию, иначе байт-аллигнмент может упасть.
  const out = new Float32Array(dim)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  for (let i = 0; i < dim; i++) {
    out[i] = view.getFloat32(i * 4, true)
  }
  return out
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0)
  return s
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Запрос эмбеддингов для массива текстов.
 * Возвращает массив того же размера; элемент null — провайдер не справился (порядок сохраняется).
 */
export async function embedTexts(
  cfg: AiProviderConfig,
  texts: string[]
): Promise<Float32Array[]> {
  if (texts.length === 0) return []
  const e = resolveEmbeddingsCfg(cfg)
  if (!e.enabled || !e.model) {
    throw new Error('Семантический поиск отключён. Включите embeddings во вкладке «Семантический поиск».')
  }

  if (e.provider === 'gemini') {
    const out: Float32Array[] = []
    for (const text of texts) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        e.model
      )}:embedContent?key=${encodeURIComponent(e.apiKey ?? '')}`
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: { parts: [{ text }] } })
        },
        EMBED_REQUEST_TIMEOUT_MS
      )
      if (!res.ok) {
        const detail = await safeReadErrorBody(res)
        throw new Error(`Gemini embeddings: ${res.status}${detail ? ` — ${detail}` : ''}`)
      }
      const j = (await res.json()) as { embedding?: { values?: number[] } }
      const vals = j.embedding?.values
      if (!Array.isArray(vals) || !vals.length) {
        throw new Error('Gemini embeddings: пустой ответ.')
      }
      out.push(l2Normalize(Float32Array.from(vals)))
    }
    return out
  }

  if (e.provider === 'ollama') {
    const base = (e.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '')
    // Современный Ollama умеет пакеты через /api/embed; если нет — graceful по одной.
    const out: Float32Array[] = []
    for (const text of texts) {
      const res = await fetchWithTimeout(
        `${base}/api/embeddings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: e.model, prompt: text })
        },
        EMBED_REQUEST_TIMEOUT_MS
      )
      if (!res.ok) {
        const detail = await safeReadErrorBody(res)
        throw new Error(`Ollama embeddings: ${res.status}${detail ? ` — ${detail}` : ''}`)
      }
      const j = (await res.json()) as { embedding?: number[] }
      const vals = j.embedding
      if (!Array.isArray(vals) || !vals.length) {
        throw new Error('Ollama embeddings: пустой embedding в ответе. Проверьте, что модель поддерживает embeddings.')
      }
      out.push(l2Normalize(Float32Array.from(vals)))
    }
    return out
  }

  // OpenAI и совместимые: один запрос — батч из массива input.
  const url =
    e.provider === 'openai_compatible'
      ? `${(e.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/embeddings`
      : 'https://api.openai.com/v1/embeddings'

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (e.apiKey) headers['Authorization'] = `Bearer ${e.apiKey}`

  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: e.model, input: texts })
    },
    EMBED_REQUEST_TIMEOUT_MS
  )
  if (!res.ok) {
    const detail = await safeReadErrorBody(res)
    if (res.status === 404 && e.provider === 'openai_compatible') {
      throw new Error(
        `OpenAI-compatible embeddings: 404 на ${url}. В LM Studio включите «Embedding model» в Server tab; в vLLM/Groq убедитесь, что у выбранной модели есть /embeddings.${
          detail ? ` Подробности: ${detail}` : ''
        }`
      )
    }
    throw new Error(`Embeddings HTTP ${res.status}${detail ? ` — ${detail}` : ''}`)
  }
  const j = (await res.json()) as { data?: { embedding?: number[]; index?: number }[] }
  const data = j.data
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error(`Embeddings: длина ответа ${data?.length ?? '?'} ≠ ${texts.length}`)
  }
  // OpenAI гарантирует порядок, но для совместимости пересортируем по index, если он есть.
  const sorted = [...data].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0)
  )
  return sorted.map((d) => {
    if (!Array.isArray(d.embedding)) {
      throw new Error('Embeddings: элемент без поля embedding.')
    }
    return l2Normalize(Float32Array.from(d.embedding))
  })
}

async function safeReadErrorBody(res: Response): Promise<string> {
  try {
    const t = await res.text()
    return t.replace(/\s+/g, ' ').slice(0, 500)
  } catch {
    return ''
  }
}

/* ========================== Индекс ========================== */

interface ArticleSourceRow {
  id: string
  document_id: string
  document_title: string
  heading: string
  article_number: string | null
  body_clean: string
  summary_short: string | null
  penalty_hint: string | null
}

function loadArticleSources(db: Database, ids: string[]): ArticleSourceRow[] {
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT a.id, a.document_id, d.title AS document_title, a.heading, a.article_number,
              a.body_clean, a.summary_short, a.penalty_hint
       FROM articles a JOIN documents d ON d.id = a.document_id
       WHERE a.id IN (${placeholders})`
    )
    .all(...ids) as ArticleSourceRow[]
}

/** Какие статьи нужно реально пересчитать в текущий ребилд (учёт смены модели и dirty-флага). */
function pickArticleIdsForRebuild(db: Database, model: string): string[] {
  const rows = db
    .prepare(
      `SELECT a.id FROM articles a
       LEFT JOIN article_embeddings e ON e.article_id = a.id
       LEFT JOIN article_embeddings_dirty d ON d.article_id = a.id
       WHERE e.article_id IS NULL                 -- ещё нет вектора
          OR e.model != ?                          -- сменили модель
          OR d.article_id IS NOT NULL              -- помечено триггером как изменённое
       ORDER BY a.document_id, a.sort_order`
    )
    .all(model) as { id: string }[]
  return rows.map((r) => r.id)
}

export interface RebuildEmbeddingsOptions {
  /** Сигнал отмены: при срабатывании ребилд завершится после текущей пачки и вернёт processed. */
  isCancelled: () => boolean
  /** Колбэк прогресса; вызывается между пачками. */
  onProgress: (p: AiEmbeddingsProgress) => void
  batchSize?: number
}

/** Пересчёт эмбеддингов «грязных» статей пачками. Возвращает финальный отчёт. */
export async function rebuildArticleEmbeddings(
  db: Database,
  cfg: AiProviderConfig,
  opts: RebuildEmbeddingsOptions
): Promise<AiEmbeddingsProgress> {
  const e = resolveEmbeddingsCfg(cfg)
  if (!e.enabled) {
    const r: AiEmbeddingsProgress = {
      phase: 'error',
      processed: 0,
      total: 0,
      message: 'Семантический поиск отключён.'
    }
    opts.onProgress(r)
    return r
  }

  const ids = pickArticleIdsForRebuild(db, e.model)
  const total = ids.length
  if (total === 0) {
    const r: AiEmbeddingsProgress = { phase: 'done', processed: 0, total: 0 }
    opts.onProgress(r)
    return r
  }

  opts.onProgress({ phase: 'starting', processed: 0, total })

  const batchSize = Math.max(1, Math.min(256, opts.batchSize ?? DEFAULT_BATCH_SIZE))
  const upsert = db.prepare(
    `INSERT INTO article_embeddings (article_id, model, dim, vector, source_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(article_id) DO UPDATE SET
       model = excluded.model,
       dim = excluded.dim,
       vector = excluded.vector,
       source_hash = excluded.source_hash,
       updated_at = excluded.updated_at`
  )
  const clearDirty = db.prepare('DELETE FROM article_embeddings_dirty WHERE article_id = ?')

  let processed = 0
  for (let i = 0; i < ids.length; i += batchSize) {
    if (opts.isCancelled()) {
      const r: AiEmbeddingsProgress = { phase: 'cancelled', processed, total }
      opts.onProgress(r)
      return r
    }
    const slice = ids.slice(i, i + batchSize)
    const rows = loadArticleSources(db, slice)
    // Сохраним порядок по ids: даже если SQLite вернёт строки в другом порядке.
    const byId = new Map(rows.map((r) => [r.id, r]))
    const ordered = slice.map((id) => byId.get(id)).filter((r): r is ArticleSourceRow => Boolean(r))

    const texts = ordered.map((r) =>
      articleEmbeddingInputText({
        heading: r.heading,
        articleNumber: r.article_number,
        summaryShort: r.summary_short,
        penaltyHint: r.penalty_hint,
        bodyClean: r.body_clean,
        documentTitle: r.document_title
      })
    )
    let vectors: Float32Array[]
    try {
      vectors = await embedTexts(cfg, texts)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const r: AiEmbeddingsProgress = { phase: 'error', processed, total, message }
      opts.onProgress(r)
      return r
    }

    const now = new Date().toISOString()
    const tx = db.transaction(() => {
      ordered.forEach((row, idx) => {
        const v = vectors[idx]
        if (!v) return
        const buf = vectorToBuffer(v)
        const hash = articleSourceHash({
          heading: row.heading,
          articleNumber: row.article_number,
          summaryShort: row.summary_short,
          bodyClean: row.body_clean,
          documentTitle: row.document_title
        })
        upsert.run(row.id, e.model, v.length, buf, hash, now)
        clearDirty.run(row.id)
      })
    })
    tx()

    processed += ordered.length
    opts.onProgress({
      phase: 'embedding',
      processed,
      total,
      currentTitle: ordered[ordered.length - 1]?.heading
    })
  }

  const done: AiEmbeddingsProgress = { phase: 'done', processed, total }
  opts.onProgress(done)
  return done
}

/* ========================== Поиск ========================== */

export interface EmbeddingHit {
  articleId: string
  documentId: string
  documentTitle: string
  heading: string
  articleNumber: string | null
  /** Косинус (так как все нормализованы — в диапазоне [-1, 1], на практике [0, 1]). */
  score: number
}

/**
 * Top-K ближайших статей по косинусному расстоянию.
 * Загружает все векторы текущей модели в память — для типичной базы (≤ 50k статей × 768) это нормально.
 */
export async function semanticSearch(
  db: Database,
  cfg: AiProviderConfig,
  query: string,
  topK: number,
  options?: { tagIds?: string[]; excludeIds?: Set<string> }
): Promise<EmbeddingHit[]> {
  const e = resolveEmbeddingsCfg(cfg)
  if (!e.enabled || !e.model) return []
  const q = query.trim()
  if (!q) return []

  const queryEmbedding = (await embedTexts(cfg, [q]))[0]
  if (!queryEmbedding) return []

  const tagIds = options?.tagIds?.filter((id) => typeof id === 'string' && id.trim().length > 0) ?? []
  const tagFilter = tagIds.length
    ? ` AND a.id IN (SELECT article_id FROM article_tag_assignments WHERE tag_id IN (${tagIds.map(() => '?').join(', ')}))`
    : ''

  const rows = db
    .prepare(
      `SELECT e.article_id, e.dim, e.vector,
              a.document_id, a.heading, a.article_number,
              d.title AS document_title
       FROM article_embeddings e
       JOIN articles a ON a.id = e.article_id
       JOIN documents d ON d.id = a.document_id
       WHERE e.model = ?${tagFilter}`
    )
    .all(e.model, ...tagIds) as {
    article_id: string
    dim: number
    vector: Buffer | Uint8Array
    document_id: string
    heading: string
    article_number: string | null
    document_title: string
  }[]

  const exclude = options?.excludeIds
  const hits: EmbeddingHit[] = []
  for (const r of rows) {
    if (exclude?.has(r.article_id)) continue
    if (r.dim !== queryEmbedding.length) continue
    const v = bufferToVector(r.vector as Buffer, r.dim)
    const score = dotProduct(v, queryEmbedding)
    hits.push({
      articleId: r.article_id,
      documentId: r.document_id,
      documentTitle: r.document_title,
      heading: r.heading,
      articleNumber: r.article_number,
      score
    })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, Math.max(1, topK))
}

/* ========================== Статус ========================== */

export function getEmbeddingsStatus(db: Database, cfg: AiProviderConfig): AiEmbeddingsStatus {
  const total = (db.prepare('SELECT COUNT(*) AS c FROM articles').get() as { c: number }).c
  const indexed = (db.prepare('SELECT COUNT(*) AS c FROM article_embeddings').get() as { c: number }).c
  const dirty = (db.prepare('SELECT COUNT(*) AS c FROM article_embeddings_dirty').get() as { c: number }).c

  let mismatch = 0
  let currentModel: string | null = null
  let currentDim: number | null = null
  let lastBuiltAt: string | null = null

  const e = cfg.embeddings
  if (e?.enabled) {
    let model = ''
    try {
      model = resolveEmbeddingsCfg(cfg).model
    } catch {
      /* при невозможном конфиге показываем индекс как есть */
    }
    if (model) {
      mismatch = (
        db
          .prepare('SELECT COUNT(*) AS c FROM article_embeddings WHERE model != ?')
          .get(model) as { c: number }
      ).c
      currentModel = model
    }
  }

  // Текущая модель индекса (последняя по обновлению), если конфиг не задан.
  const head = db
    .prepare('SELECT model, dim, updated_at FROM article_embeddings ORDER BY updated_at DESC LIMIT 1')
    .get() as { model: string; dim: number; updated_at: string } | undefined
  if (head) {
    if (!currentModel) currentModel = head.model
    currentDim = head.dim
    lastBuiltAt = head.updated_at
  }

  return {
    totalArticles: total,
    indexedArticles: indexed,
    dirtyArticles: dirty,
    modelMismatch: mismatch,
    currentModel,
    currentDim,
    lastBuiltAt,
    enabled: Boolean(e?.enabled)
  }
}

export function clearEmbeddingsIndex(db: Database): void {
  const tx = db.transaction(() => {
    db.exec('DELETE FROM article_embeddings')
    db.exec('DELETE FROM article_embeddings_dirty')
    db.exec(
      `INSERT INTO article_embeddings_dirty(article_id, marked_at) SELECT id, datetime('now') FROM articles`
    )
  })
  tx()
}
