import type { BrowserWindow } from 'electron'

/**
 * Уровень для главного окна: обычный setAlwaysOnTop(true) на Windows часто проигрывает полноэкранным играм/«поверх всех» у других приложений.
 * screen-saver — один из самых высоких уровней в Electron/Chromium для Win/Linux.
 */
export function setMainWindowAlwaysOnTop(win: BrowserWindow | null, enabled: boolean): void {
  if (!win || win.isDestroyed()) return
  if (!enabled) {
    win.setAlwaysOnTop(false)
    return
  }
  try {
    if (process.platform === 'win32' || process.platform === 'linux') {
      win.setAlwaysOnTop(true, 'screen-saver')
    } else {
      win.setAlwaysOnTop(true, 'floating')
    }
  } catch {
    win.setAlwaysOnTop(true)
  }
}
