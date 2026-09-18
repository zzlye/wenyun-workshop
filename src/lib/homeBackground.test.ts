import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHomeBackgroundLoader, getSavedHomeBackgroundUrl, HOME_BACKGROUND_STORAGE_KEY, normalizeFixedHomeBackground } from './homeBackground'

const FIXED = 'https://images.example/current.jpg'
const NEXT = 'https://images.example/next.jpg'
const BACKUP = 'https://images.example/backup.jpg'

// 图片和动画帧由测试主动完成，稳定复现刷新、卸载和迟到回调的先后顺序。
class TestImage {
  static instances: TestImage[] = []
  src = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  removeAttribute() { this.src = '' }
  constructor() { TestImage.instances.push(this) }
}

let storage: Map<string, string>
let frames: Map<number, FrameRequestCallback>
let fetchMock: ReturnType<typeof vi.fn>
let loaders: ReturnType<typeof createHomeBackgroundLoader>[]
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const flushFrames = () => {
  while (frames.size) {
    const batch = [...frames.values()]
    frames.clear()
    batch.forEach((fn) => fn(0))
  }
}
const makeLoader = () => {
  const prepare = vi.fn()
  const commit = vi.fn()
  const loader = createHomeBackgroundLoader({ prepare, commit })
  loaders.push(loader)
  return { loader, prepare, commit }
}

beforeEach(() => {
  TestImage.instances = []
  storage = new Map()
  frames = new Map()
  loaders = []
  let frameId = 0
  vi.stubGlobal('Image', TestImage)
  vi.stubGlobal('window', {
    localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) },
    requestAnimationFrame: (fn: FrameRequestCallback) => { frames.set(++frameId, fn); return frameId },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  })
  fetchMock = vi.fn(async (url: string) => ({ ok: true, url: url.includes('loliapi') ? BACKUP : url, json: async () => ({ url: NEXT }) }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  loaders.forEach((loader) => loader.dispose())
  vi.unstubAllGlobals()
})

describe('主页背景生命周期', () => {
  it('重新进入只预加载已保存图片，完成两帧切换后才提交', async () => {
    storage.set(HOME_BACKGROUND_STORAGE_KEY, FIXED)
    const { loader, prepare, commit } = makeLoader()
    void loader.start()
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(TestImage.instances[0].src).toBe(FIXED)
    expect(commit).not.toHaveBeenCalled()
    TestImage.instances[0].onload?.()
    await settle()
    expect(prepare).toHaveBeenCalledWith(FIXED)
    expect(commit).not.toHaveBeenCalled()
    flushFrames()
    expect(commit).toHaveBeenCalledExactlyOnceWith(FIXED)
  })

  it('主图和备用图都失败时停止，不递归重试、不覆盖旧缓存', async () => {
    storage.set(HOME_BACKGROUND_STORAGE_KEY, FIXED)
    const { loader, commit } = makeLoader()
    const pending = loader.refresh()
    await settle()
    TestImage.instances[0].onerror?.()
    await settle()
    expect(TestImage.instances[1].src).toBe(BACKUP)
    TestImage.instances[1].onerror?.()
    await pending
    expect(TestImage.instances).toHaveLength(2)
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('loliapi'))).toHaveLength(1)
    expect(commit).not.toHaveBeenCalled()
    expect(storage.get(HOME_BACKGROUND_STORAGE_KEY)).toBe(FIXED)
  })

  it('旧图片的迟到失败不能作废新的成功刷新', async () => {
    const { loader, commit } = makeLoader()
    void loader.refresh()
    await settle()
    const oldError = TestImage.instances[0].onerror!
    void loader.refresh()
    await settle()
    oldError()
    TestImage.instances[1].onload?.()
    await settle()
    flushFrames()
    expect(TestImage.instances).toHaveLength(2)
    expect(commit).toHaveBeenCalledExactlyOnceWith(NEXT)
    expect(storage.get(HOME_BACKGROUND_STORAGE_KEY)).toBe(NEXT)
  })

  it('刷新会取消旧解析，迟到网络响应不会创建图片或写缓存', async () => {
    let complete!: (response: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const { loader, commit } = makeLoader()
    void loader.refresh()
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    void loader.refresh()
    await settle()
    expect(signal.aborted).toBe(true)
    complete({ ok: true, json: async () => ({ url: FIXED }) })
    await settle()
    expect(TestImage.instances).toHaveLength(1)
    TestImage.instances[0].onload?.()
    await settle()
    flushFrames()
    expect(commit).toHaveBeenCalledExactlyOnceWith(NEXT)
  })

  it('离开主页时图片事件解绑，迟到成功也不能提交', async () => {
    const { loader, commit } = makeLoader()
    void loader.start()
    await settle()
    const oldLoad = TestImage.instances[0].onload!
    loader.dispose()
    expect(TestImage.instances[0].onload).toBeNull()
    oldLoad()
    await settle()
    flushFrames()
    expect(commit).not.toHaveBeenCalled()
    expect(storage.has(HOME_BACKGROUND_STORAGE_KEY)).toBe(false)
  })

  it('图片已就绪但渐变未提交时离开，不写缓存', async () => {
    const { loader, commit } = makeLoader()
    void loader.refresh()
    await settle()
    TestImage.instances[0].onload?.()
    await settle()
    expect(frames.size).toBe(1)
    loader.dispose()
    flushFrames()
    expect(commit).not.toHaveBeenCalled()
    expect(storage.size).toBe(0)
  })

  it('开发模式卸载再挂载不受旧加载器污染', async () => {
    const old = makeLoader()
    void old.loader.start()
    await settle()
    const oldLoad = TestImage.instances[0].onload!
    old.loader.dispose()
    const next = makeLoader()
    void next.loader.start()
    await settle()
    oldLoad()
    TestImage.instances[1].onload?.()
    await settle()
    flushFrames()
    expect(old.commit).not.toHaveBeenCalled()
    expect(next.commit).toHaveBeenCalledExactlyOnceWith(NEXT)
  })

  it('只清理旧随机缓存的使用，不把任何随机接口当作固定图展示', async () => {
    storage.set(HOME_BACKGROUND_STORAGE_KEY, 'https://www.loliapi.com/acg/pc/?home=123')
    expect(getSavedHomeBackgroundUrl()).toBe('')
    fetchMock.mockImplementation(async (url: string) => ({ ok: true, url, json: async () => ({ url: 'https://i.mukyu.ru/random?x=1' }) }))
    const { loader, prepare, commit } = makeLoader()
    await loader.start()
    expect(TestImage.instances).toHaveLength(0)
    expect(prepare).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(storage.get(HOME_BACKGROUND_STORAGE_KEY)).toContain('home=123')
  })

  it('固定地址解析失败时保留当前图，不退回直接展示随机接口', async () => {
    storage.set(HOME_BACKGROUND_STORAGE_KEY, FIXED)
    fetchMock.mockRejectedValue(new Error('模拟跨域失败'))
    const { loader, commit } = makeLoader()
    await loader.refresh()
    expect(TestImage.instances).toHaveLength(0)
    expect(commit).not.toHaveBeenCalled()
    expect(storage.get(HOME_BACKGROUND_STORAGE_KEY)).toBe(FIXED)
  })

  it('接受固定重定向和相对图片地址，拒绝两种随机入口及无效协议', () => {
    expect(normalizeFixedHomeBackground('/i/example.jpg')).toBe('https://i.mukyu.ru/i/example.jpg')
    expect(normalizeFixedHomeBackground(FIXED)).toBe(FIXED)
    for (const url of ['https://i.mukyu.ru/random?t=1', 'https://www.loliapi.com/acg/pc/?home=1', 'javascript:alert(1)', '']) {
      expect(normalizeFixedHomeBackground(url)).toBeNull()
    }
  })

  it('保存图片失效后允许重新取图，缓存只记录最终成功显示的固定图片', async () => {
    storage.set(HOME_BACKGROUND_STORAGE_KEY, FIXED)
    const { loader, commit } = makeLoader()
    void loader.start()
    await settle()
    TestImage.instances[0].onerror?.()
    await settle()
    TestImage.instances[1].onload?.()
    await settle()
    expect(storage.get(HOME_BACKGROUND_STORAGE_KEY)).toBe(FIXED)
    flushFrames()
    expect(commit).toHaveBeenCalledExactlyOnceWith(NEXT)
    expect(storage.get(HOME_BACKGROUND_STORAGE_KEY)).toBe(NEXT)
  })

  it('自动轮播不打断正在进行的刷新', async () => {
    const { loader } = makeLoader()
    void loader.refresh()
    await settle()
    await loader.rotate()
    expect(TestImage.instances).toHaveLength(1)
    TestImage.instances[0].onload?.()
    await settle()
    flushFrames()
    void loader.rotate()
    await settle()
    expect(TestImage.instances).toHaveLength(2)
  })

  it('按当前要求不增加弱网超时，仅由显式取消结束挂起请求', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    const { loader } = makeLoader()
    void loader.start()
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(TestImage.instances).toHaveLength(0)
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    expect(signal.aborted).toBe(false)
    loader.dispose()
    expect(signal.aborted).toBe(true)
  })
})
