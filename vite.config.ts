import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
)

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        overlay: path.resolve(import.meta.dirname, 'overlay.html'),
        toolbar: path.resolve(import.meta.dirname, 'toolbar.html'),
      },
    },
  },
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
})
