import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/** Синхронизирует IPC «открыть читатель» (например из оверлея) с React Router. */
export function NavigationBridge(): null {
  const navigate = useNavigate()

  useEffect(() => {
    const api = window.lawHelper
    if (!api?.onOpenReader) return
    const off = api.onOpenReader(({ documentId, articleId }) => {
      if (articleId) {
        navigate(`/reader/${documentId}/${articleId}`)
      } else {
        navigate(`/reader/${documentId}`)
      }
    })
    return off
  }, [navigate])

  return null
}
