export type SourceType =
  | 'forum_thread'
  | 'forum_section'
  | 'web_page'
  | 'paste_text'
  | 'paste_html'
  | 'markdown_file'
  | 'text_file'
  | 'pdf_file'
  | 'batch_list'

export interface SourceRecord {
  id: string
  title: string
  url: string | null
  source_type: SourceType
  imported_at: string
  refreshed_at: string | null
  tags_json: string
  category_id: string | null
  code_family: string | null
  revision: string | null
  metadata_json: string
  raw_html: string | null
  raw_text: string | null
  notes: string | null
}

export interface DocumentRecord {
  id: string
  source_id: string | null
  title: string
  slug: string | null
  created_at: string
  updated_at: string
  raw_html: string | null
  raw_text: string | null
  normalized_json: string | null
  category_id: string | null
}

export interface ArticleRecord {
  id: string
  document_id: string
  section_id: string | null
  parent_article_id: string | null
  article_number: string | null
  heading: string
  level: number
  sort_order: number
  body_clean: string
  body_raw: string | null
  path_json: string
  aliases_json: string
  is_pinned: number
  favorite: number
}

/** Частичное обновление статьи из читателя / редактора. */
export interface ArticleUpdatePayload {
  id: string
  heading?: string
  article_number?: string | null
  body_clean?: string
  summary_short?: string | null
  penalty_hint?: string | null
  display_meta_json?: string
  /** Сбросить сохранённый текст «до обновления импорта» в читателе. */
  clearPreviousRevision?: boolean
}

export interface SearchHit {
  article_id: string
  document_id: string
  document_title: string
  heading: string
  article_number: string | null
  snippet: string
  rank: number
}

export interface CheatSheetRecord {
  id: string
  title: string
  body: string
  sort_order: number
  created_at?: string
  updated_at?: string
}

export interface CheatSheetSavePayload {
  id?: string
  title: string
  body: string
  sort_order?: number
}

export interface ArticleCollectionRecord {
  id: string
  name: string
  description: string | null
  sort_order: number
  created_at?: string
  article_count?: number
}

export interface ArticleCollectionSavePayload {
  id?: string
  name: string
  description?: string | null
  sort_order?: number
}

export interface CollectionArticleRecord {
  id: string
  heading: string
  article_number: string | null
  body_clean?: string
  summary_short?: string | null
  penalty_hint?: string | null
  display_meta_json?: string | null
  document_id: string
  document_title: string
  document_article_import_filter?: string | null
  sort_order?: number
}

export interface BookmarkArticleRecord {
  id: string
  article_id: string
  created_at: string
  heading: string
  article_number: string | null
  document_id: string
  document_title: string
}

export interface UserNoteRecord {
  id: string
  article_id: string | null
  scenario_key: string | null
  title: string | null
  body: string
  updated_at: string
  article_heading: string | null
  article_number: string | null
  document_id: string | null
  document_title: string | null
}

export interface UserNoteSavePayload {
  id?: string
  article_id?: string | null
  scenario_key?: string | null
  title?: string | null
  body: string
}

export interface AiProviderConfig {
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'openai_compatible'
  baseUrl?: string
  apiKey?: string
  model: string
  temperature: number
  maxTokens: number
  allowBroaderContext?: boolean
  /**
   * Доп. этапы конвейера ИИ. По умолчанию включены — выключаются при слабых reasoning-моделях,
   * которые плохо возвращают JSON для planner / rerank.
   */
  pipeline?: {
    /** LLM переписывает вопрос пользователя в поисковую форму с учётом RP-сленга и аббревиатур кодексов. */
    plannerEnabled?: boolean
    /** LLM выбирает 8-12 наиболее релевантных фрагментов из 30 кандидатов гибридного retrieval. */
    rerankEnabled?: boolean
    /** Системный промпт «квалификация → норма → санкция → процесс» под ситуационные вопросы. */
    situationalPrompt?: boolean
  }
  /**
   * Семантический поиск по статьям через embeddings. Хранятся локально в SQLite, считаются по запросу
   * пользователя («Перестроить индекс»). Не нужно для базовой работы — гибрид FTS+эмбеддинги дороже,
   * но даёт «по смыслу».
   */
  embeddings?: AiEmbeddingsConfig
}

export interface AiEmbeddingsConfig {
  enabled: boolean
  /** Если undefined — наследуется от основного провайдера (provider/baseUrl/apiKey). */
  inheritFromMain?: boolean
  provider?: 'openai' | 'openai_compatible' | 'ollama' | 'gemini'
  baseUrl?: string
  apiKey?: string
  /** Имя модели embeddings (text-embedding-3-small, nomic-embed-text, …) */
  model: string
  /** Размерность последнего успешно построенного индекса (для проверки совместимости). */
  lastBuiltDim?: number | null
  lastBuiltModel?: string | null
  lastBuiltAt?: string | null
}

/**
 * Пользовательский ИИ-агент (роль): имя, описание и доп. промпт.
 * Поля провайдера в БД оставлены для совместимости; приложение использует только общие настройки из `AiProviderConfig`.
 */
export interface AiAgentRecord {
  id: string
  name: string
  description: string | null
  system_prompt_extra: string
  temperature: number | null
  max_tokens: number | null
  model: string | null
  provider: string | null
  base_url: string | null
  api_key: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface AiCompletePayload {
  cfg: AiProviderConfig
  question: string
  agentId?: string | null
}

/** Предыдущие реплики диалога без текущего сообщения пользователя (только user | assistant). */
export interface AiChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiChatTurnPayload {
  cfg: AiProviderConfig
  agentId?: string | null
  history: AiChatHistoryMessage[]
  message: string
  /**
   * Принудительно подцепить эти статьи в контекст retrieval (например, всё, что уже цитировалось в диалоге).
   * Источник пометится `chat-pinned` в `AiRetrievalReport`.
   */
  pinnedArticleIds?: string[]
  /** Снять закреп пользователем — id из этого списка не подмешиваются принудительно. */
  excludePinnedIds?: string[]
}

/** Источник, по которому статья попала в финальный контекст ИИ. */
export type AiRetrievalSource =
  | 'fts'
  | 'embedding'
  | 'article-num'
  | 'chat-pinned'
  | 'rerank-llm'

/** Описание одной попавшей в контекст статьи (для прозрачности UI «Что нашлось в базе»). */
export interface AiRetrievalHit {
  articleId: string
  documentId: string
  documentTitle: string
  articleNumber: string | null
  heading: string
  /** Объединённый score после слияния (0..1). */
  score: number
  /** Все источники, выдавшие эту статью (FTS и embeddings и т.д.). */
  sources: AiRetrievalSource[]
  /** Краткая выдержка для подсказки в UI. */
  snippet: string | null
}

/** Дебаг-метаданные конвейера: что планировщик подумал, какие методы сработали. */
export interface AiPipelineReport {
  /** Итоговая поисковая фраза (после planner или сырая). */
  searchQuery: string
  /** Что использовал planner (если включён): ключевые темы, кодексы, номера. */
  plannerKeywords?: string[]
  plannerArticleNumbers?: string[]
  plannerCodexHints?: string[]
  /** lookup — пользователь спрашивает про конкретную статью; situational — сценарий «что будет за X». */
  intent?: 'lookup' | 'situational' | 'general'
  /** Какие стадии реально отработали. */
  stages: {
    planner: 'on' | 'off' | 'failed'
    embeddings: 'on' | 'off' | 'unavailable' | 'failed'
    rerank: 'on' | 'off' | 'failed'
  }
  /** Сколько кандидатов получили на каждом этапе. */
  counts: {
    keyword: number
    embedding: number
    pinned: number
    finalContext: number
  }
  /** Корни названий кодексов, по которым пытались отсечь чужие документы (например, ["процессуальн"]). */
  codexHintsApplied?: string[]
  /**
   * true — фильтр кодекса реально сработал (нашлось хоть что-то в нужном кодексе);
   * false — пользователь назвал кодекс, но в нём не оказалось подходящих статей, и мы откатились на общий список.
   */
  codexFilterApplied?: boolean
  /**
   * current — корни кодекса и номера статей берутся только из текущего хода (вопрос + подсказки планировщика), без смешения с историей;
   * conversation — как раньше: в подсказках кодекса участвуют последние user-сообщения.
   */
  codexScope?: 'current' | 'conversation'
}

export interface AiCompleteResult {
  text: string
  citations: AiCitation[]
  notice?: string | null
  /** Полный список фрагментов, попавших в контекст модели — для панели «Что нашлось в базе». */
  retrieved?: AiRetrievalHit[]
  pipeline?: AiPipelineReport
}

/** Сохранённые диалоги ИИ (таблица ai_conversations). */
export interface AiConversationSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  provider: string | null
  model: string | null
  agent_id: string | null
}

/** Сообщение из БД (таблица ai_messages). */
export interface AiStoredChatMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  citations: AiCitation[] | null
  created_at: string
}

export interface AiChatCreatePayload {
  cfg: AiProviderConfig
  agentId?: string | null
  title?: string
}

export interface AiChatAppendTurnPayload {
  conversationId: string
  userContent: string
  assistantContent: string
  citations: AiCitation[]
  agentId?: string | null
}

export interface AiChatGetResult {
  conversation: AiConversationSummary
  messages: AiStoredChatMessage[]
}

export interface AiCitation {
  articleId: string
  documentId: string
  documentTitle: string
  articleLabel: string
  excerpt: string
}

/** Состояние семантического индекса: видно во вкладке «Семантический поиск». */
export interface AiEmbeddingsStatus {
  totalArticles: number
  indexedArticles: number
  dirtyArticles: number
  /** Несовпадение модели у части статей: переключили embedding-модель — нужно перестроить. */
  modelMismatch: number
  currentModel: string | null
  currentDim: number | null
  lastBuiltAt: string | null
  enabled: boolean
}

/** События прогресса при ai:embeddings:rebuild. */
export interface AiEmbeddingsProgress {
  phase: 'starting' | 'embedding' | 'done' | 'cancelled' | 'error'
  processed: number
  total: number
  /** Текущая обрабатываемая статья (для лога). */
  currentTitle?: string
  /** Только для phase=error/done. */
  message?: string
}

export interface ImportPayload {
  title: string
  url?: string
  sourceType: SourceType
  rawHtml?: string
  rawText?: string
  categoryId?: string
  codeFamily?: string
  tags?: string[]
  splitArticles?: boolean
  /**
   * После разбиения: все блоки | только с наказанием/штрафом/санкциями | только справочные без санкций.
   */
  articleFilter?: 'all' | 'with_sanctions' | 'without_sanctions'
}

/** Повторный импорт в существующий документ: обновляет источник и статьи, при смене текста сохраняет прошлую версию в полях previous_*. */
export type ReplaceDocumentImportPayload = ImportPayload & {
  documentId: string
}

/** CSS или XPath 1.0 (как в браузерном document.evaluate). */
export type DomSelectorKind = 'css' | 'xpath'

export interface DomSelector {
  kind: DomSelectorKind
  /** CSS: querySelector(All); XPath: относительно контекста (строка, документ) */
  expr: string
}

/**
 * Ручной разбор страницы по селекторам (задаётся в UI импорта из браузера).
 * Стратегия `rows` — каждый найденный узел (строка таблицы, карточка) → одна статья.
 * Стратегия `single` — текст из контейнера, затем разбиение на статьи (таблица | или splitIntoArticles).
 */
export type ManualDomParseRulesV1 =
  | {
      version: 1
      strategy: 'rows'
      rowSelector: DomSelector
      /** Относительно строки; если нет — номер статьи не заполняется */
      articleNumber?: DomSelector
      heading?: DomSelector
      /** Если не задан — берётся весь текст строки */
      body?: DomSelector
      /** Ограничить число строк (большие таблицы / тест) */
      maxRows?: number
    }
  | {
      version: 1
      strategy: 'single'
      containerSelector: DomSelector
      /** Подмножество контейнера; иначе весь текст контейнера */
      body?: DomSelector
    }

/** Импорт из встроенного браузера: авто (Readability) или по правилам селекторов. */
export interface BrowserImportPayload {
  html: string
  url: string
  title?: string
  /**
   * Повторный импорт в существующий документ (как `/import?replace=`): обновляет источник и статьи,
   * при смене текста — previous_* для сравнения в читателе.
   */
  replaceDocumentId?: string
  /** `manual` — использовать {@link ManualDomParseRulesV1}; иначе Readability + эвристики */
  mode?: 'auto' | 'manual'
  /** Только авто: первый пост темы или все сообщения подряд (XenForo). По умолчанию первый. */
  forumScope?: 'first' | 'all'
  manualRules?: ManualDomParseRulesV1
  articleFilter?: 'all' | 'with_sanctions' | 'without_sanctions'
}
