import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))

const plugins = [react()]
const resolve = {
  alias: {
    electron: path.resolve(root, 'src/test-utils/stubs/electron.ts'),
    '@': path.resolve(root, 'src/renderer/src'),
    '@shared': path.resolve(root, 'src/shared'),
    '@parsers': path.resolve(root, 'src/parsers')
  }
}
const setupFiles = ['src/test-utils/vitest-setup.ts'] as const

/** Строгий профиль только для Tier 1 (без merge с базовым coverage.include). */
export default defineConfig({
  plugins,
  resolve,
  test: {
    setupFiles: [...setupFiles],
    projects: [
      {
        plugins,
        resolve,
        test: {
          name: 'unit-node',
          setupFiles: [...setupFiles],
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/renderer/**']
        }
      },
      {
        plugins,
        resolve,
        test: {
          name: 'unit-renderer',
          setupFiles: [...setupFiles],
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}']
        }
      }
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/critical',
      reporter: ['text', 'lcov', 'html', 'json-summary', 'json'],
      reportOnFailure: true,
      all: false,
      include: [
        'src/main/updater/**/*.ts',
        'src/shared/**/*.ts',
        'src/services/retrieval.ts',
        'src/parsers/html-element-plain-text.ts',
        'src/parsers/article-import-filter.ts',
        'src/main/seed.ts',
        'src/main/global-shortcuts.ts',
        'src/main/ipc/merge-agent-config.ts'
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/node_modules/**',
        '**/__fixtures__/**',
        'src/test-utils/**'
      ],
      thresholds: {
        lines: 75,
        branches: 66,
        functions: 72,
        statements: 75
      }
    }
  }
})
