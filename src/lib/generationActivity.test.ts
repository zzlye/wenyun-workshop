import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  IMAGE_GENERATION_ACTIVITY_KEY,
  IMAGE_GENERATION_ACTIVITY_TTL_MS,
  beginImageGenerationActivity,
  isImageGenerationRunning,
} from './generationActivity'

function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear() {
      data.clear()
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null
    },
    removeItem(key: string) {
      data.delete(key)
    },
    setItem(key: string, value: string) {
      data.set(key, String(value))
    },
  }
}

describe('image generation activity marker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps a running marker while image generation requests are active', () => {
    const storage = createMemoryStorage()
    vi.stubGlobal('sessionStorage', storage)
    vi.useFakeTimers()
    vi.setSystemTime(1000)

    const endFirst = beginImageGenerationActivity()
    vi.setSystemTime(2000)
    const endSecond = beginImageGenerationActivity()

    expect(isImageGenerationRunning(3000)).toBe(true)
    expect(JSON.parse(storage.getItem(IMAGE_GENERATION_ACTIVITY_KEY)!)).toMatchObject({ count: 2, updatedAt: 2000 })

    vi.setSystemTime(4000)
    endFirst()
    expect(isImageGenerationRunning(4000)).toBe(true)

    vi.setSystemTime(5000)
    endFirst()
    expect(isImageGenerationRunning(5000)).toBe(true)

    vi.setSystemTime(6000)
    endSecond()
    expect(isImageGenerationRunning(6000)).toBe(false)
    expect(storage.getItem(IMAGE_GENERATION_ACTIVITY_KEY)).toBeNull()
  })

  it('clears stale running markers after the safety ttl', () => {
    const storage = createMemoryStorage()
    vi.stubGlobal('sessionStorage', storage)
    storage.setItem(IMAGE_GENERATION_ACTIVITY_KEY, JSON.stringify({ count: 1, updatedAt: 1000 }))

    expect(isImageGenerationRunning(1000 + IMAGE_GENERATION_ACTIVITY_TTL_MS + 1)).toBe(false)
    expect(storage.getItem(IMAGE_GENERATION_ACTIVITY_KEY)).toBeNull()
  })
})
