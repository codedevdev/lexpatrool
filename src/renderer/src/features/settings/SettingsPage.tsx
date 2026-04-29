import { useEffect, useState } from 'react'
import { LEX_COMMUNITY_DISCORD_URL, LEX_GITHUB_ISSUES_URL } from '../../lib/app-links'
import { humanizeAcceleratorForUi, keyboardEventToAccelerator } from '../../lib/hotkey-format'

type HotkeyField = 'toggle' | 'search' | 'clickThrough' | 'cheatsOverlay' | 'collectionsOverlay'

const UPDATE_NOTIFY_KEY = 'update_notify_startup'

const HOTKEY_ROW_META: Record<
  HotkeyField,
  { title: string; desc: string }
> = {
  toggle: { title: 'Оверлей закрепов', desc: 'Показать / скрыть оверлей закрепов' },
  search: { title: 'Поиск по базе', desc: 'Открыть оверлей и фокус на поиске по базе' },
  clickThrough: { title: 'Мышь: оверлей ↔ игра', desc: 'Переключить режим мыши: оверлей ↔ игра' },
  cheatsOverlay: { title: 'Окно шпаргалок', desc: 'Показать / скрыть отдельное окно шпаргалок' },
  collectionsOverlay: { title: 'Окно подборок', desc: 'Показать / скрыть отдельное окно подборок' }
}

export function SettingsPage(): JSX.Element {
  const [opacity, setOpacity] = useState(0.92)
  const [clickThrough, setClickThrough] = useState(false)
  const [mainAlwaysOnTop, setMainAlwaysOnTop] = useState(false)
  const [overlayAotLevel, setOverlayAotLevel] = useState<'off' | 'floating' | 'screen-saver' | 'pop-up-menu'>(
    'pop-up-menu'
  )
  const [prefsReady, setPrefsReady] = useState(false)
  const [hkDisplay, setHkDisplay] = useState({
    toggle: 'Ctrl+Shift+Space',
    search: 'Ctrl+Shift+F',
    clickThrough: 'Ctrl+Shift+G',
    cheatsOverlay: 'Ctrl+Shift+Y',
    collectionsOverlay: 'Ctrl+Shift+U'
  })
  const [hkDefaultsDisplay, setHkDefaultsDisplay] = useState({ ...hkDisplay })
  const [hkRecording, setHkRecording] = useState<HotkeyField | null>(null)
  const [hkRecordingPreview, setHkRecordingPreview] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [updateRepo, setUpdateRepo] = useState('')
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<string | null>(null)
  const [updateResult, setUpdateResult] = useState<Awaited<ReturnType<typeof window.lawHelper.update.check>> | null>(
    null
  )
  const [backupBusy, setBackupBusy] = useState(false)
  const [notifyOnStartup, setNotifyOnStartup] = useState(true)

  useEffect(() => {
    void window.lawHelper.getVersion().then(setAppVersion)
    void window.lawHelper.update.repoLabel().then(setUpdateRepo)
    void window.lawHelper.settings.get(UPDATE_NOTIFY_KEY).then((v) => setNotifyOnStartup(v !== '0'))
  }, [])

  useEffect(() => {
    void window.lawHelper.hotkeys
      .get()
      .then((h) => {
        setHkDisplay(h.display)
        setHkDefaultsDisplay(h.defaultsDisplay)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!hkRecording) {
      setHkRecordingPreview(null)
      return
    }
    setHkRecordingPreview(null)
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') {
        setHkRecording(null)
        return
      }
      const acc = keyboardEventToAccelerator(e)
      if (acc) setHkRecordingPreview(humanizeAcceleratorForUi(acc))
      if (!acc) return
      void window.lawHelper.hotkeys.set({ [hkRecording]: acc }).then((r) => {
        if (r.ok) {
          void window.lawHelper.hotkeys.get().then((h) => {
            setHkDisplay(h.display)
            setHkDefaultsDisplay(h.defaultsDisplay)
          })
        } else if (r.error === 'duplicate') {
          alert('Такое сочетание уже назначено другому действию.')
        } else {
          alert(r.detail ? `Не удалось: ${r.detail}` : 'Сочетание недопустимо или занято системой.')
        }
        setHkRecording(null)
      })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [hkRecording])

  useEffect(() => {
    void (async () => {
      const [op, ct, main, oaot] = await Promise.all([
        window.lawHelper.settings.get('overlay_opacity'),
        window.lawHelper.settings.get('overlay_click_through'),
        window.lawHelper.settings.get('main_window_always_on_top'),
        window.lawHelper.settings.get('overlay_always_on_top_level')
      ])
      if (op) {
        const n = Number(op)
        if (!Number.isNaN(n)) setOpacity(Math.min(1, Math.max(0.28, n)))
      }
      if (ct === '1' || ct === '0') setClickThrough(ct === '1')
      if (main === '1' || main === '0') setMainAlwaysOnTop(main === '1')
      if (oaot === 'off' || oaot === 'floating' || oaot === 'screen-saver' || oaot === 'pop-up-menu') {
        setOverlayAotLevel(oaot)
      }
      setPrefsReady(true)
    })()
  }, [])

  useEffect(() => {
    window.lawHelper.overlay.setOpacity(opacity)
    void window.lawHelper.settings.set('overlay_opacity', String(opacity))
  }, [opacity])

  useEffect(() => {
    window.lawHelper.overlay.setClickThrough(clickThrough)
    void window.lawHelper.settings.set('overlay_click_through', clickThrough ? '1' : '0')
  }, [clickThrough])

  useEffect(() => {
    if (!prefsReady) return
    void window.lawHelper.mainWindow.setAlwaysOnTop(mainAlwaysOnTop)
  }, [mainAlwaysOnTop, prefsReady])

  useEffect(() => {
    if (!prefsReady) return
    void window.lawHelper.overlay.setAlwaysOnTopLevel(overlayAotLevel)
  }, [overlayAotLevel, prefsReady])

  async function backup(): Promise<void> {
    const r = await window.lawHelper.backup.save()
    if (r.ok && r.path) {
      alert(`Сохранено: ${r.path}`)
    } else if (r.error) {
      alert(`Не удалось сохранить резервную копию: ${r.error}`)
    }
  }

  async function restoreBackup(): Promise<void> {
    const ok = window.confirm(
      'Импорт заменит текущую базу LexPatrol данными из файла.\n\n' +
        'Рекомендуется сначала сохранить резервную копию текущего состояния.\n\n' +
        'Продолжить?'
    )
    if (!ok) return
    setBackupBusy(true)
    try {
      const r = await window.lawHelper.backup.restore()
      if (!r.ok) {
        if (r.cancelled) return
        alert(r.error ?? 'Не удалось импортировать файл.')
        return
      }
      /* Главное окно перезагружается из main — этот код часто не выполнится */
    } finally {
      setBackupBusy(false)
    }
  }

  async function checkUpdatesManual(): Promise<void> {
    setUpdateBusy(true)
    setUpdateInfo(null)
    setUpdateResult(null)
    try {
      const r = await window.lawHelper.update.check()
      setUpdateResult(r)
      if (r.status === 'latest') {
        setUpdateInfo(r.message ?? 'У вас установлена последняя доступная версия.')
      } else if (r.status === 'available') {
        setUpdateInfo(
          `Доступна версия ${r.latestVersion}. Скачайте файл по кнопке ниже, закройте LexPatrol и запустите установщик.`
        )
      } else if (r.status === 'skipped') {
        setUpdateInfo(r.message ?? 'Проверка отключена.')
      } else {
        setUpdateInfo(r.message ?? 'Не удалось связаться с GitHub. Проверьте интернет или попробуйте позже.')
      }
    } finally {
      setUpdateBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-white">Настройки</h1>
        <p className="mt-2 max-w-2xl text-sm text-app-muted leading-relaxed">
          Горячие клавиши, окно оверлея, проверка обновлений и резервное копирование базы. Сочетания действуют по всей системе,
          пока запущен LexPatrol.
        </p>
      </header>

      <section className="glass space-y-3 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white">Что здесь настраивается</h2>
        <ul className="list-inside list-disc space-y-2 text-xs leading-relaxed text-app-muted">
          <li>
            <span className="text-white/85">Обновления</span> — узнать о новой версии и перейти к файлу на GitHub; установка —
            скачать и запустить установщик самостоятельно.
          </li>
          <li>
            <span className="text-white/85">Горячие клавиши</span> — три действия по всей системе (оверлей, поиск по базе, режим
            «мышь в игру»); в самом оверлее — Esc и стрелки для закреплённых статей (см. таблицу в разделе ниже).
          </li>
          <li>
            <span className="text-white/85">Окна поверх других</span> — отдельно для главного окна и для оверлея; при необходимости
            поднимите уровень оверлея, если его перекрывают другие программы.
          </li>
          <li>
            <span className="text-white/85">Оверлей</span> — прозрачность, пропуск кликов в игру, показ / скрытие и вывод «поверх
            всех окон»; те же параметры можно менять на панели оверлея — они синхронизированы.
          </li>
          <li>
            <span className="text-white/85">Резервная копия</span> — экспорт в JSON и импорт с другого ПК или после
            переустановки; в файл входят документы, статьи, закладки, заметки, подборки, шпаргалки, настройки и т.д.
          </li>
        </ul>
      </section>

      <section className="glass space-y-4 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white">Обновления</h2>
        <p className="text-xs leading-relaxed text-app-muted">
          Сейчас у вас версия <span className="font-mono text-white/90">{appVersion || '…'}</span>. Файлы новых версий лежат на{' '}
          <span className="font-mono text-white/80">github.com/{updateRepo || '…'}</span> — приложение лишь показывает, что
          вышло обновление, и ведёт к странице со скачиванием.
        </p>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/25 bg-surface-raised text-accent focus:ring-accent"
            checked={notifyOnStartup}
            onChange={(e) => {
              const on = e.target.checked
              setNotifyOnStartup(on)
              void window.lawHelper.settings.set(UPDATE_NOTIFY_KEY, on ? '1' : '0')
            }}
          />
          <span className="text-sm leading-snug text-app-muted">
            <span className="font-medium text-white">Напоминать при запуске</span>, если найдена более новая версия. Снимите
            галочку, если не нужна полоска-уведомление сверху окна.
          </span>
        </label>

        <details className="rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3 text-xs text-app-muted">
          <summary className="cursor-pointer select-none font-medium text-white/90">Как установить обновление</summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 leading-relaxed marker:text-accent">
            <li>Нажмите «Проверить обновления» ниже или воспользуйтесь напоминанием — откроется страница релиза.</li>
            <li>Скачайте установщик (.exe). Программа не качает и не ставит обновление без вашего участия.</li>
            <li>Закройте LexPatrol, запустите скачанный файл и следуйте шагам установки. Затем снова откройте приложение.</li>
          </ol>
          <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] leading-relaxed text-app-muted/95">
            Так вы сами решаете, когда скачать файл и запустить установку — всё под вашим контролем.
          </p>
        </details>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={updateBusy}
            onClick={() => void checkUpdatesManual()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-50"
          >
            {updateBusy ? 'Проверка…' : 'Проверить обновления'}
          </button>
          {updateResult?.status === 'available' && updateResult.releaseUrl ? (
            <>
              <button
                type="button"
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/[0.06]"
                onClick={() => window.lawHelper.shell.openExternal(updateResult.releaseUrl!)}
              >
                Открыть релиз на GitHub
              </button>
              {updateResult.downloadUrl ? (
                <button
                  type="button"
                  className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20"
                  onClick={() => window.lawHelper.shell.openExternal(updateResult.downloadUrl!)}
                >
                  Перейти к скачиванию
                </button>
              ) : null}
            </>
          ) : null}
        </div>
        {updateInfo ? <p className="text-sm text-app-muted">{updateInfo}</p> : null}
        {updateResult?.status === 'available' && updateResult.message ? (
          <div className="rounded-xl border border-white/[0.08] bg-black/25 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-app-muted">Описание релиза</p>
            <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-app-muted">
              {updateResult.message}
            </pre>
          </div>
        ) : null}
        <p className="text-[11px] text-app-muted">
          «Позже» скрывает напоминание для этой версии; когда появится ещё более новая — уведомление снова покажется (если
          включено напоминание при запуске).
        </p>
      </section>

      <section className="glass space-y-4 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white">Сообщество и поддержка</h2>
        <p className="text-sm leading-relaxed text-app-muted">
          Вопросы по программе, помощь с настройкой и обратная связь — в Discord-сообществе LexPatrol. Там же можно обсудить
          идеи и поделиться опытом использования оверлея и базы.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void window.lawHelper.shell.openExternal(LEX_COMMUNITY_DISCORD_URL)}
            className="rounded-lg border border-[#5865F2]/40 bg-[#5865F2]/15 px-4 py-2 text-sm font-medium text-white hover:bg-[#5865F2]/25"
          >
            Открыть Discord
          </button>
          <button
            type="button"
            onClick={() => void window.lawHelper.shell.openExternal(LEX_GITHUB_ISSUES_URL)}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/[0.06]"
          >
            Issues на GitHub
          </button>
        </div>
        <p className="text-xs leading-relaxed text-app-muted">
          Ошибки и предложения по коду удобно оформлять через <span className="text-white/80">Issues</span> на GitHub — так
          проще отследить исправление в следующей версии.
        </p>
      </section>

      <section className="glass space-y-4 rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Горячие клавиши</h2>
            <p className="mt-1 max-w-xl text-xs text-app-muted">
              Действуют во всей системе, пока LexPatrol запущен. Задайте Ctrl/Alt/Shift и клавишу; Esc во время записи —
              отмена. У каждого действия своё сочетание.
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-surface-raised px-3 py-1.5 text-xs text-white hover:bg-surface-hover"
            onClick={() => {
              void window.lawHelper.hotkeys.resetDefaults().then(() => {
                void window.lawHelper.hotkeys.get().then((h) => {
                  setHkDisplay(h.display)
                  setHkDefaultsDisplay(h.defaultsDisplay)
                })
              })
            }}
          >
            Сбросить по умолчанию
          </button>
        </div>

        {hkRecording ? (
          <div className="space-y-1 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
            <p>
              Запись: <span className="font-medium text-white">{HOTKEY_ROW_META[hkRecording].title}</span> — нажмите новое
              сочетание (Esc — отмена).
            </p>
            {hkRecordingPreview ? (
              <p className="font-mono text-[11px] text-white/90">
                Будет: <span className="text-accent">{hkRecordingPreview}</span>
              </p>
            ) : (
              <p className="text-[11px] text-app-muted">Удерживайте Ctrl/Alt/Shift и нажмите клавишу.</p>
            )}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-black/30 text-[11px] uppercase tracking-wide text-app-muted">
                <th className="px-4 py-2 font-medium">Действие</th>
                <th className="px-4 py-2 font-medium">Сейчас</th>
                <th className="px-4 py-2 font-medium">Стандарт</th>
                <th className="px-4 py-2 font-medium text-right"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(
                [
                  'toggle',
                  'search',
                  'clickThrough',
                  'cheatsOverlay',
                  'collectionsOverlay'
                ] as const
              ).map((id) => (
                <tr key={id} className="bg-white/[0.02]">
                  <td className="px-4 py-3 align-top">
                    <span className="text-xs font-medium text-white/90">{HOTKEY_ROW_META[id].title}</span>
                    <p className="mt-1 text-xs text-app-muted">{HOTKEY_ROW_META[id].desc}</p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className="font-mono text-xs text-white">{hkDisplay[id]}</span>
                    {hkRecording === id && hkRecordingPreview ? (
                      <p className="mt-1 font-mono text-[11px] text-accent/90">→ {hkRecordingPreview}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className="font-mono text-xs text-white/50">{hkDefaultsDisplay[id]}</span>
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    <button
                      type="button"
                      className={`rounded-lg border px-3 py-1.5 text-xs ${
                        hkRecording === id
                          ? 'border-accent/50 bg-accent/20 text-white'
                          : 'border-white/10 bg-black/30 text-app-muted hover:border-white/20 hover:text-white'
                      }`}
                      onClick={() => setHkRecording(id)}
                    >
                      Изменить
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="px-4 py-3 font-mono text-xs text-white/55">Esc</td>
                <td className="px-4 py-3 text-app-muted" colSpan={3}>
                  Скрыть оверлей или окно шпаргалок / подборок (в фокусе)
                </td>
              </tr>
              <tr className="bg-white/[0.02]">
                <td className="px-4 py-3 font-mono text-xs text-white/55">← →</td>
                <td className="px-4 py-3 text-app-muted" colSpan={3}>
                  Переключение закреплённых статей в оверлее (вне поля ввода)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="glass space-y-5 rounded-2xl p-6">
        <div>
          <h2 className="text-sm font-semibold text-white">Окна поверх игры и оверлей</h2>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-app-muted">
            Главное окно LexPatrol, оверлей закрепов и отдельные окна шпаргалок / подборок — разные окна. Ниже — что относится к
            оверлею закрепов и главному окну. Горячие клавиши для шпаргалок и подборок задаются в таблице выше.
          </p>
        </div>

        <div className="space-y-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-app-muted">Главное окно</h3>
          <p className="text-xs text-app-muted">
            Удобно, если LexPatrol должен оставаться поверх браузера или блокнота при работе с текстами. На игру влияет слабее,
            чем настройки оверлея.
          </p>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 accent-accent"
              checked={mainAlwaysOnTop}
              onChange={(e) => setMainAlwaysOnTop(e.target.checked)}
            />
            <span className="text-sm text-app-muted">
              <span className="font-medium text-white">Держать главное окно поверх других окон</span>
              <span className="mt-1 block text-xs leading-relaxed opacity-90">
                Сохраняется в базе; после перезапуска приложения восстанавливается.
              </span>
            </span>
          </label>
        </div>

        <div className="space-y-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-app-muted">Оверлей закрепов</h3>
          <p className="text-xs text-app-muted">
            Отдельное полупрозрачное окно с закреплёнными статьями. Те же параметры можно менять на панели оверлея — значения
            синхронизируются с этой страницей.
          </p>

          <label className="block space-y-1.5 text-sm text-app-muted">
            <span className="text-xs font-medium text-white/90">Уровень «поверх других окон»</span>
            <span className="block text-[11px] leading-relaxed text-app-muted/95">
              Если оверлей уходит под игру или другие программы — выберите выше ступень. В полноэкранной игре с эксклюзивным
              полноэкранным режимом Windows часто не показывает сторонние окна — попробуйте оконный или безрамочный режим игры.
            </span>
            <select
              value={overlayAotLevel}
              onChange={(e) =>
                setOverlayAotLevel(e.target.value as 'off' | 'floating' | 'screen-saver' | 'pop-up-menu')
              }
              className="mt-1 w-full max-w-md rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
            >
              <option value="off">Выкл. (как обычное окно)</option>
              <option value="floating">Стандарт (floating)</option>
              <option value="screen-saver">Выше (screen-saver)</option>
              <option value="pop-up-menu">Максимально (pop-up-menu)</option>
            </select>
          </label>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-medium text-white/90">Прозрачность окна</label>
              <span className="font-mono text-xs text-app-muted">{Math.round(opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.28}
              max={1}
              step={0.01}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="h-2 w-full accent-accent"
            />
            <p className="text-[11px] text-app-muted">Слишком низкое значение делает текст труднее читаемым поверх игры.</p>
          </div>

          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 accent-accent"
              checked={clickThrough}
              onChange={(e) => setClickThrough(e.target.checked)}
            />
            <span className="text-sm text-app-muted">
              <span className="font-medium text-white">Пропускать клики сквозь оверлей в игру</span>
              <span className="mt-1 block text-xs leading-relaxed opacity-90">
                Когда включено, клики проходят в игру; на панели оверлея тот же режим переключается кнопкой или горячей клавишей{' '}
                <span className="font-mono text-white/80">{hkDisplay.clickThrough}</span>.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
            <button
              type="button"
              onClick={() => void window.lawHelper.overlay.show()}
              className="rounded-lg border border-white/10 bg-surface-raised px-4 py-2 text-sm text-white hover:bg-surface-hover"
            >
              Показать оверлей
            </button>
            <button
              type="button"
              onClick={() => void window.lawHelper.overlay.hide()}
              className="rounded-lg border border-white/10 bg-surface-raised px-4 py-2 text-sm text-white hover:bg-surface-hover"
            >
              Скрыть оверлей
            </button>
            <button
              type="button"
              onClick={() => void window.lawHelper.overlay.raise()}
              className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-accent hover:bg-accent/20"
            >
              Вынести оверлей на передний план
            </button>
          </div>
        </div>
      </section>

      <section className="glass space-y-4 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white">Резервная копия базы</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-app-muted">
          Файл JSON содержит все данные LexPatrol на этом компьютере: документы и статьи, источники, теги, закладки, заметки,
          подборки, шпаргалки, закрепы оверлея, настройки приложения (в т.ч. горячие клавиши и параметры оверлея), агентов ИИ и
          прочее. Формат версии 1 — его же можно импортировать обратно.
        </p>
        <ul className="list-inside list-disc space-y-1.5 text-xs text-app-muted">
          <li>
            <span className="text-white/85">Экспорт</span> — сохраните файл в надёжное место или перенесите на другой ПК.
          </li>
          <li>
            <span className="text-white/85">Импорт</span> — полностью заменяет текущую базу содержимым файла. Сделайте экспорт
            текущих данных, если они ещё нужны.
          </li>
          <li>После успешного импорта интерфейс обновится автоматически (включая открытые окна оверлея, если они были).</li>
        </ul>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => void backup()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim"
          >
            Сохранить копию в файл…
          </button>
          <button
            type="button"
            disabled={backupBusy}
            onClick={() => void restoreBackup()}
            className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
          >
            {backupBusy ? 'Импорт…' : 'Импорт из файла…'}
          </button>
        </div>
      </section>
    </div>
  )
}
