import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@parsers': resolve(__dirname, 'src/parsers')
      },
      dedupe: ['react', 'react-dom']
    },
    plugins: [react()],
    /** Стабильный pre-bundle React в Electron (иначе в консоли бывает SyntaxError по jsx-runtime / «react.jss»). */
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-router',
        'react-router-dom'
      ],
      esbuildOptions: {
        target: 'esnext'
      }
    },
    server: {
      strictPort: true,
      hmr: {
        host: 'localhost',
        protocol: 'ws'
      }
    }
  }
})
