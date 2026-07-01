;(function () {
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
  Promise.all([clearCaches(), unregisterWorkers()])
    .catch(function () {})
    .then(function () {
      var url = new URL(window.location.href)
      url.searchParams.set('cache_recover', String(Date.now()))
      window.location.replace(url.toString())
    })
})()
