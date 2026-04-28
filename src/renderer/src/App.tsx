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
import { NotesPage } from './features/notes/NotesPage'
import { GovernmentPage } from './features/government/GovernmentPage'
import { NavigationBridge } from './components/NavigationBridge'

export default function App(): JSX.Element {
  const location = useLocation()
  /** HashRouter: file:// и прод-сборка — pathname должен совпасть, иначе в окне оверлея отрисуется основное приложение. */
  if (location.pathname === '/overlay' || location.pathname.startsWith('/overlay/')) {
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
