import { useCallback } from 'react'
import { useInAppUpdateFlow } from '../hooks/useInAppUpdateFlow'
import { UpdateInstallModal } from './UpdateInstallModal'

export type InAppBannerPayload = {
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  downloadUrl: string
  publishedAt?: string
  releaseNotes?: string
  critical?: boolean
}

function fmtReleaseDate(iso?: string): string {
  if (!iso?.trim()) return ''
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function InAppUpdateBanner({
  data,
  onDismissed
}: {
  data: InAppBannerPayload
  onDismissed: () => void
}): JSX.Element {
  const flow = useInAppUpdateFlow(data.latestVersion)
  const mandatory = flow.snoozeExhausted || data.critical === true

  const snoozeLater = useCallback(async (): Promise<void> => {
    if (mandatory) return
    const r = await window.lawHelper.update.snooze(data.latestVersion)
    if (r.ok && r.blocked) {
      /* exhausted — parent may re-show */
    }
    onDismissed()
  }, [data.latestVersion, mandatory, onDismissed])

  return (
    <>
      <div className="shrink-0 border-b border-emerald-500/25 bg-emerald-500/[0.08] px-4 py-3 sm:px-8" role="status">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm text-emerald-50/95">
            <span className="font-semibold text-white">Доступна новая версия</span>{' '}
            <span className="text-emerald-100/85">
              {data.currentVersion} → {data.latestVersion}
            </span>
            {fmtReleaseDate(data.publishedAt) ? (
              <span className="ml-2 text-xs text-emerald-100/55">· {fmtReleaseDate(data.publishedAt)}</span>
            ) : null}
            {data.critical ? (
              <span className="mt-1 block text-xs font-medium text-amber-200/95">
                В релизе отмечено важное обновление ([critical]). Установите новую версию.
              </span>
            ) : null}
            {flow.snoozeExhausted && !data.critical ? (
              <span className="mt-1 block text-xs leading-snug text-amber-100/90">
                Отложить обновление больше нельзя — установите новую версию.
              </span>
            ) : null}
            {!flow.snoozeExhausted && !data.critical ? (
              <span className="mt-1 block text-xs leading-snug text-emerald-100/70">
                Можно скачать и установить из приложения (Windows) или открыть страницу релиза.
              </span>
            ) : null}
            {data.releaseNotes ? (
              <p className="mt-2 max-h-[4.5rem] overflow-y-auto whitespace-pre-wrap rounded-md border border-emerald-500/20 bg-black/20 px-2 py-1.5 text-[11px] leading-relaxed text-emerald-50/90 lex-app-scroll">
                {data.releaseNotes}
              </p>
            ) : null}
            {flow.phase === 'downloading' || flow.phase === 'validating' ? (
              <div className="mt-2 text-xs text-emerald-100/85">
                {flow.phase === 'validating' ? 'Проверка файла…' : 'Скачивание'}
                {flow.progress?.percent != null ? ` · ${flow.progress.percent.toFixed(0)}%` : ''}
                {flow.progress?.bytesPerSecond != null && flow.progress.bytesPerSecond > 0
                  ? ` · ${fmtBytes(flow.progress.bytesPerSecond)}/s`
                  : ''}
                {flow.progress?.total != null
                  ? ` · ${fmtBytes(flow.progress.received)} / ${fmtBytes(flow.progress.total)}`
                  : ''}
              </div>
            ) : null}
            {flow.downloadError ? <p className="mt-2 text-xs text-red-300/95">{flow.downloadError}</p> : null}
            {flow.phase === 'ready-to-install' && !flow.installModal ? (
              <button
                type="button"
                className="mt-2 rounded-lg border border-emerald-500/40 px-3 py-1 text-xs text-emerald-100 hover:bg-emerald-500/15"
                onClick={() => flow.setInstallModal(true)}
              >
                Продолжить установку
              </button>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-white/15 bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.12]"
              onClick={() => window.lawHelper.shell.openExternal(data.releaseUrl)}
            >
              Страница релиза
            </button>
            {flow.inApp === true ? (
              <>
                <button
                  type="button"
                  disabled={flow.busy || flow.phase === 'downloading' || flow.phase === 'validating'}
                  className="rounded-lg bg-emerald-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                  onClick={() => void flow.startDownload()}
                >
                  {flow.phase === 'downloading' || flow.phase === 'validating' ? 'Скачивание…' : 'Скачать и обновить'}
                </button>
                {(flow.phase === 'downloading' || flow.phase === 'validating') && (
                  <button
                    type="button"
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/90 hover:bg-white/[0.08]"
                    onClick={() => flow.cancelDownload()}
                  >
                    Отмена
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                className="rounded-lg bg-emerald-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
                onClick={() => window.lawHelper.shell.openExternal(data.downloadUrl)}
              >
                Скачать файл
              </button>
            )}
            {!mandatory ? (
              <button
                type="button"
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-emerald-100/90 hover:bg-white/[0.06]"
                onClick={() => void snoozeLater()}
              >
                Позже
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {flow.installModal ? (
        <UpdateInstallModal
          open
          latestVersion={data.latestVersion}
          silentInstall={flow.silentInstall}
          onSilentChange={flow.setSilentInstall}
          onCancel={() => {
            flow.setInstallModal(false)
          }}
          onConfirm={() => void flow.confirmInstall()}
        />
      ) : null}
    </>
  )
}
