import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

const alias = {
  '@': resolve('src/renderer/src'),
  '@shared': resolve('src/shared')
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    plugins: [
      react(),
      tailwindcss(),
      {
        // Strict CSP in production builds only (dev needs inline scripts for HMR).
        name: 'csp',
        apply: 'build',
        transformIndexHtml: (html: string) =>
          html.replace(
            '<!--CSP-->',
            `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'" />`
          )
      }
    ]
  }
})
