;(function () {
  // 这个 key 必须和 src/lib/generationActivity.ts 保持一致，用来避免生成中途强制刷新页面。
  var IMAGE_GENERATION_ACTIVITY_KEY = 'wenyun:image-generation-running'
  var IMAGE_GENERATION_ACTIVITY_TTL_MS = 30 * 60 * 1000

  function isImageGenerationRunning() {
    try {
      if (!window.sessionStorage) return false
      var raw = window.sessionStorage.getItem(IMAGE_GENERATION_ACTIVITY_KEY)
      if (!raw) return false
      var data = JSON.parse(raw)
      var count = Math.max(0, Number(data && data.count) || 0)
      var updatedAt = Number(data && data.updatedAt) || 0
      if (count <= 0) return false
      if (updatedAt && Date.now() - updatedAt > IMAGE_GENERATION_ACTIVITY_TTL_MS) {
        window.sessionStorage.removeItem(IMAGE_GENERATION_ACTIVITY_KEY)
        return false
      }
      return true
    } catch (error) {
      return false
    }
  }

  function clearCaches() {
    if (!('caches' in window)) return Promise.resolve()
    return caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return caches.delete(key)
      }))
    })
  }

  function unregisterWorkers() {
    if (!('serviceWorker' in navigator)) return Promise.resolve()
    return navigator.serviceWorker.getRegistrations().then(function (registrations) {
      return Promise.all(registrations.map(function (registration) {
        return registration.unregister()
      }))
    })
  }

  // 旧入口 HTML 可能还在请求已经不存在的 hash JS。这里清理旧应用壳缓存后强制回到最新入口。
  if (isImageGenerationRunning()) {
    console.warn('Skip cache recovery reload while image generation is running.')
    return
  }

  Promise.all([clearCaches(), unregisterWorkers()])
    .catch(function () {})
    .then(function () {
      var url = new URL(window.location.href)
      // 已经恢复过一次就不再重复刷新，避免用户长任务过程中被旧资源恢复逻辑反复打断。
      if (url.searchParams.has('cache_recover')) return
      url.searchParams.set('cache_recover', String(Date.now()))
      window.location.replace(url.toString())
    })
})()
