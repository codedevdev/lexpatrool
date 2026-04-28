import { app, BrowserWindow, dialog, ipcMain, shell, globalShortcut, Menu } from 'electron'
import { join } from 'path'
import { initDatabase, closeDatabase, getDb } from './database'
import { registerIpcHandlers } from './ipc/handlers'
import { OverlayController } from './overlay-window'
import { setMainWindowAlwaysOnTop } from './window-always-on-top'
import { resolveAppIconPath, resolveSplashHtmlPath } from './app-resources'
import { applyOverlayGlobalShortcuts } from './global-shortcuts'
import { destroyTray, isAppQuitting, setupSystemTray } from './system-tray'
import { scheduleStartupUpdateCheck } from './update-check'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/**
 * Portable target (electron-builder): база и настройки рядом с .exe в папке LexPatrolData.
 * Иначе данные в %APPDATA% — при «передаче только exe» у другого человека пустая база и «оверлей не работает».
 * Должно быть до app.whenReady() и до любого обращения к userData.
 */
if (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_DIR) {
  try {
    app.setPath('userData', join(process.env.PORTABLE_EXECUTABLE_DIR, 'LexPatrolData'))
  } catch (e) {
    console.warn('[LexPatrol] portable userData path:', e)
  }
}

/** Совпадает с build.appId — корректная привязка к панели задач и слегка предсказуемее поведение ОС без подписи. */
const WIN_APP_USER_MODEL_ID = 'io.lexpatrol.desktop'
if (process.platform === 'win32') {
  app.setAppUserModelId(WIN_APP_USER_MODEL_ID)
}

/** Продакшен: без стандартного меню File / Edit / View (Windows/Linux). */
function setProductionMenu(): void {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        },
        {
          label: 'Правка',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' }
          ]
        }
      ])
    )
  } else {
    Menu.setApplicationMenu(null)
  }
}

/**
 * На части систем Windows окно рендерера остаётся чёрным (GPU / драйвер).
 * Отключение GPU обычно помогает. Обход: LEX_NO_DISABLE_GPU=1
 */
if (process.platform === 'win32' && process.env['LEX_NO_DISABLE_GPU'] !== '1') {
  app.disableHardwareAcceleration()
}

let mainWindow: BrowserWindow | null = null
let overlay: OverlayController | null = null

function createSplashWindow(): BrowserWindow | null {
  const htmlPath = resolveSplashHtmlPath()
  if (!htmlPath) return null
  const iconPath = resolveAppIconPath()
  const splash = new BrowserWindow({
    width: 420,
    height: 360,
    frame: false,
    backgroundColor: '#0c0e12',
    show: false,
    center: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  splash.once('ready-to-show', () => splash.show())
  void splash.loadFile(htmlPath)
  return splash
}

function createMainWindow(options?: { deferShow?: boolean }): BrowserWindow {
  const deferShow = options?.deferShow === true
  const iconPath = resolveAppIconPath()
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'LexPatrol',
    backgroundColor: '#0c0e12',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      /** В dev иначе Vite/HMR иногда даёт пустой экран при webSecurity */
      webSecurity: app.isPackaged
    }
  })

  if (!deferShow) {
    win.on('ready-to-show', () => win.show())
  }

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    const base = devUrl.replace(/\/$/, '')
    // HashRouter: явный hash снижает шанс пустого маршрута при загрузке с dev-сервера
    void win.loadURL(`${base}/#/`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/' })
  }

  win.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('[LexPatrol] did-fail-load', code, desc, url)
    if (!app.isPackaged) {
      void dialog.showMessageBox(win, {
        type: 'error',
        title: 'Не удалось загрузить интерфейс',
        message: desc || 'Ошибка загрузки',
        detail: `URL: ${url}\nКод: ${code}\n\nПроверьте, что Vite запущен (npm run dev) и порт 5173 доступен.`
      })
    }
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[LexPatrol] render-process-gone', details)
  })

  /** Autofill.* в консоли — шум DevTools+Electron; открывай инструменты вручную (Ctrl+Shift+I) или LEX_OPEN_DEVTOOLS=1 */
  if (!app.isPackaged && process.env['LEX_OPEN_DEVTOOLS'] === '1') {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  return win
}

function wireMainWindowHideToTray(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (!isAppQuitting()) {
      e.preventDefault()
      win.hide()
    }
  })
}

function applyMainWindowAlwaysOnTop(win: BrowserWindow): void {
  try {
    const row = getDb()
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get('main_window_always_on_top') as { value: string } | undefined
    setMainWindowAlwaysOnTop(win, row?.value === '1')
  } catch {
    /* ignore */
  }
}

function closeSplashAndShowMain(splash: BrowserWindow | null, win: BrowserWindow): void {
  if (splash && !splash.isDestroyed()) splash.close()
  if (!win.isDestroyed()) {
    win.show()
    win.focus()
  }
}

app.whenReady().then(() => {
  setProductionMenu()
  initDatabase()

  const splash = createSplashWindow()
  mainWindow = createMainWindow({ deferShow: splash != null })
  wireMainWindowHideToTray(mainWindow)
  applyMainWindowAlwaysOnTop(mainWindow)
  overlay = new OverlayController(getDb)

  const startTray = (): void => {
    setupSystemTray(() => mainWindow)
  }

  if (splash != null && mainWindow) {
    let fallbackTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      fallbackTimer = null
      closeSplashAndShowMain(splash, mainWindow!)
      startTray()
    }, 30000)

    const finish = (): void => {
      if (fallbackTimer != null) {
        clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
      closeSplashAndShowMain(splash, mainWindow!)
      startTray()
    }
    mainWindow.once('ready-to-show', finish)
  } else {
    startTray()
  }

  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getDb,
    overlay,
    openExternal: (url: string) => shell.openExternal(url)
  })

  ipcMain.on('app:open-external', (_e, url: string) => {
    if (typeof url === 'string' && url.startsWith('http')) shell.openExternal(url)
  })

  applyOverlayGlobalShortcuts(overlay, getDb)

  scheduleStartupUpdateCheck(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    globalShortcut.unregisterAll()
    closeDatabase()
    app.quit()
  }
})

app.on('will-quit', () => {
  destroyTray()
  globalShortcut.unregisterAll()
  closeDatabase()
})
