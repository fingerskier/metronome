import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Service worker registration is handled by vite-plugin-pwa, which injects
// registerSW.js into index.html (injectRegister: 'auto') and keeps the worker
// fresh via registerType: 'autoUpdate'. Do not register it by hand here too.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
