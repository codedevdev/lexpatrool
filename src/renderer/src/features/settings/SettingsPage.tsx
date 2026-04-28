import { useEffect, useState } from 'react'
import { keyboardEventToAccelerator } from '../../lib/hotkey-format'

type HotkeyField = 'toggle' | 'search' | 'clickThrough'

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
    clickThrough: 'Ctrl+Shift+G'
  })
  const [hkRecording, setHkRecording] = useState<HotkeyField | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [updateRepo, setUpdateRepo] = useState('')
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<string | null>(null)
  const [updateResult, setUpdateResult] = useState<Awaited<ReturnType<typeof window.lawHelper.update.check>> | null>(
    null
  )

  useEffect(() => {
    void window.lawHelper.getVersion().then(setAppVersion)
    void window.lawHelper.update.repoLabel().then(setUpdateRepo)
  }, [])

  useEffect(() => {
    void window.lawHelper.hotkeys
      .get()
      .then((h) => setHkDisplay(h.display))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!hkRecording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') {
        setHkRecording(null)
        return
      }
      const acc = keyboardEventToAccelerator(e)
      if (!acc) return
      void window.lawHelper.hotkeys.set({ [hkRecording]: acc }).then((r) => {
        if (r.ok) {
          void window.lawHelper.hotkeys.get().then((h) => setHkDisplay(h.display))
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
          `Доступна версия ${r.latestVersion}. Установщик берите со страницы релиза; при желании сверьте контрольную сумму в блоке файлов.`
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
            <span className="text-white/85">Обновления</span> — ручная проверка новой сборки на GitHub и переход к странице релиза
            или файлу установки.
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
            <span className="text-white/85">Резервная копия</span> — экспорт базы в файл в конце страницы; сохраните перед переездом
            на другой ПК или переустановкой приложения.
          </li>
        </ul>
      </section>

      <section className="glass space-y-4 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white">Обновления</h2>
        <p className="text-xs leading-relaxed text-app-muted">
          Текущая версия: <span className="font-mono text-white/90">{appVersion || '…'}</span>. Обновления проверяются по
          официальным релизам на{' '}
          <span className="font-mono text-white/80">github.com/{updateRepo || '…'}</span>. Установочный файл скачивается с
          страницы релиза; наличие подписи зависит от настроек сборки.
        </p>
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
                void window.lawHelper.hotkeys.get().then((h) => setHkDisplay(h.display))
              })
            }}
          >
            Сбросить по умолчанию
          </button>
        </div>

        {hkRecording ? (
          <div className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
            Запись: нажмите новое сочетание… (Esc — отмена)
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-white/5">
              {(
                [
                  ['toggle', hkDisplay.toggle, 'Показать / скрыть оверлей'],
                  ['search', hkDisplay.search, 'Открыть оверлей и фокус на поиске по базе'],
                  ['clickThrough', hkDisplay.clickThrough, 'Переключить режим мыши: оверлей ↔ игра']
                ] as const
              ).map(([id, label, desc]) => (
                <tr key={id} className="bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-accent/90">{label}</span>
                    <p className="mt-1 text-xs text-app-muted">{desc}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
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
                <td className="px-4 py-3 text-app-muted">Скрыть оверлей (когда он в фокусе)</td>
              </tr>
              <tr className="bg-white/[0.02]">
                <td className="px-4 py-3 font-mono text-xs text-white/55">← →</td>
                <td className="px-4 py-3 text-app-muted">Переключение закреплённых статей в оверлее (вне поля ввода)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="glass space-y-4 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white">Окна: поверх других</h2>
        <p className="text-xs text-app-muted">
          Главное окно и оверлей настраиваются отдельно. Для оверлея можно повысить приоритет отображения, если его перекрывают
          другие программы. В полноэкранном режиме игры с захватом экрана Windows может не показывать окна поверх — тогда
          используйте оконный или безрамочный режим игры.
        </p>
        <label className="flex items-center gap-2 text-sm text-app-muted">
          <input
            type="checkbox"
            className="accent-accent"
            checked={mainAlwaysOnTop}
            onChange={(e) => setMainAlwaysOnTop(e.target.checked)}
          />
          Главное окно LexPatrol поверх других
        </label>
        <label className="block space-y-1.5 text-sm text-app-muted">
          Оверлей — уровень «поверх»
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
      </section>

      <section className="glass space-y-4 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white">Оверлей (синхрон с главным окном)</h2>
        <p className="text-xs text-app-muted">
          Прозрачность и режим «клики проходят в игру» совпадают с панелью оверлея. Там же переключатель «В оверлей» / «В игру»
          и горячая клавиша ({hkDisplay.clickThrough}).
        </p>
        <label className="block space-y-2 text-xs text-app-muted">
          Прозрачность
          <input
            type="range"
            min={0.28}
            max={1}
            step={0.01}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="h-2 w-full accent-accent"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-app-muted">
          <input type="checkbox" className="accent-accent" checked={clickThrough} onChange={(e) => setClickThrough(e.target.checked)} />
          Пропуск кликов сквозь окно оверлея
        </label>
        <div className="flex flex-wrap gap-2 pt-2">
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
            Поверх всех окон
          </button>
        </div>
      </section>

      <section className="glass space-y-4 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white">Резервное копирование</h2>
        <p className="text-sm text-app-muted">
          Сохраните копию базы в файл для переноса на другой компьютер или резервной архивации.
        </p>
        <button
          type="button"
          onClick={() => void backup()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim"
        >
          Сохранить бэкап…
        </button>
      </section>
    </div>
  )
}
