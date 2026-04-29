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

export interface AiProviderConfig {
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'openai_compatible'
  baseUrl?: string
  apiKey?: string
  model: string
  temperature: number
  maxTokens: number
  allowBroaderContext?: boolean
}

/** Пользовательский ИИ-агент (роль): доп. промпт и опциональные переопределения провайдера. */
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

export interface AiCitation {
  articleId: string
  documentTitle: string
  articleLabel: string
  excerpt: string
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
