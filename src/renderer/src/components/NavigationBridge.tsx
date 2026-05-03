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

  useEffect(() => {
    const api = window.lawHelper
    if (!api?.update?.onAfterUpdate) return
    const off = api.update.onAfterUpdate((p) => {
      if (p.reader?.documentId) {
        if (p.reader.articleId) {
          navigate(`/reader/${p.reader.documentId}/${p.reader.articleId}`)
        } else {
          navigate(`/reader/${p.reader.documentId}`)
        }
      } else if (p.route && typeof p.route === 'string') {
        const r = p.route.startsWith('/') ? p.route : `/${p.route}`
        navigate(r)
      }
    })
    return off
  }, [navigate])

  return null
}
