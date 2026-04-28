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

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-white">Настройки</h1>
        <p className="mt-2 max-w-2xl text-sm text-app-muted leading-relaxed">
          Управление оверлеем и резервными копиями. Горячие клавиши работают глобально (когда LexPatrol запущен).
        </p>
      </header>

      <section className="glass space-y-4 rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Горячие клавиши</h2>
            <p className="mt-1 max-w-xl text-xs text-app-muted">
              Глобальные сочетания (работают, пока запущен LexPatrol). Нужны модификаторы (Ctrl/Alt/Shift). Нажмите
              «Изменить», затем новое сочетание; Esc — отмена записи. Три действия не должны совпадать.
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
          Главное окно и оверлей настраиваются отдельно. У оверлея — уровень «поверх» (Electron{' '}
          <span className="font-mono text-white/70">setAlwaysOnTop</span>). Если что-то всё равно перекрывает — выберите
          «Выше» или «Максимально». Полноэкранный <span className="text-white/70">exclusive</span> режим игры (DirectX)
          часто рисует поверх всех окон ОС — тогда без режима «в окне»/borderless подсказка не поможет.
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
          Прозрачность и «клик сквозь» синхронны с панелью оверлея.           На самой панели есть переключатели «В оверлей» / «В игру» и назначаемая глобальная клавиша ({hkDisplay.clickThrough}
          ).
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

      <section className="glass space-y-3 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white">Установка и предупреждения Windows</h2>
        <p className="text-xs leading-relaxed text-app-muted">
          Без платной цифровой подписи Microsoft часто показывает SmartScreen — это нормально для новых программ. Полностью
          убрать окно без сертификата нельзя, но можно реже сталкиваться с лишними шагами.
        </p>
        <ul className="list-inside list-disc space-y-2 text-xs leading-relaxed text-app-muted">
          <li>
            <span className="text-white/85">Скачали из браузера:</span> ПКМ по установщику → Свойства → вкладка «Общие»
            → при наличии включите «Разблокировать» → ОК. Так снимается метка «из интернета» и иногда меньше вопросов от
            системы.
          </li>
          <li>
            <span className="text-white/85">Синее окно SmartScreen:</span> «Подробнее» → «Выполнить в любом случае» — если
            вы доверяете источнику сборки.
          </li>
          <li>
            Установщик по умолчанию ставит приложение для{' '}
            <span className="text-white/75">текущего пользователя</span> без запроса прав администратора (меньше пар UAC).
            Если вручную указать папку в Program Files, Windows может запросить повышение прав отдельно.
          </li>
        </ul>
      </section>

      <section className="glass space-y-4 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white">Резервное копирование</h2>
        <p className="text-sm text-app-muted">Экспорт JSON со всеми таблицами для переноса на другой ПК.</p>
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
