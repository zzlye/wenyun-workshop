import 'core-js/actual/array/at'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'streamdown/styles.css'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'

installMobileViewportGuards()

function clearLegacyAppShellCache() {
  // 旧版本注册过 Service Worker，会缓存入口 HTML；新版本禁用并清掉它，避免用户更新后白屏。
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    }).catch(() => {})
  }

  if ('caches' in window) {
    caches.keys().then((keys) => {
      keys.forEach((key) => {
        if (/gpt-image-playground|wenyun-workshop|workbox|vite/i.test(key)) {
          caches.delete(key)
        }
      })
    }).catch(() => {})
  }
}

clearLegacyAppShellCache()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
