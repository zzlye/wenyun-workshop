// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PriceTableButton from './PriceTableButton'
import { DEFAULT_SETTINGS, LOCKED_WENYUN_PROFILE_ID, normalizeSettings } from '../lib/apiProfiles'
import type { AppSettings } from '../types'
import { queryNewApiModelPerformance, queryNewApiPriceTable } from '../lib/newApi'

const fixture = vi.hoisted(() => ({ settings: {} as AppSettings, setSettings: vi.fn() }))
vi.mock('../store', () => ({ useStore: Object.assign((selector: (state: typeof fixture) => unknown) => selector(fixture), { getState: () => fixture }) }))
vi.mock('./SupportJoinGroupNotice', () => ({ default: () => null }))
vi.mock('../lib/newApi', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/newApi')>(),
  queryNewApiPriceTable: vi.fn(async () => ({ found: true, items: [], updatedAt: 1 })),
  queryNewApiModelPerformance: vi.fn(async () => ({ found: true, items: [], updatedAt: 1 })),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root
let client: QueryClient
let modelName: string
let description: string
let failPricing: boolean
let expiredAccount: boolean
let priceOverrides: Record<string, unknown>
let requests: { url: string; init?: RequestInit }[]
const button = (name: string) => Array.from(document.querySelectorAll('button')).find(item => item.textContent === name)!
const panel = () => document.querySelector('[role="tabpanel"]:not([hidden])')!
const render = async () => {
  await act(async () => root.render(<QueryClientProvider client={client}><PriceTableButton activeProfile={fixture.settings.profiles[0]} /></QueryClientProvider>))
  await act(async () => { await vi.advanceTimersByTimeAsync(30) })
}
const click = (element: HTMLElement) => act(async () => { element.click(); await vi.advanceTimersByTimeAsync(30) })
const openVideo = async () => { await render(); await click(button('模型列表')); await click(button('视频')) }

beforeEach(() => {
  vi.useFakeTimers()
  fixture.settings = normalizeSettings({ ...DEFAULT_SETTINGS, videoApiKey: '' })
  fixture.setSettings.mockClear()
  modelName = 'fresh-video-model'
  description = '接口提供的简介'
  failPricing = false
  expiredAccount = false
  priceOverrides = {}
  requests = []
  vi.mocked(queryNewApiPriceTable).mockClear()
  vi.mocked(queryNewApiModelPerformance).mockClear()
  // 使用真实查询缓存及获取函数，只替换网络，确保切页与换账号确实隔离。
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, init })
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: modelName }] }))
    if (expiredAccount && ((init?.headers as Record<string, string> | undefined)?.Authorization || url.endsWith('/auth/refresh'))) {
      return new Response(JSON.stringify({ success: false, message: '登录状态已过期' }), { status: 401 })
    }
    if (url.endsWith('/api/pricing')) {
      if (failPricing) return new Response('{}', { status: 503 })
      return new Response(JSON.stringify({ success: true, data: [
        { model_name: modelName, description, quota_type: 1, model_price: 4.5, enable_groups: ['视频'], ...priceOverrides },
        { model_name: 'image-only', description: '不该出现在视频页', quota_type: 1, model_price: 1, enable_groups: ['default'] },
      ], group_ratio: { 视频: 1 } }))
    }
    if (url.includes('/perf-metrics/')) return new Response(JSON.stringify({ data: { models: [{ model_name: modelName, success_rate: 0, request_count: 3 }] } }))
    if (url.endsWith('/api/status')) return new Response(JSON.stringify({ data: { quota_display_type: 'CUSTOM', custom_currency_symbol: 'HUHN', custom_currency_exchange_rate: 1 } }))
    throw new Error('意外请求：' + url)
  }))
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('模型列表图片与视频分页', () => {
  it('打开时同步刷新两类模型，切页不重发请求，重新打开也刷新视频缓存', async () => {
    await render()
    await click(button('模型列表'))
    expect(vi.mocked(queryNewApiModelPerformance)).toHaveBeenCalledTimes(1)
    expect(requests.filter(item => item.url.endsWith('/api/pricing'))).toHaveLength(1)
    expect(document.querySelector('[role="tablist"]')?.parentElement?.textContent).toContain('更新于')
    expect(document.body.textContent).not.toContain('图片模型，成功率更新于')
    await click(button('视频'))
    expect(requests.filter(item => item.url.endsWith('/api/pricing'))).toHaveLength(1)
    expect(vi.mocked(queryNewApiModelPerformance)).toHaveBeenCalledTimes(1)
    expect(panel().textContent).toContain('fresh-video-model')
    await click(button('图片'))
    expect(requests.filter(item => item.url.endsWith('/api/pricing'))).toHaveLength(1)
    expect(document.querySelector('[aria-label="关闭模型列表"]')).not.toBeNull()
    await click(document.querySelector('[aria-label="关闭模型列表"]') as HTMLElement)
    await click(button('模型列表'))
    expect(vi.mocked(queryNewApiModelPerformance)).toHaveBeenCalledTimes(2)
    expect(requests.filter(item => item.url.endsWith('/api/pricing'))).toHaveLength(2)
  })

  it('图片和视频切页时共用固定高度的弹窗，列表在内部滚动', async () => {
    await render()
    await click(button('模型列表'))
    const dialog = document.querySelector('.animate-modal-in') as HTMLElement
    expect(dialog.className).toContain('h-[82vh]')
    expect(dialog.querySelector('.overflow-y-auto')).not.toBeNull()
    await click(button('视频'))
    expect(document.querySelector('.animate-modal-in')).toBe(dialog)
    expect(dialog.className).toContain('h-[82vh]')
  })

  it('图片表保留，切到视频显示自动名称、简介、价格和零成功率', async () => {
    await render()
    await click(button('模型列表'))
    expect(panel().textContent).toContain('支持分辨率')
    await click(button('视频'))
    expect(button('视频').getAttribute('aria-selected')).toBe('true')
    expect(panel().textContent).toContain('fresh-video-model')
    expect(panel().textContent).toContain('接口提供的简介')
    expect(panel().textContent).toContain('HUHN 4.5 / 次')
    expect(panel().textContent).toContain('0.00%')
    expect(panel().querySelector('[role="columnheader"]')?.textContent).toBe('模型')
    expect(panel().textContent).not.toContain('image-only')
    await click(button('图片'))
    expect(panel().textContent).toContain('支持分辨率')
    expect(panel().textContent).not.toContain('fresh-video-model')
  })

  it('刷新同时获取新名单和新简介，不需要前端添加模型', async () => {
    await openVideo()
    modelName = 'newly-added-model-with-a-very-long-name-v100'
    description = '更新后的官方简介'
    await click(button('刷新'))
    expect(panel().textContent).toContain(modelName)
    expect(panel().textContent).toContain(description)
    expect(panel().textContent).not.toContain('fresh-video-model')
    expect(requests.filter(item => item.url.endsWith('/api/pricing'))).toHaveLength(2)
    expect(vi.mocked(queryNewApiModelPerformance)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(queryNewApiPriceTable)).toHaveBeenCalledTimes(2)
    expect(requests.every(item => !item.init?.method || item.init.method === 'GET')).toBe(true)
  })

  it.each(['per_second', 'per_request'])('视频列表将接口 %s 分辨率价格逐档展示，刷新后同步新价', async mode => {
    priceOverrides = { billing_mode: mode, billing_expr: 'param("resolution") == "1080p" ? .93 : param("resolution") == "720p" ? .48 : .27' }
    await openVideo()
    const unit = mode === 'per_second' ? '秒' : '次'
    const priceCell = () => panel().querySelectorAll('[role="row"]')[1].querySelectorAll('[role="cell"]')[2]
    for (const [resolution, amount] of [['480p', '0.27'], ['720p', '0.48'], ['1080p', '0.93']]) {
      expect(Array.from(priceCell().querySelectorAll('.flex')).some(element => element.textContent === `${resolution}HUHN ${amount} / ${unit}`)).toBe(true)
    }
    expect(priceCell().textContent).not.toContain('4.5')
    expect(priceCell().textContent).not.toContain('基准价')
    priceOverrides.billing_expr = 'param("resolution") == "1080p" ? 1.2 : param("resolution") == "720p" ? .6 : .3'
    await click(button('刷新'))
    expect(priceCell().textContent).toContain(`HUHN 1.2 / ${unit}`)
    expect(priceCell().textContent).not.toContain('0.93')
    expect(fixture.setSettings).not.toHaveBeenCalled()
  })

  it('登录使用独立视频Key，换账号立即隔离名称和报价缓存', async () => {
    const account = { siteProfileId: LOCKED_WENYUN_PROFILE_ID, username: 'user-a', userId: 2, accessToken: 'session-a', boundApiKey: 'image-key', boundVideoApiKey: 'video-a', boundVideoApiKeyGroup: '视频' }
    fixture.settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID] = account
    await openVideo()
    expect(requests.find(item => item.url.endsWith('/models'))?.init?.headers).toMatchObject({ Authorization: 'Bearer video-a' })
    expect(requests.find(item => item.url.endsWith('/api/pricing'))?.init?.headers).toMatchObject({ Authorization: 'Bearer session-a' })
    expect(document.querySelector('[role="dialog"]')?.textContent ?? document.body.textContent).not.toContain('视频分组参考价格')
    modelName = 'account-b-video'
    fixture.settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID] = { ...account, username: 'user-b', userId: 3, accessToken: 'session-b', boundVideoApiKey: 'video-b' }
    await render()
    expect(panel().textContent).toContain('account-b-video')
    expect(panel().textContent).not.toContain('fresh-video-model')
    expect(requests.filter(item => item.url.endsWith('/models')).at(-1)?.init?.headers).toMatchObject({ Authorization: 'Bearer video-b' })
    expect(requests.filter(item => item.url.endsWith('/api/pricing')).at(-1)?.init?.headers).toMatchObject({ Authorization: 'Bearer session-b' })
    expect(JSON.stringify(requests)).not.toContain('image-key')
  })

  it('视频Key有效但管理会话过期时恢复资料，并准确标记公开参考价格', async () => {
    fixture.settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID] = {
      siteProfileId: LOCKED_WENYUN_PROFILE_ID, username: 'expired-user', userId: 2, accessToken: 'expired-session',
      boundVideoApiKey: 'valid-video-key', boundVideoApiKeyGroup: '视频',
    }
    expiredAccount = true
    await openVideo()
    expect(panel().textContent).toContain('fresh-video-model')
    expect(panel().textContent).toContain('接口提供的简介')
    expect(panel().textContent).toContain('HUHN 4.5 / 次')
    expect(panel().textContent).toContain('0.00%')
    expect(panel().textContent).not.toContain('视频分组参考价格')
    expect(panel().querySelector('[role="alert"]')).toBeNull()
    expect(panel().textContent).not.toContain('image-only')
    expect(requests.find(item => item.url.endsWith('/models'))?.init?.headers).toMatchObject({ Authorization: 'Bearer valid-video-key' })
    expect(requests.filter(item => item.url.endsWith('/api/pricing')).at(-1)?.init).toMatchObject({ credentials: 'omit' })
    expect(fixture.setSettings).not.toHaveBeenCalled()
  })

  it('价格接口失败仍展示视频Key的模型，失败与暂无数据不伪装成免费', async () => {
    fixture.settings.videoApiKey = 'manual-video-key'
    failPricing = true
    await openVideo()
    expect(panel().textContent).toContain('fresh-video-model')
    expect(panel().textContent).toContain('暂无价格')
    expect(panel().textContent).toContain('暂无简介')
    expect(panel().querySelector('[role="alert"]')?.textContent).toContain('简介与价格暂未获取')
  })

  it('支持键盘切页且查询期间不改全局设置、节点或参数', async () => {
    await render()
    await click(button('模型列表'))
    await act(async () => { button('图片').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await vi.advanceTimersByTimeAsync(30) })
    expect(button('视频').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(button('视频'))
    expect(fixture.setSettings).not.toHaveBeenCalled()
  })
})
