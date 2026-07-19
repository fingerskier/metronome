import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'

const manifest = JSON.parse(readFileSync('./public/site.webmanifest', 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest,
    }),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  base: '/metronome/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  test: {
    // jsdom, not the default 'node' env -- the hooks touch localStorage,
    // navigator.vibrate, AudioContext and requestAnimationFrame.
    environment: 'jsdom',
    globals: false,
    restoreMocks: true,
    setupFiles: ['./src/test/setup.ts'],
    // _bak holds the pre-Vite Create React App source; its App.test.js is
    // stale JSX-in-.js that will not even parse.
    exclude: [...configDefaults.exclude, '_bak/**'],
  },
})
