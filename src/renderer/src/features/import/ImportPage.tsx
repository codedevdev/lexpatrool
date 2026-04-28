import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ImportPayload, SourceType } from '@shared/types'

type ArticleFilter = NonNullable<ImportPayload['articleFilter']>

export function ImportPage(): JSX.Element {
  const navigate = useNavigate()
  const [title, setTitle] = useState('Новый импорт')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [sourceType, setSourceType] = useState<SourceType>('paste_text')
  const [split, setSplit] = useState(true)
  const [articleFilter, setArticleFilter] = useState<ArticleFilter>('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const payload: ImportPayload = {
        title,
        url: url || undefined,
        sourceType,
        rawText: sourceType === 'paste_html' ? undefined : text,
        rawHtml: sourceType === 'paste_html' ? text : undefined,
        splitArticles: split,
        articleFilter
      }
      const res = await window.lawHelper.import.payload(payload)
      navigate(`/reader/${res.documentId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка импорта')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">Импорт</h1>
        <p className="mt-2 text-sm text-app-muted">
          Добавьте в базу выдержки из правил, форума или своих материалов. Страницы с авторизацией удобнее открыть во встроенном
          браузере («Браузер» в меню).
        </p>
      </header>

      <form onSubmit={onSubmit} className="glass space-y-4 rounded-2xl p-6">
        <label className="block space-y-1">
          <span className="text-xs text-app-muted">Название</span>
          <input
            className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-app-muted">Исходный URL (необязательно)</span>
          <input
            className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://forum.example/..."
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-app-muted">Тип источника</span>
          <select
            className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as SourceType)}
          >
            <option value="paste_text">Текст (вставка)</option>
            <option value="paste_html">HTML (вставка)</option>
            <option value="web_page">Веб-страница</option>
            <option value="forum_thread">Тред форума</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-app-muted">Содержимое</span>
          <textarea
            className="min-h-[240px] w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Вставьте текст кодекса, правил или статьи…"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-app-muted">
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
          Автоматически разбить на статьи (эвристика)
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-app-muted">После разбивки (фильтр блоков)</span>
          <select
            className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 text-sm text-white outline-none focus:border-accent"
            value={articleFilter}
            onChange={(e) => setArticleFilter(e.target.value as ArticleFilter)}
          >
            <option value="all">Все блоки</option>
            <option value="with_sanctions">Только с наказанием / штрафом / санкциями</option>
            <option value="without_sanctions">Только справочные (без санкций)</option>
          </select>
        </label>

        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}

        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40"
        >
          {busy ? 'Импорт…' : 'Импортировать в базу'}
        </button>
      </form>
    </div>
  )
}
