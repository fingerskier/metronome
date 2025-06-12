import { defineConfig } from 'vite'
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
})
