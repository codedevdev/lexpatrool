import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const pngPath = path.join(root, 'resources', 'app-icon.png')
const outDir = path.join(root, 'build')
const outPath = path.join(outDir, 'icon.ico')

if (!fs.existsSync(pngPath)) {
  console.error('[gen-windows-icon] Missing:', pngPath)
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })
const buf = await pngToIco(pngPath)
fs.writeFileSync(outPath, buf)
console.log('[gen-windows-icon] Wrote', outPath)
