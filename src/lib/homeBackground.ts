import { PIXIV_RANDOM_BACKGROUND_API_URL } from './apiProfiles'

export const HOME_BACKGROUND_STORAGE_KEY = 'wenyun-home-background-url'
// 图片随站点发布，使用带内容哈希的固定地址，不依赖随机图接口或第三方图床。
export const HOME_STREAMER_BACKGROUND_PATH = '/assets/home-streamer-d482b116.webp'
const FALLBACK_BACKGROUND_URL = 'https://www.loliapi.com/acg/pc/'

// 随机入口不能作为固定图片保存，兼容清理旧版本缓存中的两种随机接口。
export function normalizeFixedHomeBackground(value: string): string | null {
  try {
    const url = new URL(value.startsWith('/i/') ? `https://i.mukyu.ru${value}` : value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (/\/random(?:\/|$)/i.test(url.pathname)) return null
    if (/(^|\.)loliapi\.com$/i.test(url.hostname) && /^\/acg(?:\/|$)/i.test(url.pathname)) return null
    return url.href
  } catch {
    return null
  }
}

export function getSavedHomeBackgroundUrl(): string {
  try {
    return normalizeFixedHomeBackground(window.localStorage.getItem(HOME_BACKGROUND_STORAGE_KEY)?.trim() ?? '') ?? ''
  } catch {
    return ''
  }
}

function findImageUrl(value: unknown): string | null {
  if (typeof value === 'string') return normalizeFixedHomeBackground(value.trim())
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  // 优先读取图片字段，避免元数据中的作品页面地址抢先匹配。
  const items = Array.isArray(value) ? value : [
    ...['proxy', 'origin', 'imgproxy', 'url', 'image', 'imageUrl', 'src'].map((key) => record[key]),
    ...Object.values(record),
  ]
  for (const item of items) {
    const imageUrl = findImageUrl(item)
    if (imageUrl) return imageUrl
  }
  return null
}

async function resolveImageUrl(url: string, signal: AbortSignal): Promise<string> {
  const fixedUrl = normalizeFixedHomeBackground(url)
  if (fixedUrl) return fixedUrl
  const parsed = new URL(url)
  if (parsed.origin === 'https://i.mukyu.ru' && parsed.pathname === '/random') {
    parsed.searchParams.set('format', 'simple_json')
    parsed.searchParams.set('t', String(Date.now()))
    for (const requestUrl of [`/wy-public/mukyu${parsed.pathname}${parsed.search}`, parsed.href]) {
      signal.throwIfAborted()
      try {
        const response = await fetch(requestUrl, { cache: 'no-store', signal })
        if (!response.ok) continue
        const imageUrl = findImageUrl(await response.json())
        if (imageUrl) return imageUrl
      } catch {
        // 当前请求未取消时才继续尝试直连或重定向解析，不增加超时策略。
        signal.throwIfAborted()
      }
    }
  }
  signal.throwIfAborted()
  const response = await fetch(url, { cache: 'no-store', redirect: 'follow', signal })
  const resolved = response.ok ? normalizeFixedHomeBackground(response.url) : null
  if (!resolved) throw new Error('背景接口未返回固定图片地址')
  return resolved
}

function preloadImage(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const image = new Image()
    const cleanup = () => {
      image.onload = null
      image.onerror = null
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      image.removeAttribute('src')
      reject(signal.reason)
    }
    image.onload = () => { cleanup(); resolve() }
    image.onerror = () => { cleanup(); reject(new Error('主页背景加载失败')) }
    signal.addEventListener('abort', onAbort, { once: true })
    image.decoding = 'async'
    image.referrerPolicy = 'no-referrer'
    image.src = url
  })
}

type BackgroundCallbacks = {
  prepare: (url: string) => void
  commit: (url: string) => void
}

// 一次加载拥有独立的取消信号，图片事件和两帧渐变提交都受同一生命周期约束。
export function createHomeBackgroundLoader(callbacks: BackgroundCallbacks) {
  let controller: AbortController | null = null
  let frame: number | null = null
  let disposed = false
  let busy = false
  const cancel = () => {
    controller?.abort()
    if (frame !== null) window.cancelAnimationFrame(frame)
    frame = null
    busy = false
  }
  const load = async (savedUrl = '') => {
    if (disposed) return
    cancel()
    const request = new AbortController()
    controller = request
    busy = true
    const current = () => !disposed && controller === request && !request.signal.aborted
    // 按候选列表逐项尝试，备用地址最多出现一次，与时间戳参数无关。
    const candidates = [
      ...(savedUrl ? [savedUrl] : []),
      `${PIXIV_RANDOM_BACKGROUND_API_URL}&home=${Date.now()}`,
      `${FALLBACK_BACKGROUND_URL}?home=${Date.now()}`,
    ]
    for (const candidate of candidates) {
      try {
        const url = await resolveImageUrl(candidate, request.signal)
        if (!current()) return
        await preloadImage(url, request.signal)
        if (!current()) return
        callbacks.prepare(url)
        frame = window.requestAnimationFrame(() => {
          if (!current()) return
          frame = window.requestAnimationFrame(() => {
            if (!current()) return
            frame = null
            callbacks.commit(url)
            // 只有实际显示的图片才能回写主页专用缓存，工坊外观设置保持独立。
            try { window.localStorage.setItem(HOME_BACKGROUND_STORAGE_KEY, url) } catch { /* 本地存储禁用时仍正常显示。 */ }
            busy = false
          })
        })
        return
      } catch {
        if (!current()) return
      }
    }
    if (current()) busy = false
  }
  return {
    start: () => load(getSavedHomeBackgroundUrl()),
    refresh: () => load(),
    // 自动轮播不打断尚未完成的手动刷新，避免反复作废同一张正在加载的图片。
    rotate: () => busy ? Promise.resolve() : load(),
    dispose: () => { disposed = true; cancel() },
  }
}
