import { useCallback, useEffect, useState } from 'react'

export function currentRouteFromHash(): string {
  try {
    const h = window.location.hash.replace(/^#/, '').split('?')[0] || ''
    if (!h) return '/'
    return h.startsWith('/') ? h : `/${h}`
  } catch {
    return '/'
  }
}

export function useInAppUpdateFlow(latestVersion: string | undefined): {
  inApp: boolean | null
  snoozeExhausted: boolean
  phase: string
  progress: {
    received: number
    total: number | null
    percent: number | null
    bytesPerSecond: number | null
  } | null
  downloadError: string | null
  installModal: boolean
  silentInstall: boolean
  setSilentInstall: (v: boolean) => void
  setInstallModal: (v: boolean) => void
  setPhase: (v: string) => void
  startDownload: () => Promise<void>
  cancelDownload: () => void
  confirmInstall: () => Promise<void>
  busy: boolean
} {
  const [inApp, setInApp] = useState<boolean | null>(null)
  const [snoozeExhausted, setSnoozeExhausted] = useState(false)
  const [phase, setPhase] = useState<string>('idle')
  const [progress, setProgress] = useState<{
    received: number
    total: number | null
    percent: number | null
    bytesPerSecond: number | null
  } | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [installModal, setInstallModal] = useState(false)
  const [silentInstall, setSilentInstall] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.lawHelper.update.inAppAvailable().then((r) => setInApp(r.supported))
  }, [])

  useEffect(() => {
    if (!latestVersion) return
    void window.lawHelper.update.snoozeStatus(latestVersion).then((s) => setSnoozeExhausted(s.exhausted))
  }, [latestVersion])

  useEffect(() => {
    const offP = window.lawHelper.update.onPhase((p) => setPhase(p.phase))
    const offPr = window.lawHelper.update.onProgress((p) => setProgress(p))
    return () => {
      offP()
      offPr()
    }
  }, [])

  const startDownload = useCallback(async (): Promise<void> => {
    setDownloadError(null)
    setBusy(true)
    setProgress(null)
    try {
      const r = await window.lawHelper.update.download()
      if (!r.ok) {
        setDownloadError(r.message)
      } else {
        setInstallModal(true)
      }
    } finally {
      setBusy(false)
    }
  }, [])

  const cancelDownload = useCallback((): void => {
    void window.lawHelper.update.cancelDownload()
    setBusy(false)
    setProgress(null)
  }, [])

  const confirmInstall = useCallback(async (): Promise<void> => {
    setInstallModal(false)
    const r = await window.lawHelper.update.apply({
      silent: silentInstall,
      route: currentRouteFromHash()
    })
    if (!r.ok) {
      setDownloadError(r.message)
    }
  }, [silentInstall])

  return {
    inApp,
    snoozeExhausted,
    phase,
    progress,
    downloadError,
    installModal,
    silentInstall,
    setSilentInstall,
    setInstallModal,
    setPhase,
    startDownload,
    cancelDownload,
    confirmInstall,
    busy
  }
}
