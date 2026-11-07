/**
 * AI module map
 * Purpose: configure the native WebView frontend entries.
 * Entry: Vite loads this config for development and bundling.
 * Flow: read package.json version into __APP_VERSION__, register React/Tailwind plugins,
 * resolve @ aliases, and bundle main/overlay/toolbar HTML with relative asset paths.
 * Invariants: keep output entry names aligned with Rust WebviewUrl paths; dev host/port
 * must agree with Tauri startup arguments and CSP. Reading this file does not authorize a build.
 */

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
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Vite's error forwarding recurses when a CDP page's HMR socket fails to connect.
    forwardConsole: false,
  },
})
