export function UpdateInstallModal(props: {
  open: boolean
  latestVersion: string
  silentInstall: boolean
  onSilentChange: (v: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element | null {
  if (!props.open) return null
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12151c] p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-white">Установить обновление до v{props.latestVersion}?</h2>
        <p className="mt-2 text-sm leading-relaxed text-app-muted">
          Приложение закроется, установщик обновит файлы и LexPatrol запустится снова. Не выключайте компьютер во время
          установки.
        </p>
        <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-app-muted">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 rounded border-white/25 bg-surface-raised text-accent"
            checked={props.silentInstall}
            onChange={(e) => props.onSilentChange(e.target.checked)}
          />
          <span>Тихая установка (без лишних окон мастера), если поддерживается установщиком</span>
        </label>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/90 hover:bg-white/[0.06]"
            onClick={props.onCancel}
          >
            Позже
          </button>
          <button
            type="button"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim"
            onClick={props.onConfirm}
          >
            Сейчас
          </button>
        </div>
      </div>
    </div>
  )
}
