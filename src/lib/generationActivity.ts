export const IMAGE_GENERATION_ACTIVITY_KEY = 'wenyun:image-generation-running'
export const IMAGE_GENERATION_ACTIVITY_TTL_MS = 30 * 60 * 1000

type ImageGenerationActivity = {
  count: number
  updatedAt: number
}

function getSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function readActivity(storage: Storage, now = Date.now()): ImageGenerationActivity {
  try {
    const raw = storage.getItem(IMAGE_GENERATION_ACTIVITY_KEY)
    if (!raw) return { count: 0, updatedAt: now }
    const parsed = JSON.parse(raw) as Partial<ImageGenerationActivity>
    const count = Math.max(0, Number(parsed.count) || 0)
    const updatedAt = Number(parsed.updatedAt) || now
    // 浏览器异常关闭后可能留下旧标记，过期后自动清理，避免一直阻止缓存恢复。
    if (count > 0 && now - updatedAt > IMAGE_GENERATION_ACTIVITY_TTL_MS) {
      storage.removeItem(IMAGE_GENERATION_ACTIVITY_KEY)
      return { count: 0, updatedAt: now }
    }
    return { count, updatedAt }
  } catch {
    storage.removeItem(IMAGE_GENERATION_ACTIVITY_KEY)
    return { count: 0, updatedAt: now }
  }
}

function writeActivity(storage: Storage, activity: ImageGenerationActivity) {
  if (activity.count <= 0) {
    storage.removeItem(IMAGE_GENERATION_ACTIVITY_KEY)
    return
  }
  storage.setItem(IMAGE_GENERATION_ACTIVITY_KEY, JSON.stringify(activity))
}

export function isImageGenerationRunning(now = Date.now()): boolean {
  const storage = getSessionStorage()
  if (!storage) return false
  return readActivity(storage, now).count > 0
}

export function beginImageGenerationActivity(now = Date.now()): () => void {
  const storage = getSessionStorage()
  if (!storage) return () => {}

  const current = readActivity(storage, now)
  writeActivity(storage, { count: current.count + 1, updatedAt: now })

  let ended = false
  return () => {
    if (ended) return
    ended = true
    const latest = readActivity(storage)
    writeActivity(storage, { count: Math.max(0, latest.count - 1), updatedAt: Date.now() })
  }
}
