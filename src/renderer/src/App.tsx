import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { ImportPage } from './features/import/ImportPage'
import { BrowserImportPage } from './features/import/BrowserImportPage'
import { KnowledgeBasePage } from './features/knowledge-base/KnowledgeBasePage'
import { ReaderPage } from './features/reader/ReaderPage'
import { AiPage } from './features/ai/AiPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { OverlayPage } from './features/overlay/OverlayPage'
import { CheatOverlayPage } from './features/overlay/CheatOverlayPage'
import { CollectionOverlayPage } from './features/overlay/CollectionOverlayPage'
import { NotesPage } from './features/notes/NotesPage'
import { GovernmentPage } from './features/government/GovernmentPage'
import { CollectionsPage } from './features/collections/CollectionsPage'
import { CheatSheetsPage } from './features/cheats/CheatSheetsPage'
import { NavigationBridge } from './components/NavigationBridge'

export default function App(): JSX.Element {
  const location = useLocation()
  const rawHash =
    typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '').split('?')[0] || '' : ''
  const pathFromHash = rawHash === '' ? '' : rawHash.startsWith('/') ? rawHash : `/${rawHash}`
  const matchesRoute = (prefix: string): boolean =>
    location.pathname === prefix ||
    location.pathname.startsWith(`${prefix}/`) ||
    pathFromHash === prefix ||
    pathFromHash.startsWith(`${prefix}/`)

  if (matchesRoute('/overlay-cheats')) {
    return <CheatOverlayPage />
  }
  if (matchesRoute('/overlay-collections')) {
    return <CollectionOverlayPage />
  }
  const isOverlay =
    location.pathname === '/overlay' ||
    location.pathname.startsWith('/overlay/') ||
    pathFromHash === '/overlay' ||
    pathFromHash.startsWith('/overlay/')
  /** HashRouter + отдельное окно: только OverlayPage, без AppShell. */
  if (isOverlay) {
    return <OverlayPage />
  }

  return (
    <>
      <NavigationBridge />
      <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/browser" element={<BrowserImportPage />} />
        <Route path="/kb" element={<KnowledgeBasePage />} />
        <Route path="/collections" element={<CollectionsPage />} />
        <Route path="/cheats" element={<CheatSheetsPage />} />
        <Route path="/patrol" element={<GovernmentPage />} />
        <Route path="/government" element={<Navigate to="/patrol" replace />} />
        <Route path="/mvd" element={<Navigate to="/patrol" replace />} />
        <Route path="/reader/:documentId/:articleId?" element={<ReaderPage />} />
        <Route path="/ai" element={<AiPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </AppShell>
    </>
  )
}
