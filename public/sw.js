const LEGACY_CACHE_PATTERNS = [/gpt-image-playground/i, /wenyun-workshop/i, /workbox/i, /vite/i]

async function clearLegacyCaches() {
  const keys = await caches.keys()
  await Promise.all(
    keys
      .filter((key) => LEGACY_CACHE_PATTERNS.some((pattern) => pattern.test(key)))
      .map((key) => caches.delete(key)),
  )
}

self.addEventListener('install', (event) => {
  // 兼容已安装旧 Service Worker 的浏览器：新脚本只负责清缓存，不再接管页面离线缓存。
  event.waitUntil(clearLegacyCaches())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    clearLegacyCaches()
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        clients.forEach((client) => client.navigate(client.url))
      }),
  )
})
