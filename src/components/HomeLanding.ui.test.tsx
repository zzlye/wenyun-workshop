// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomeLanding from './HomeLanding'
import HomeStreamerSetting from './HomeStreamerSetting'
import { HOME_BACKGROUND_STORAGE_KEY, HOME_STREAMER_BACKGROUND_PATH } from '../lib/homeBackground'

const app = vi.hoisted(() => ({
  settings: { homeStreamerMode: false, appearanceNightMode: false, newApiAccountSessions: {} },
  setSettings: vi.fn(),
}))
vi.mock('../store', () => ({ useStore: (selector: (state: typeof app) => unknown) => selector(app) }))
vi.mock('./AccountLoginModal', () => ({ default: () => null }))
vi.mock('../infiniteCanvasSource/components/ui/animated-theme-toggler', () => ({ AnimatedThemeToggler: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const SAVED = 'https://images.example/saved.jpg'
// 手动完成网络、图片和动画帧，以复现切换时仍有随机请求在途的情况。
class TestImage {
  static instances: TestImage[] = []
  src = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() { TestImage.instances.push(this) }
  removeAttribute() { this.src = '' }
}

let host: HTMLDivElement
let root: Root
let frames: Map<number, FrameRequestCallback>
let fetchMock: ReturnType<typeof vi.fn>
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const flushFrames = () => {
  while (frames.size) {
    const batch = [...frames.values()]
    frames.clear()
    batch.forEach((callback) => callback(0))
  }
}
const render = async (enabled: boolean) => {
  app.settings.homeStreamerMode = enabled
  await act(async () => {
    root.render(<HomeLanding onOpenGallery={vi.fn()} onOpenCanvas={vi.fn()} onOpenSettings={vi.fn()} />)
    await settle()
  })
}
const backgrounds = () => Array.from(host.querySelectorAll<HTMLDivElement>('.home-landing-background'))
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
  TestImage.instances = []
  frames = new Map()
  let frameId = 0
  vi.stubGlobal('Image', TestImage)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => { frames.set(++frameId, fn); return frameId })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id) })
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ url: SAVED }) }))
  vi.stubGlobal('fetch', fetchMock)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.localStorage.clear()
})

describe('主页主播模式界面与生命周期', () => {
  it('开启后只渲染固定图，不读出随机缓存、不创建随机请求或轮播', async () => {
    window.localStorage.setItem(HOME_BACKGROUND_STORAGE_KEY, SAVED)
    await render(true)
    expect(backgrounds()).toHaveLength(1)
    expect(backgrounds()[0].style.backgroundImage).toContain(HOME_STREAMER_BACKGROUND_PATH)
    expect(host.innerHTML).not.toContain(SAVED)
    expect(button('刷新背景')).toBeNull()
    expect(button('暂停轮播')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(180_000); await settle() })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(TestImage.instances).toHaveLength(0)
    expect(window.localStorage.getItem(HOME_BACKGROUND_STORAGE_KEY)).toBe(SAVED)
  })

  it('切换立即移除已显示随机图，关闭后恢复原缓存与刷新入口', async () => {
    window.localStorage.setItem(HOME_BACKGROUND_STORAGE_KEY, SAVED)
    await render(false)
    await act(async () => { TestImage.instances[0].onload?.(); await settle(); flushFrames() })
    expect(host.innerHTML).toContain(SAVED)
    await render(true)
    expect(backgrounds()).toHaveLength(1)
    expect(host.innerHTML).not.toContain(SAVED)
    await render(false)
    expect(button('刷新背景')).not.toBeNull()
    expect(TestImage.instances.at(-1)?.src).toBe(SAVED)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(HOME_BACKGROUND_STORAGE_KEY)).toBe(SAVED)
  })

  it('切换会取消在途随机解析，迟到响应不覆盖固定图', async () => {
    let complete!: (response: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    await render(false)
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    await render(true)
    expect(signal.aborted).toBe(true)
    await act(async () => { complete({ ok: true, json: async () => ({ url: SAVED }) }); await settle(); flushFrames() })
    expect(TestImage.instances).toHaveLength(0)
    expect(backgrounds()).toHaveLength(1)
    expect(host.innerHTML).not.toContain(SAVED)
    expect(window.localStorage.getItem(HOME_BACKGROUND_STORAGE_KEY)).toBeNull()
  })

  it('图片迟到回调和已排队的渐变均不能在开启后显示随机图', async () => {
    window.localStorage.setItem(HOME_BACKGROUND_STORAGE_KEY, SAVED)
    await render(false)
    const lateLoad = TestImage.instances[0].onload!
    await act(async () => { lateLoad(); await settle() })
    expect(frames.size).toBeGreaterThan(0)
    await render(true)
    await act(async () => { lateLoad(); await settle(); flushFrames() })
    expect(frames.size).toBe(0)
    expect(backgrounds()).toHaveLength(1)
    expect(host.innerHTML).not.toContain(SAVED)
  })

  it('查看与复制得到当前站点的固定图片完整地址', async () => {
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await render(true)
    await act(async () => button('查看主页背景地址')!.click())
    const expected = new URL(HOME_STREAMER_BACKGROUND_PATH, window.location.href).href
    expect(host.querySelector('code')?.textContent).toBe(expected)
    await act(async () => button('复制背景地址')!.click())
    expect(copy).toHaveBeenCalledWith(expected)
  })

  it('设置开关可双向操作，预览使用同一张固定图', async () => {
    function Setting() {
      const [enabled, setEnabled] = useState(false)
      return <HomeStreamerSetting enabled={enabled} onChange={setEnabled} />
    }
    await act(async () => root.render(<Setting />))
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.checked).toBe(false)
    await act(async () => checkbox.click())
    expect(checkbox.checked).toBe(true)
    expect(host.querySelector('img')?.getAttribute('src')).toBe(HOME_STREAMER_BACKGROUND_PATH)
    await act(async () => checkbox.click())
    expect(checkbox.checked).toBe(false)
    expect(host.querySelector('img')).toBeNull()
  })
})
