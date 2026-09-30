// Renderer-only dev server (browser preview with demo data, no Electron).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  root: 'src/renderer',
  resolve: {
    alias: { '@': resolve('src/renderer/src'), '@shared': resolve('src/shared') }
  },
  plugins: [react(), tailwindcss()],
  server: { port: 5199, strictPort: true }
})
