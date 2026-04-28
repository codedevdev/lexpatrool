import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { resolveAppIconPath } from './app-resources'

let tray: Tray | null = null
let appQuitting = false

export function isAppQuitting(): boolean {
  return appQuitting
}

export function setAppQuitting(value: boolean): void {
  appQuitting = value
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) {
    tray.destroy()
    tray = null
  }
}

/**
 * Иконка в трее: окно можно вернуть и полностью закрыть приложение (как у типичных десктоп-клиентов).
 */
export function setupSystemTray(getMainWindow: () => BrowserWindow | null): void {
  destroyTray()

  const iconPath = resolveAppIconPath()
  if (!iconPath) {
    console.warn('[LexPatrol] tray: icon not found')
    return
  }

  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    console.warn('[LexPatrol] tray: empty icon image')
    return
  }
  const size = image.getSize()
  if (size.width > 32 || size.height > 32) {
    image = image.resize({ width: 32, height: 32 })
  }

  tray = new Tray(image)
  tray.setToolTip('LexPatrol')

  const showMain = (): void => {
    const w = getMainWindow()
    if (!w || w.isDestroyed()) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }

  const menu = Menu.buildFromTemplate([
    {
      label: 'Открыть LexPatrol',
      click: () => showMain()
    },
    { type: 'separator' },
    {
      label: 'Выйти',
      click: () => {
        setAppQuitting(true)
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)

  tray.on('click', () => {
    showMain()
  })
}
