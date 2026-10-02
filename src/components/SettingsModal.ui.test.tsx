// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsModal from './SettingsModal'
import { DEFAULT_SETTINGS, normalizeSettings } from '../lib/apiProfiles'

// 隔离账号、素材和网络，只验证用户实际看到的设置及模型选择行为。
const fixture = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  projects: [],
  assets: [],
  models: ['video-first', 'video-second'],
  refetch: vi.fn(),
  setSettings: vi.fn(),
  showToast: vi.fn(),
}))
vi.mock('../store', () => ({
  useStore: Object.assign(
    (selector: (state: typeof fixture.state) => unknown) => selector(fixture.state),
    { getState: () => fixture.state },
  ),
  exportData: vi.fn(), importData: vi.fn(), clearData: vi.fn(),
}))
vi.mock('../hooks/useVideoModels', () => ({
  useVideoModels: () => ({ data: fixture.models, isFetching: false, refetch: fixture.refetch }),
}))
vi.mock('../lib/localFileSync', () => ({
  getLocalSyncFileInfo: async () => null,
  hasLocalSyncFileHandle: async () => false,
  isLocalFileSyncSupported: () => false,
  chooseLocalSyncFile: vi.fn(), clearLocalSyncFile: vi.fn(),
}))
vi.mock('../infiniteCanvasSource/app/(user)/canvas/stores/use-canvas-store', () => ({
  useCanvasStore: (selector: (state: { projects: unknown[] }) => unknown) => selector({ projects: fixture.projects }),
}))
vi.mock('../infiniteCanvasSource/stores/use-asset-store', () => ({
  useAssetStore: (selector: (state: { assets: unknown[] }) => unknown) => selector({ assets: fixture.assets }),
}))
vi.mock('./PriceTableButton', () => ({ default: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root
beforeEach(async () => {
  vi.clearAllMocks()
  fixture.refetch.mockResolvedValue({ data: fixture.models })
  fixture.state = {
    showSettings: true,
    settingsTabRequest: 'videoApi',
    settings: normalizeSettings({ ...DEFAULT_SETTINGS, videoApiKey: 'fixture-key', videoModel: 'video-first' }),
    setSettings: fixture.setSettings,
    showToast: fixture.showToast,
    setShowSettings: vi.fn(),
    setReusedTaskApiProfile: vi.fn(),
    setConfirmDialog: vi.fn(),
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<SettingsModal />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('视频 API 设置精简', () => {
  it('不显示模型用途说明和全局视频参数，保留连接配置', () => {
    expect(host.textContent).not.toContain('模型列表从视频 API 获取')
    expect(host.textContent).not.toContain('用于画布工坊里的视频生成')
    expect(host.textContent).not.toContain('视频设置')
    expect(host.textContent).not.toContain('生成模式')
    expect(host.textContent).not.toContain('清晰度')
    expect(host.textContent).not.toContain('画面比例')
    expect(host.querySelector('section[aria-label="视频 API 配置"]')).not.toBeNull()
    expect(host.querySelector('input[type="password"]')).not.toBeNull()
    expect(host.querySelector('#video-api-model-input')).not.toBeNull()
  })

  it('仍可获取模型并保存所选模型，不因精简删除 API 功能', async () => {
    const getModels = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === '获取模型')
    expect(getModels).toBeDefined()
    await act(async () => getModels!.click())
    expect(fixture.refetch).toHaveBeenCalledOnce()
    expect(fixture.showToast).toHaveBeenCalledWith('已获取 2 个模型', 'success')
    const option = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'video-second')
    expect(option).toBeDefined()
    await act(async () => option!.click())
    expect((host.querySelector('#video-api-model-input') as HTMLInputElement).value).toBe('video-second')
    expect(fixture.setSettings).toHaveBeenCalledWith(expect.objectContaining({ videoModel: 'video-second' }))
  })
})
