import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3009,
    open: true,
    fs: {
      allow: ['.'],
    },
    // UI test fixtures and build caches in .cache hold thousands of folders the app never imports.
    watch: {
      ignored: ['**/.cache/**'],
    },
  },
  publicDir: 'public',
  build: {
    // public/workspace is a junction into workspace/ (gigabytes of reports).
    // The dashboard is a dev-server tool, so never copy publicDir into dist.
    copyPublicDir: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
})
