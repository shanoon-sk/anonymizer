import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))
const define = { __APP_VERSION__: JSON.stringify(pkg.version) }

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          worker: resolve(__dirname, 'src/main/worker.ts')
        }
      }
    }
  },
  preload: {
    define,
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // Sandboxed preload scripts must be CommonJS
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    define,
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
})
