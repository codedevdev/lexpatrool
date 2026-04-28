import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { ArticleDisplayMeta } from '@parsers/article-enrichment'
import { articleDisplayTitle } from '@shared/article-display'
import { RouteEmptyState } from '../../components/RouteEmptyState'

interface ArticleRow {
  id: string
  heading: string
  article_number: string | null
  body_clean: string
  summary_short?: string | null
  penalty_hint?: string | null
  display_meta_json?: string | null
  level?: number | null
  parent_article_id?: string | null
  sort_order?: number | null
}

type ArticleTreeNode = { row: ArticleRow; children: ArticleTreeNode[] }

function parseArticleMeta(json: string | null | undefined): ArticleDisplayMeta | null {
  if (!json?.trim()) return null
  try {
    return JSON.parse(json) as ArticleDisplayMeta
  } catch {
    return null
  }
}

function buildArticleTree(flat: ArticleRow[]): ArticleTreeNode[] {
  const map = new Map<string, ArticleTreeNode>()
  for (const a of flat) {
    map.set(a.id, { row: a, children: [] })
  }
  const roots: ArticleTreeNode[] = []
  for (const a of flat) {
    const node = map.get(a.id)!
    if (a.parent_article_id && map.has(a.parent_article_id)) {
      map.get(a.parent_article_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortFn = (x: ArticleTreeNode, y: ArticleTreeNode) =>
    (x.row.sort_order ?? 0) - (y.row.sort_order ?? 0)
  const walk = (nodes: ArticleTreeNode[]) => {
    nodes.sort(sortFn)
    for (const n of nodes) walk(n.children)
  }
  walk(roots)
  return roots
}

/** Подзаголовок карточки: статья / подстатья / часть. */
function articleKindLabel(a: ArticleRow): string {
  if (!a.parent_article_id) return 'Статья'
  const h = a.heading.trim()
  if (/^(?:Часть|часть|ч\.)\s/i.test(h)) return 'Часть'
  return 'Подстатья'
}

function ArticleNavTree({
  nodes,
  depth,
  activeId,
  documentId,
  navigate,
  onSelect
}: {
  nodes: ArticleTreeNode[]
  depth: number
  activeId: string | undefined
  documentId: string | undefined
  navigate: (path: string, opts?: { replace?: boolean }) => void
  onSelect: (a: ArticleRow) => void
}): JSX.Element {
  return (
    <>
      {nodes.map((n) => (
        <div key={n.row.id} className={depth > 0 ? 'mt-0.5 border-l border-white/[0.08]' : ''}>
          <button
            type="button"
            style={{ paddingLeft: `${10 + depth * 14}px` }}
            onClick={() => {
              onSelect(n.row)
              if (documentId) navigate(`/reader/${documentId}/${n.row.id}`, { replace: true })
            }}
            className={[
              'w-full min-w-0 rounded-r-lg py-2 text-left text-sm leading-snug',
              activeId === n.row.id ? 'bg-white/10 text-white' : 'text-app-muted hover:bg-white/5'
            ].join(' ')}
          >
            <span className="text-pretty">{articleDisplayTitle(n.row.article_number, n.row.heading)}</span>
          </button>
          {n.children.length > 0 ? (
            <ArticleNavTree
              nodes={n.children}
              depth={depth + 1}
              activeId={activeId}
              documentId={documentId}
              navigate={navigate}
              onSelect={onSelect}
            />
          ) : null}
        </div>
      ))}
    </>
  )
}

type LoadState = 'loading' | 'ok' | 'missing' | 'error'

export function ReaderPage(): JSX.Element {
  const { documentId, articleId } = useParams()
  const navigate = useNavigate()
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [docTitle, setDocTitle] = useState('')
  /** Режим импорта документа (without_sanctions = справочный кодекс без таблицы санкций). */
  const [docImportFilter, setDocImportFilter] = useState<string | null>(null)
  const [articles, setArticles] = useState<ArticleRow[]>([])
  const [active, setActive] = useState<ArticleRow | null>(null)
  const [articleMismatch, setArticleMismatch] = useState(false)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [docTitleDraft, setDocTitleDraft] = useState('')
  const [docTitleEditing, setDocTitleEditing] = useState(false)
  const [articleEdit, setArticleEdit] = useState(false)
  const [articleDraft, setArticleDraft] = useState({
    heading: '',
    article_number: '',
    body_clean: '',
    summary_short: '',
    penalty_hint: ''
  })

  const articleTree = useMemo(() => buildArticleTree(articles), [articles])
  const activeMeta = useMemo(
    () => (active ? parseArticleMeta(active.display_meta_json) : null),
    [active]
  )

  const [overlayPinnedIds, setOverlayPinnedIds] = useState<Set<string>>(new Set())

  const loadOverlayPins = useCallback(async () => {
    try {
      const rows = (await window.lawHelper.overlay.getPinned()) as { id: string }[]
      setOverlayPinnedIds(new Set(rows.map((r) => r.id)))
    } catch (e) {
      console.error('[LexPatrol] loadOverlayPins', e)
    }
  }, [])

  useEffect(() => {
    void loadOverlayPins()
    const off = window.lawHelper.overlay.onPinsUpdated(() => void loadOverlayPins())
    return () => off()
  }, [loadOverlayPins])

  const activePinned = active ? overlayPinnedIds.has(active.id) : false

  const [articleBookmarked, setArticleBookmarked] = useState(false)

  useEffect(() => {
    if (!active?.id) {
      setArticleBookmarked(false)
      return
    }
    void window.lawHelper.bookmarks.has(active.id).then(setArticleBookmarked)
  }, [active?.id])

  async function toggleBookmark(): Promise<void> {
    if (!active) return
    try {
      if (articleBookmarked) {
        await window.lawHelper.bookmarks.remove(active.id)
        setArticleBookmarked(false)
      } else {
        const r = await window.lawHelper.bookmarks.add(active.id)
        if (r.ok) setArticleBookmarked(true)
        else if (r.error === 'no_article') alert('Статья не найдена в базе.')
      }
    } catch (e) {
      console.error('[LexPatrol] toggleBookmark', e)
    }
  }

  /** После успешного documents.get — чтобы переключать статьи по URL без loading и без сброса скролла сайдбара. */
  const fetchedDocumentIdRef = useRef<string | null>(null)

  const referenceCodexDoc = docImportFilter === 'without_sanctions'

  const applyDocumentPayload = useCallback(
    (
      r: {
        document: { title: string; article_import_filter?: string | null } | null | undefined
        articles: ArticleRow[]
      },
      routeArticleId: string | undefined
    ) => {
      if (!r.document) {
        setLoadState('missing')
        setDocTitle('')
        setDocImportFilter(null)
        setArticles([])
        setActive(null)
        return
      }

      const list = Array.isArray(r.articles) ? r.articles : []
      setDocTitle(r.document.title)
      setDocImportFilter(r.document.article_import_filter ?? null)
      setArticles(list)
      setLoadState('ok')

      let pick: ArticleRow | null = null
      if (routeArticleId) {
        pick = list.find((a) => a.id === routeArticleId) ?? null
        if (!pick && list.length > 0) {
          setArticleMismatch(true)
          pick = list[0] ?? null
          if (pick && documentId) void navigate(`/reader/${documentId}/${pick.id}`, { replace: true })
        } else if (!pick && list.length === 0) {
          setActive(null)
          return
        } else {
          setArticleMismatch(false)
        }
      } else {
        pick = list[0] ?? null
        setArticleMismatch(false)
      }

      setActive(pick)
    },
    [documentId, navigate]
  )

  useEffect(() => {
    if (!documentId) {
      setLoadState('missing')
      setDocImportFilter(null)
      return
    }

    const listReady = fetchedDocumentIdRef.current === documentId && articles.length > 0

    if (listReady) {
      if (articleId) {
        const pick = articles.find((a) => a.id === articleId)
        if (pick) {
          setActive(pick)
          setArticleMismatch(false)
          setArticleEdit(false)
          setLoadState('ok')
          return
        }
      } else {
        const first = articles[0] ?? null
        setActive(first)
        setArticleMismatch(false)
        setArticleEdit(false)
        setLoadState('ok')
        return
      }
    }

    setLoadState('loading')
    setLoadError(null)
    setArticleMismatch(false)
    setArticleEdit(false)

    void window.lawHelper.documents
      .get(documentId)
      .then((res) => {
        const r = res as {
          document: { title: string; article_import_filter?: string | null } | null | undefined
          articles: ArticleRow[]
        }
        fetchedDocumentIdRef.current = documentId
        applyDocumentPayload(r, articleId)
      })
      .catch((e: unknown) => {
        fetchedDocumentIdRef.current = null
        setLoadState('error')
        setLoadError(e instanceof Error ? e.message : String(e))
        setDocTitle('')
        setDocImportFilter(null)
        setArticles([])
        setActive(null)
      })
  }, [documentId, articleId, articles, applyDocumentPayload])

  useEffect(() => {
    if (!active) return
    void window.lawHelper.article.get(active.id).then((row) => {
      const r = row as { source_url?: string | null }
      setSourceUrl(r.source_url ?? null)
    })
  }, [active])

  useEffect(() => {
    if (docTitleEditing) setDocTitleDraft(docTitle)
  }, [docTitle, docTitleEditing])

  useEffect(() => {
    if (!articleEdit || !active) return
    setArticleDraft({
      heading: active.heading,
      article_number: active.article_number ?? '',
      body_clean: active.body_clean,
      summary_short: active.summary_short ?? '',
      penalty_hint: active.penalty_hint ?? ''
    })
  }, [articleEdit, active])

  function highlight(text: string): ReactNode {
    if (!q.trim()) return text
    const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, 'gi'))
    return parts.map((p, i) =>
      p.toLowerCase() === q.toLowerCase() ? (
        <mark key={i} className="bg-amber-500/30 text-amber-100">
          {p}
        </mark>
      ) : (
        <span key={i}>{p}</span>
      )
    )
  }

  async function reloadAfterMutation(): Promise<void> {
    if (!documentId) return
    try {
      const res = await window.lawHelper.documents.get(documentId)
      const r = res as {
        document: { title: string; article_import_filter?: string | null } | null | undefined
        articles: ArticleRow[]
      }
      fetchedDocumentIdRef.current = documentId
      applyDocumentPayload(r, articleId)
    } catch (e: unknown) {
      setLoadState('error')
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }

  async function saveDocumentTitle(): Promise<void> {
    if (!documentId) return
    const t = docTitleDraft.trim()
    if (!t) return
    const r = await window.lawHelper.documents.update({ id: documentId, title: t })
    if (r.ok) {
      setDocTitle(t)
      setDocTitleEditing(false)
      void reloadAfterMutation()
    }
  }

  async function deleteDocument(): Promise<void> {
    if (!documentId) return
    if (
      !confirm(
        'Удалить весь документ из базы вместе со всеми статьями? Действие необратимо.'
      )
    ) {
      return
    }
    const r = await window.lawHelper.documents.delete(documentId)
    if (r.ok) void navigate('/kb')
  }

  async function saveArticle(): Promise<void> {
    if (!active) return
    const h = articleDraft.heading.trim()
    if (!h) {
      alert('Укажите заголовок статьи.')
      return
    }
    const r = await window.lawHelper.article.update({
      id: active.id,
      heading: h,
      article_number: articleDraft.article_number.trim() || null,
      body_clean: articleDraft.body_clean,
      summary_short: articleDraft.summary_short.trim() || null,
      penalty_hint: articleDraft.penalty_hint.trim() || null
    })
    if (!r.ok) {
      alert(r.error === 'invalid_meta_json' ? 'Некорректный JSON в метаданных.' : 'Не удалось сохранить.')
      return
    }
    setArticleEdit(false)
    void reloadAfterMutation()
  }

  async function deleteArticle(): Promise<void> {
    if (!active || !documentId) return
    if (!confirm('Удалить эту статью из базы? Действие необратимо.')) return
    const r = await window.lawHelper.article.delete(active.id)
    if (!r.ok) {
      alert('Не удалось удалить статью.')
      return
    }
    setArticleEdit(false)
    const res = await window.lawHelper.documents.get(documentId)
    const payload = res as { document: { title: string } | null | undefined; articles: ArticleRow[] }
    const list = Array.isArray(payload.articles) ? payload.articles : []
    if (!payload.document) {
      void navigate('/kb')
      return
    }
    setDocTitle(payload.document.title)
    setArticles(list)
    const next = list[0] ?? null
    setActive(next)
    setArticleMismatch(false)
    if (next) void navigate(`/reader/${documentId}/${next.id}`, { replace: true })
    else void navigate(`/reader/${documentId}`, { replace: true })
    setLoadState('ok')
  }

  async function toggleOverlayPin(): Promise<void> {
    if (!active) return
    try {
      if (overlayPinnedIds.has(active.id)) {
        const r = await window.lawHelper.overlay.unpin(active.id)
        if (!r.ok) {
          alert(
            r.error === 'database_error'
              ? 'Не удалось снять закреп (ошибка базы). Перезапустите LexPatrol.'
              : 'Не удалось снять закреп.'
          )
          return
        }
      } else {
        const r = await window.lawHelper.overlay.pin(active.id)
        if (!r.ok) {
          const msg =
            r.error === 'article_not_found'
              ? 'Статья не найдена в базе. Обновите страницу документа или импортируйте материал снова.'
              : r.error === 'database_error'
                ? 'Не удалось записать закреп (ошибка базы). Portable: проверьте папку LexPatrolData рядом с .exe; установщик — права на каталог профиля.'
                : 'Не удалось добавить на оверлей.'
          alert(msg)
          return
        }
      }
      await loadOverlayPins()
    } catch (e) {
      console.error('[LexPatrol] toggleOverlayPin', e)
      alert(
        `Ошибка оверлея: ${e instanceof Error ? e.message : String(e)}. Если portable — не удаляйте папку LexPatrolData рядом с программой.`
      )
    }
  }

  if (loadState === 'loading') {
    return <RouteEmptyState variant="loading" title="Загрузка документа…" />
  }

  if (loadState === 'missing') {
    return (
      <RouteEmptyState
        title="Документ не найден"
        description="Возможно, он удалён или ссылка устарела (другая база, демо сброшено). Импортируйте материал снова или откройте документ из «Базы знаний»."
      />
    )
  }

  if (loadState === 'error') {
    return (
      <RouteEmptyState
        variant="error"
        title="Не удалось открыть документ"
        description="Проверьте базу данных и попробуйте снова. Если ошибка повторяется — перезапустите приложение."
        errorDetail={loadError ?? undefined}
      />
    )
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(260px,36%)_minmax(0,1fr)] xl:grid-cols-[minmax(300px,400px)_minmax(0,1fr)]">
      <aside className="glass min-h-0 min-w-0 rounded-2xl p-4 lg:sticky lg:top-0 lg:max-h-[min(100vh-7rem,56rem)] lg:overflow-y-auto">
        <div className="text-xs uppercase tracking-wide text-app-muted">Документ</div>
        {docTitleEditing ? (
          <div className="mt-2 space-y-2">
            <input
              className="w-full rounded-lg border border-white/10 bg-surface-raised px-2 py-1.5 text-sm text-white outline-none focus:border-accent"
              value={docTitleDraft}
              onChange={(e) => setDocTitleDraft(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveDocumentTitle()}
                className="rounded-lg bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-dim"
              >
                Сохранить название
              </button>
              <button
                type="button"
                onClick={() => {
                  setDocTitleEditing(false)
                  setDocTitleDraft(docTitle)
                }}
                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-app-muted hover:bg-white/5"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-1 font-medium leading-snug text-white">{docTitle || 'Без названия'}</div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {!docTitleEditing && (
            <button
              type="button"
              onClick={() => setDocTitleEditing(true)}
              className="rounded-lg border border-white/10 px-2 py-1 text-xs text-app-muted hover:bg-white/5 hover:text-white"
            >
              Переименовать
            </button>
          )}
          <button
            type="button"
            onClick={() => void deleteDocument()}
            className="rounded-lg border border-red-500/30 px-2 py-1 text-xs text-red-300/90 hover:bg-red-500/10"
          >
            Удалить документ
          </button>
        </div>
        {articles.length === 0 ? (
          <p className="mt-4 text-sm leading-relaxed text-app-muted">
            В документе пока нет статей — выполните импорт с разбивкой на статьи или создайте документ заново.
          </p>
        ) : (
          <div className="mt-4 space-y-0.5">
            <ArticleNavTree
              nodes={articleTree}
              depth={0}
              activeId={active?.id}
              documentId={documentId}
              navigate={navigate}
              onSelect={(a) => {
                setActive(a)
                setArticleEdit(false)
                setArticleMismatch(false)
              }}
            />
          </div>
        )}
      </aside>

      <article className="glass min-w-0 rounded-2xl p-5 sm:p-6">
        {articleMismatch && (
          <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/95">
            Запрошенная статья не найдена — показана первая доступная.
          </div>
        )}

        {/* Заголовок на всю ширину колонки; кнопки — отдельной строкой (иначе при flex-row заголовок сжимается до узкой полоски и рвёт слова). */}
        <div className="flex flex-col gap-4">
          <div className="w-full min-w-0">
            <div className="text-xs uppercase tracking-wide text-app-muted">
              {active ? articleKindLabel(active) : 'Статья'}
            </div>
            <h1 className="mt-1 text-xl font-semibold leading-tight text-white sm:text-2xl sm:leading-snug">
              {active
                ? articleDisplayTitle(active.article_number, active.heading)
                : articles.length === 0
                  ? 'Нет статей'
                  : 'Выберите статью слева'}
            </h1>
            {active && sourceUrl && (
              <button
                type="button"
                className="mt-2 text-sm text-accent hover:underline"
                onClick={() => window.lawHelper.shell.openExternal(sourceUrl)}
              >
                Открыть исходник
              </button>
            )}
            {active &&
              !articleEdit &&
              (active.summary_short?.trim() ||
                active.penalty_hint?.trim() ||
                activeMeta?.bailHint?.trim()) && (
                <div className="mt-4 w-full rounded-xl border border-white/10 bg-black/25 p-4 text-sm leading-relaxed">
                  {active.summary_short?.trim() ? (
                    <p>
                      <span className="text-xs uppercase tracking-wide text-app-muted">Суть · </span>
                      <span className="text-white/90">{active.summary_short}</span>
                    </p>
                  ) : null}
                  {activeMeta?.bailHint?.trim() ? (
                    <p className={active.summary_short?.trim() ? 'mt-3' : ''}>
                      <span className="text-xs uppercase tracking-wide text-app-muted">Залог · </span>
                      <span className="text-sky-100/85">{activeMeta.bailHint}</span>
                    </p>
                  ) : null}
                  {active.penalty_hint?.trim() ? (
                    <p
                      className={
                        active.summary_short?.trim() || activeMeta?.bailHint?.trim() ? 'mt-3' : ''
                      }
                    >
                      <span className="text-xs uppercase tracking-wide text-app-muted">
                        {referenceCodexDoc ? 'Пояснение · ' : 'Наказание · '}
                      </span>
                      <span
                        className={
                          referenceCodexDoc ? 'text-white/85' : 'text-amber-100/90'
                        }
                      >
                        {active.penalty_hint}
                      </span>
                    </p>
                  ) : null}
                </div>
              )}
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
            <input
              className="min-h-[40px] min-w-[min(100%,14rem)] flex-1 rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
              placeholder="Подсветка в тексте…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              disabled={!active || articleEdit}
            />
            {active && (
              <>
                <button
                  type="button"
                  onClick={() => setArticleEdit((e) => !e)}
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
                >
                  {articleEdit ? 'Просмотр' : 'Редактировать'}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteArticle()}
                  className="rounded-lg border border-red-500/35 px-3 py-2 text-sm text-red-200/90 hover:bg-red-500/10"
                >
                  Удалить статью
                </button>
                <button
                  type="button"
                  disabled={articleEdit}
                  onClick={() => void toggleOverlayPin()}
                  className={
                    activePinned
                      ? 'rounded-lg border border-red-400/35 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-500/25 disabled:opacity-40'
                      : 'rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40'
                  }
                >
                  {activePinned ? 'Снять с оверлея' : 'На оверлей'}
                </button>
                <button
                  type="button"
                  disabled={articleEdit}
                  onClick={() => void toggleBookmark()}
                  className={
                    articleBookmarked
                      ? 'rounded-lg border border-amber-400/35 bg-amber-500/15 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/25 disabled:opacity-40'
                      : 'rounded-lg border border-white/15 px-3 py-2 text-sm text-white/90 hover:bg-white/10 disabled:opacity-40'
                  }
                >
                  {articleBookmarked ? 'В закладках' : 'В закладки'}
                </button>
              </>
            )}
          </div>
        </div>

        {active && articleEdit && (
          <div className="mt-6 space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
            <label className="block text-xs text-app-muted">
              Заголовок
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
                value={articleDraft.heading}
                onChange={(e) => setArticleDraft((d) => ({ ...d, heading: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-app-muted">
              Номер статьи (опционально)
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
                value={articleDraft.article_number}
                onChange={(e) => setArticleDraft((d) => ({ ...d, article_number: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-app-muted">
              Текст
              <textarea
                className="mt-1 min-h-[200px] w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 font-mono text-sm text-white outline-none focus:border-accent"
                value={articleDraft.body_clean}
                onChange={(e) => setArticleDraft((d) => ({ ...d, body_clean: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-app-muted">
              Суть (кратко)
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
                value={articleDraft.summary_short}
                onChange={(e) => setArticleDraft((d) => ({ ...d, summary_short: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-app-muted">
              {referenceCodexDoc ? 'Пояснение / выдержка (не санкция)' : 'Наказание (подсказка)'}
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
                value={articleDraft.penalty_hint}
                onChange={(e) => setArticleDraft((d) => ({ ...d, penalty_hint: e.target.value }))}
              />
            </label>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={() => void saveArticle()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim"
              >
                Сохранить
              </button>
              <button
                type="button"
                onClick={() => setArticleEdit(false)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-app-muted hover:bg-white/5"
              >
                Отмена
              </button>
            </div>
          </div>
        )}

        <div className="prose prose-invert mt-6 w-full max-w-none whitespace-pre-wrap text-sm leading-relaxed text-app">
          {active && !articleEdit ? (
            highlight(active.body_clean)
          ) : !active && articles.length === 0 ? (
            <p className="text-app-muted">Импортируйте материал с разбивкой на статьи или откройте другой документ в базе знаний.</p>
          ) : !active ? (
            <p className="text-app-muted">Выберите статью в списке слева.</p>
          ) : null}
        </div>
      </article>
    </div>
  )
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
