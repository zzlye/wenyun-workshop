import 'core-js/actual/array/at'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'streamdown/styles.css'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'
import { getDesktopBridge } from './lib/desktop'

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

async function mountApp() {
  if (getDesktopBridge()) await (await import('./lib/desktopLifecycle')).initializeDesktop()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void mountApp().catch((error) => {
  const root = document.getElementById('root')!
  const alert = document.createElement('p')
  alert.setAttribute('role', 'alert')
  alert.className = 'm-8 text-sm text-red-600'
  alert.textContent = error instanceof Error ? error.message : '本地数据读取失败，请重新启动'
  root.append(alert)
})
