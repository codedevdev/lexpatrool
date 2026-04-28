import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/** Файлы из extraResources лежат в process.resourcesPath рядом с app.asar. */
export function resolveAppIconPath(): string | undefined {
  if (app.isPackaged) {
    const p = join(process.resourcesPath, 'app-icon.png')
    return existsSync(p) ? p : undefined
  }
  const dev = join(process.cwd(), 'resources', 'app-icon.png')
  const relMain = join(__dirname, '../../resources/app-icon.png')
  if (existsSync(dev)) return dev
  if (existsSync(relMain)) return relMain
  return undefined
}

export function resolveSplashHtmlPath(): string | undefined {
  if (app.isPackaged) {
    const p = join(process.resourcesPath, 'splash.html')
    return existsSync(p) ? p : undefined
  }
  const dev = join(process.cwd(), 'resources', 'splash.html')
  const relMain = join(__dirname, '../../resources/splash.html')
  if (existsSync(dev)) return dev
  if (existsSync(relMain)) return relMain
  return undefined
}
