import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { articleDisplayTitle } from '@shared/article-display'

interface PinRow {
  id: string
  document_id: string
  heading: string
  article_number: string | null
  document_title: string
}

interface BookmarkRow {
  id: string
  article_id: string
  document_id: string
  heading: string
  article_number: string | null
  document_title: string
}

function fmtArticleTitle(articleNumber: string | null, heading: string): string {
  return articleDisplayTitle(articleNumber, heading)
}

export function DashboardPage(): JSX.Element {
  const [version, setVersion] = useState('')
  const [counts, setCounts] = useState({ documents: 0, articles: 0 })
  const [pins, setPins] = useState<PinRow[]>([])
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([])
  const [notesCount, setNotesCount] = useState(0)
  const [hkDisp, setHkDisp] = useState({
    toggle: 'Ctrl+Shift+Space',
    search: 'Ctrl+Shift+F',
    clickThrough: 'Ctrl+Shift+G'
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      const settled = await Promise.allSettled([
        window.lawHelper.getVersion(),
        window.lawHelper.stats.summary(),
        window.lawHelper.hotkeys.get(),
        window.lawHelper.overlay.getPinned(),
        window.lawHelper.bookmarks.list(),
        window.lawHelper.notes.list()
      ])

      const v = settled[0]
      if (v.status === 'fulfilled') setVersion(v.value)

      const st = settled[1]
      if (st.status === 'fulfilled') {
        setCounts({ documents: st.value.documentCount, articles: st.value.articleCount })
      } else {
        setCounts({ documents: 0, articles: 0 })
      }

      const hk = settled[2]
      if (hk.status === 'fulfilled') setHkDisp(hk.value.display)

      const pinRes = settled[3]
      if (pinRes.status === 'fulfilled') {
        const raw = pinRes.value as unknown[]
        setPins(
          Array.isArray(raw)
            ? raw.map((p) => {
                const o = p as Record<string, unknown>
                return {
                  id: String(o.id ?? ''),
                  document_id: String(o.document_id ?? ''),
                  heading: String(o.heading ?? ''),
                  article_number: typeof o.article_number === 'string' ? o.article_number : null,
                  document_title: String(o.document_title ?? '')
                }
              })
            : []
        )
      } else setPins([])

      const bm = settled[4]
      if (bm.status === 'fulfilled') {
        const raw = bm.value as unknown[]
        setBookmarks(Array.isArray(raw) ? (raw as BookmarkRow[]) : [])
      } else setBookmarks([])

      const nt = settled[5]
      if (nt.status === 'fulfilled') {
        const raw = nt.value as unknown[]
        setNotesCount(Array.isArray(raw) ? raw.length : 0)
      } else setNotesCount(0)

      setLoading(false)
    })()
  }, [])

  const bookmarkPreview = useMemo(() => bookmarks.slice(0, 4), [bookmarks])
  const pinPreview = useMemo(() => pins.slice(0, 5), [pins])

  return (
    <div className="space-y-8">
      <header className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-[#0f141d]/95 via-[#0c1018]/90 to-[#080b10]/95 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]">
        <div className="pointer-events-none absolute -right-16 -top-24 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent/90">Стартовый экран</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-[1.65rem]">
            LexPatrol <span className="font-normal text-app-muted">— обзор</span>
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-app-muted">
            Локальная база норм для роли в <span className="text-white/85">госструктурах</span> на вашем RP-сервере:
            импорт текстов, поиск, закладки и заметки. Оверлей — отдельное окно поверх игры; горячие клавиши работают,
            пока запущен LexPatrol.
          </p>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="glass rounded-2xl p-5 transition hover:border-white/[0.1]">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-app-muted">Документы</div>
          <div className="mt-2 font-mono text-3xl font-semibold tabular-nums text-white">
            {loading ? <span className="text-white/35">…</span> : counts.documents}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-app-muted">Импортированные материалы — раздел «База».</p>
        </div>
        <div className="glass rounded-2xl p-5 transition hover:border-white/[0.1]">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-app-muted">Статьи</div>
          <div className="mt-2 font-mono text-3xl font-semibold tabular-nums text-white">
            {loading ? <span className="text-white/35">…</span> : counts.articles}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-app-muted">Пункты после разбивки — поиск и оверлей работают по ним.</p>
        </div>
        <Link
          to="/notes"
          className="glass group rounded-2xl p-5 transition hover:border-accent/25 hover:bg-white/[0.02]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-app-muted">Закладки</span>
            <span className="text-[10px] text-accent/80 opacity-0 transition group-hover:opacity-100">→</span>
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold tabular-nums text-white">
            {loading ? <span className="text-white/35">…</span> : bookmarks.length}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-app-muted">Избранные статьи — на вкладке «Заметки».</p>
        </Link>
        <Link
          to="/notes"
          className="glass group rounded-2xl p-5 transition hover:border-accent/25 hover:bg-white/[0.02]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-app-muted">Заметки</span>
            <span className="text-[10px] text-accent/80 opacity-0 transition group-hover:opacity-100">→</span>
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold tabular-nums text-white">
            {loading ? <span className="text-white/35">…</span> : notesCount}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-app-muted">Черновики смены, привязка к статьям.</p>
        </Link>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="glass flex flex-col justify-between rounded-2xl p-6">
          <div>
            <h2 className="text-sm font-semibold text-white">Оверлей в игре</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-app-muted">
              Закрепы:{' '}
              <span className="font-mono tabular-nums text-white/90">
                {loading ? '…' : pins.length}
              </span>
              . Добавляйте статьи из читателя кнопкой «На оверлей», затем откройте окно поверх игры.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void window.lawHelper.overlay.show()}
              className="rounded-xl border border-accent/35 bg-accent/15 px-4 py-2 text-xs font-medium text-accent hover:bg-accent/25"
            >
              Показать оверлей
            </button>
            <Link
              to="/kb"
              className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-white/90 hover:bg-white/[0.08]"
            >
              База знаний
            </Link>
          </div>
        </div>

        <div className="glass rounded-2xl p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Версия</h2>
              <p className="mt-1 text-[11px] text-app-muted">Текущая установленная сборка.</p>
            </div>
            <span className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-sm text-white/95">
              {version || (loading ? '…' : '—')}
            </span>
          </div>
          <div className="mt-5 rounded-xl border border-white/[0.06] bg-black/25 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Горячие клавиши</div>
            <dl className="mt-2 space-y-1.5 text-[11px] leading-snug text-app-muted">
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                <dt className="shrink-0 font-mono text-[10px] text-white/70">{hkDisp.toggle}</dt>
                <dd>окно оверлея</dd>
              </div>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                <dt className="shrink-0 font-mono text-[10px] text-white/70">{hkDisp.search}</dt>
                <dd>фокус поиска по базе в оверлее</dd>
              </div>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                <dt className="shrink-0 font-mono text-[10px] text-white/70">{hkDisp.clickThrough}</dt>
                <dd>клики в игру / в панель</dd>
              </div>
            </dl>
            <Link to="/settings" className="mt-3 inline-block text-[11px] text-accent hover:underline">
              Изменить в настройках
            </Link>
          </div>
        </div>
      </section>

      {(pinPreview.length > 0 || bookmarkPreview.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {pinPreview.length > 0 ? (
            <div className="glass rounded-2xl p-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-white">Сейчас на оверлее</h2>
                <span className="text-[10px] tabular-nums text-white/40">{pins.length} всего</span>
              </div>
              <ul className="mt-4 space-y-2">
                {pinPreview.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.05] bg-black/20 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-medium text-white/95">{fmtArticleTitle(p.article_number, p.heading)}</p>
                      <p className="truncate text-[10px] text-app-muted">{p.document_title}</p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[10px] text-white/80 hover:bg-white/[0.06]"
                      onClick={() => void window.lawHelper.openReader(p.document_id, p.id)}
                    >
                      Читатель
                    </button>
                  </li>
                ))}
              </ul>
              {pins.length > pinPreview.length ? (
                <p className="mt-3 text-[10px] text-white/35">и ещё {pins.length - pinPreview.length}…</p>
              ) : null}
            </div>
          ) : (
            <div className="glass rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-white">Оверлей пуст</h2>
              <p className="mt-2 text-[12px] leading-relaxed text-app-muted">
                Откройте статью в <Link className="text-accent hover:underline" to="/kb">базе</Link>, нажмите «На оверлей»
                — статья появится в окне поверх игры. Без закрепов доступен поиск по всей базе прямо в оверлее.
              </p>
            </div>
          )}

          {bookmarkPreview.length > 0 ? (
            <div className="glass rounded-2xl p-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-white">Последние закладки</h2>
                <Link to="/notes" className="text-[11px] text-accent hover:underline">
                  все
                </Link>
              </div>
              <ul className="mt-4 space-y-2">
                {bookmarkPreview.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition hover:border-white/[0.08] hover:bg-white/[0.04]"
                      onClick={() => void window.lawHelper.openReader(b.document_id, b.article_id)}
                    >
                      <span className="min-w-0 truncate text-[12px] text-white/90">{fmtArticleTitle(b.article_number, b.heading)}</span>
                      <span className="shrink-0 text-[10px] text-accent/90">Открыть</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="glass rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-white">Закладки</h2>
              <p className="mt-2 text-[12px] leading-relaxed text-app-muted">
                В читателе нажмите «В закладки», чтобы быстро возвращаться к статье. Список — на вкладке{' '}
                <Link className="text-accent hover:underline" to="/notes">
                  Заметки
                </Link>
                .
              </p>
            </div>
          )}
        </section>
      )}

      {pinPreview.length === 0 && bookmarkPreview.length === 0 && !loading ? (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="glass rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-white">Оверлей</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-app-muted">
              Закрепите статьи из читателя или пользуйтесь поиском по базе в окне оверлея (
              <span className="font-mono text-[10px] text-white/55">{hkDisp.search}</span>).
            </p>
            <button
              type="button"
              onClick={() => void window.lawHelper.overlay.show()}
              className="mt-4 rounded-xl border border-accent/35 bg-accent/15 px-4 py-2 text-xs font-medium text-accent hover:bg-accent/25"
            >
              Показать оверлей
            </button>
          </div>
          <div className="glass rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-white">Закладки</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-app-muted">
              Добавляйте статьи в избранное из читателя — ярлыки появятся здесь и на вкладке «Заметки».
            </p>
            <Link
              to="/kb"
              className="mt-4 inline-block rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-white/90 hover:bg-white/[0.08]"
            >
              Открыть базу
            </Link>
          </div>
        </section>
      ) : null}

      <section className="glass rounded-2xl p-6">
        <h2 className="text-lg font-medium text-white">Быстрый старт</h2>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-app-muted">
          <li>
            <Link className="font-medium text-accent hover:underline" to="/patrol">
              На посту
            </Link>{' '}
            — быстрый поиск по базе и напоминания перед игрой в роли.
          </li>
          <li>
            <Link className="font-medium text-accent hover:underline" to="/import">
              Импорт
            </Link>
            : текст, HTML или страница через{' '}
            <Link className="text-accent hover:underline" to="/browser">
              браузер
            </Link>
            .
          </li>
          <li>
            <Link className="font-medium text-accent hover:underline" to="/kb">
              База знаний
            </Link>{' '}
            → читатель → «На оверлей» или «В закладки».
          </li>
          <li>
            <Link className="font-medium text-accent hover:underline" to="/settings">
              Настройки
            </Link>{' '}
            — горячие клавиши, прозрачность оверлея, «поверх окон».
          </li>
        </ol>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Игра</div>
          <p className="mt-2 text-[12px] leading-snug text-app-muted">
            Режим «В игру» в оверлее пропускает клики в окно игры — переключайте перед патрулем.
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Данные</div>
          <p className="mt-2 text-[12px] leading-snug text-app-muted">
            База хранится локально (папка данных приложения). Резервная копия — в настройках.
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Браузер</div>
          <p className="mt-2 text-[12px] leading-snug text-app-muted">
            Импорт страницы с форума или сайта в один клик — раздел{' '}
            <Link className="text-accent hover:underline" to="/browser">
              Браузер
            </Link>
            , затем разбор и сохранение в базу.
          </p>
        </div>
      </section>
    </div>
  )
}
