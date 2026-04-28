/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /** Текст на тёмном фоне (не использовать как bg-* — см. canvas) */
        app: {
          DEFAULT: '#e7e9ee',
          muted: '#9aa3b2'
        },
        /** Фон основного UI (sidebar/main), не оверлея */
        canvas: {
          DEFAULT: '#0a0b0f'
        },
        surface: {
          DEFAULT: '#12151c',
          raised: '#181c26',
          hover: '#1e2430'
        },
        accent: {
          DEFAULT: '#5b8cff',
          dim: '#3d5fb5'
        }
      },
      boxShadow: {
        glass: '0 12px 40px rgba(0,0,0,0.45)'
      }
    }
  },
  plugins: []
}
