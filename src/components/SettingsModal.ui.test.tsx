// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsModal from './SettingsModal'
import { DEFAULT_SETTINGS, LOCKED_WENYUN_PROFILE_ID, normalizeSettings } from '../lib/apiProfiles'
import { CANVAS_VIDEO_BASE_URL } from '../lib/videoModel'
import type { AppSettings } from '../types'

// 隔离账号、素材和网络，只验证用户实际看到的设置及模型选择行为。
const fixture = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  projects: [],
  assets: [],
  models: ['video-first', 'video-second'],
  refetch: vi.fn(),
  setSettings: vi.fn(),
  showToast: vi.fn(),
  modelsQuery: vi.fn(),
  copy: vi.fn(),
}))
vi.mock('../store', () => ({
  useStore: Object.assign(
    (selector: (state: typeof fixture.state) => unknown) => selector(fixture.state),
    { getState: () => fixture.state },
  ),
  exportData: vi.fn(), importData: vi.fn(), clearData: vi.fn(),
}))
vi.mock('../hooks/useVideoModels', () => ({
  useVideoModels: (...args: unknown[]) => {
    fixture.modelsQuery(...args)
    return { data: fixture.models, isFetching: false, refetch: fixture.refetch }
  },
}))
vi.mock('../hooks/useAccountVideoKey', () => ({
  useAccountVideoKey: () => ({ isError: false, isFetching: false, refetch: vi.fn() }),
}))
vi.mock('../lib/clipboard', () => ({
  copyTextToClipboard: (...args: unknown[]) => fixture.copy(...args),
  getClipboardFailureMessage: (message: string) => message,
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
  fixture.copy.mockReset().mockResolvedValue(undefined)
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
  it('固定视频地址可复制，复制失败也有提示', async () => {
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="复制视频 API URL"]')
    expect(button).not.toBeNull()
    await act(async () => button!.click())
    expect(fixture.copy).toHaveBeenCalledWith(CANVAS_VIDEO_BASE_URL)
    expect(fixture.showToast).toHaveBeenCalledWith('API URL 已复制', 'success')
    fixture.copy.mockRejectedValueOnce(new Error('clipboard unavailable'))
    await act(async () => button!.click())
    expect(fixture.showToast).toHaveBeenCalledWith('复制 API URL 失败', 'error')
  })

  it('登录后视频留空Key仍使用账号获取模型，退出后不继续使用或保存账号Key', async () => {
    fixture.state.settings = normalizeSettings({
      ...DEFAULT_SETTINGS, videoApiKey: '', accountApiKeyMode: 'account',
      newApiAccountSessions: {
        [LOCKED_WENYUN_PROFILE_ID]: {
          siteProfileId: LOCKED_WENYUN_PROFILE_ID, username: 'demo',
          accessToken: 'management-token', boundApiKey: 'account-image-key',
          boundVideoApiKey: 'account-video-key', boundVideoApiKeyGroup: '视频',
        },
      },
    })
    await act(async () => root.render(<SettingsModal key="account" />))
    expect(fixture.modelsQuery).toHaveBeenLastCalledWith('account-video-key', expect.any(Boolean), true)
    const keyInput = host.querySelector('input[type="password"]') as HTMLInputElement
    expect(keyInput.value).toBe('account-video-key')
    expect(keyInput.readOnly).toBe(true)
    expect(host.textContent).not.toContain('已使用账号视频 Key')
    expect(host.textContent).not.toContain('视频分组')
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="显示 API Key"]')!.click())
    expect(keyInput.type).toBe('text')
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="复制视频 API Key"]')!.click())
    expect(fixture.copy).toHaveBeenCalledWith('account-video-key')
    await act(async () => { keyInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(fixture.setSettings).not.toHaveBeenCalled()
    fixture.state.settings = { ...(fixture.state.settings as AppSettings), newApiAccountSessions: {} }
    await act(async () => root.render(<SettingsModal key="account" />))
    expect(fixture.modelsQuery).toHaveBeenLastCalledWith('', expect.any(Boolean), true)
    const option = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'video-second')
    await act(async () => option!.click())
    expect(fixture.setSettings).toHaveBeenCalledWith(expect.objectContaining({ videoApiKey: '', newApiAccountSessions: {} }))
  })

  it('保留视频配置标题和简短用途，仅移除指定说明与全局视频参数', () => {
    expect(host.textContent).not.toContain('模型列表从视频 API 获取')
    expect(host.querySelector('h4')?.textContent).toBe('视频 API 配置')
    expect(host.querySelector('h4')?.nextElementSibling?.textContent?.trim()).toBe('用于画布工坊里的视频生成。')
    expect(host.textContent).not.toContain('视频设置')
    expect(host.textContent).not.toContain('生成模式')
    expect(host.textContent).not.toContain('清晰度')
    expect(host.textContent).not.toContain('画面比例')
    expect(host.querySelector('section[aria-label="视频 API 配置"]')).not.toBeNull()
    expect(host.querySelector('input[type="password"]')).not.toBeNull()
    expect(host.querySelector('#video-api-model-input')).not.toBeNull()
    expect(host.textContent).not.toContain('接口地址固定')
    expect(host.textContent).not.toContain('画布视频任务最长等待')
    const timeout = host.querySelector<HTMLInputElement>('section input[type="number"]')!
    expect(timeout.value).toBe('1800')
    expect(timeout.readOnly).toBe(true)
  })

  it('图片接口只删说明，保留地址、复制按钮和原请求时限', async () => {
    const tab = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '出图 API 配置')!
    await act(async () => tab.click())
    expect(host.textContent).not.toContain('固定接口地址，可选中复制')
    const url = Array.from(host.querySelectorAll<HTMLInputElement>('input')).find(input => input.value === CANVAS_VIDEO_BASE_URL)!
    expect(url.readOnly).toBe(true)
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="复制 API URL"]')!.click())
    expect(fixture.copy).toHaveBeenCalledWith(CANVAS_VIDEO_BASE_URL)
    expect(host.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('600')
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
