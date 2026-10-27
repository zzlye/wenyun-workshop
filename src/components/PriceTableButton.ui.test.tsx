// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PriceTableButton from './PriceTableButton'
import { DEFAULT_SETTINGS, normalizeSettings } from '../lib/apiProfiles'
import type { AppSettings } from '../types'
import { fetchNewApiAccountModelCatalog, requestNewApiAccountResource } from '../lib/newApiAccount'

const fixture = vi.hoisted(() => ({ settings: {} as AppSettings, setSettings: vi.fn(), embeddedCatalog: true }))
vi.mock('../store', () => ({ useStore: Object.assign((selector: (state: typeof fixture) => unknown) => selector(fixture), { getState: () => fixture }) }))
vi.mock('./SupportJoinGroupNotice', () => ({ default: () => null }))
vi.mock('../lib/newApiAccount', () => ({
  requestNewApiAccountResource: vi.fn(async () => ({ groups: ['账号分组'] })),
  fetchNewApiAccountModelCatalog: vi.fn(async () => ({ group_ratio: { 账号分组: 3 }, data: [
    { model_name: 'gpt-image-2', enable_groups: ['账号分组'], quota_type: 1, model_price: .02 },
  ] })),
  fetchNewApiSiteStatus: vi.fn(async () => ({ quota_display_type: 'CUSTOM', custom_currency_symbol: 'HUHN', custom_currency_exchange_rate: 1 })),
}))
vi.mock('../lib/newApi', async original => ({ ...await original<typeof import('../lib/newApi')>(),
  queryNewApiModelPerformance: vi.fn(async () => ({ found: true, items: [{ model: 'sd2.5-720p', successRate: 0 }], updatedAt: 1 })),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root, client: QueryClient
let ratio: number, failed: boolean, requests: { url: string; headers: HeadersInit | undefined }[]
const status = { quota_display_type: 'CUSTOM', custom_currency_symbol: 'HUHN', custom_currency_exchange_rate: 1 }
const panel = () => document.querySelector('[role="tabpanel"]:not([hidden])')!
const button = (name: string) => Array.from(document.querySelectorAll('button')).find(item => item.textContent === name)!
const settle = async () => act(async () => { await vi.advanceTimersByTimeAsync(40) })
const render = async () => { await act(async () => root.render(<QueryClientProvider client={client}><PriceTableButton activeProfile={fixture.settings.profiles[0]} /></QueryClientProvider>)); await settle() }
const click = async (element: HTMLElement) => { await act(async () => element.click()); await settle() }
const open = async () => { await render(); await click(button('模型列表')) }

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); ratio = 4; failed = false; requests = []; fixture.embeddedCatalog = true
  fixture.settings = normalizeSettings({ ...DEFAULT_SETTINGS, videoApiKey: 'media-key', accountApiKeyMode: 'manual',
    profiles: DEFAULT_SETTINGS.profiles.map(profile => ({ ...profile, apiKey: 'media-key' })) })
  fixture.setSettings.mockClear()
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), headers: init?.headers })
    if (failed) return new Response('{}', { status: 503 })
    if (!String(url).endsWith('/models')) throw new Error('不应借用账号价格：' + String(url))
    return new Response(JSON.stringify({ data: [
      { id: 'gpt-image-2' }, { id: '官-gpt-image-2.5-flare', supported_endpoint_types: ['image-generation'] }, { id: 'sd2.5-720p' },
    ], media_catalog: fixture.embeddedCatalog ? { groups: ['adobe-image', '官key-image', '视频'], group_ratio: { 'adobe-image': ratio, '官key-image': 4.6, 视频: 2 }, status,
      data: [
        { model_name: 'gpt-image-2', enable_groups: ['adobe-image'], quota_type: 1, model_price: .02 },
        { model_name: '官-gpt-image-2.5-flare', enable_groups: ['官key-image'], billing_mode: 'tiered_expr', billing_expr: 'tier("base", p * 5 + img_o * 30)' },
        { model_name: 'sd2.5-720p', enable_groups: ['视频'], quota_type: 1, model_price: .1, billing_mode: 'per_second', description: '视频模型简介' },
      ] } : undefined }))
  }))
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('真实分类与倍率模型列表', () => {
  it('图片显示实际分类、倍率、含倍率按次价格及Token分项价格', async () => {
    await open()
    expect(panel().textContent).toContain('adobe-image4 倍')
    expect(panel().textContent).toContain('HUHN 0.08 / 次')
    expect(panel().textContent).toContain('官key-image4.6 倍')
    expect(panel().textContent).toContain('HUHN 138 / 百万 Token')
    expect(fixture.setSettings).not.toHaveBeenCalled()
  })
  it('切视频复用同一Key目录，显示每秒价格、简介和零成功率', async () => {
    await open(); const count = requests.length
    const dialog = document.querySelector('.animate-modal-in')!
    await click(button('视频'))
    expect(requests).toHaveLength(count)
    expect(panel().textContent).toContain('视频2 倍')
    expect(panel().textContent).toContain('HUHN 0.2 / 秒')
    expect(panel().textContent).toContain('视频模型简介')
    expect(panel().textContent).toContain('0.00%')
    expect(panel().textContent).not.toContain('gpt-image')
    expect(document.querySelector('.animate-modal-in')).toBe(dialog)
    expect(dialog.className).toContain('h-[82vh]')
  })
  it('刷新同步倍率和价格，不写入按站点共用的旧报价缓存', async () => {
    await open(); ratio = 5
    await click(button('刷新'))
    expect(panel().textContent).toContain('adobe-image5 倍')
    expect(panel().textContent).toContain('HUHN 0.1 / 次')
    expect(panel().textContent).not.toContain('HUHN 0.08 / 次')
    expect(fixture.setSettings).not.toHaveBeenCalled()
  })
  it('手填Key与登录账号不同也只使用Key自己的报价', async () => {
    fixture.settings.newApiAccountSessions['wenyun-site'] = { siteProfileId: 'wenyun-site', username: 'other', userId: 3, accessToken: 'other-session', boundApiKey: 'other-key', boundApiKeyPurpose: 'media' }
    await open()
    expect(requests.every(request => request.url.endsWith('/models'))).toBe(true)
    expect(requests[0].headers).toMatchObject({ Authorization: 'Bearer media-key' })
    expect(fetchNewApiAccountModelCatalog).not.toHaveBeenCalled()
  })
  it('旧目录只借用同一媒体Key绑定账号的报价，升级后停止重复查询', async () => {
    fixture.embeddedCatalog = false
    fixture.settings.newApiAccountSessions['wenyun-site'] = { siteProfileId: 'wenyun-site', username: 'own', userId: 3, accessToken: 'own-session', boundApiKey: 'media-key', boundApiKeyPurpose: 'media' }
    await open(); await settle()
    expect(panel().textContent).toContain('账号分组3 倍')
    expect(panel().textContent).toContain('HUHN 0.06 / 次')
    expect(requestNewApiAccountResource).toHaveBeenCalledTimes(1)
    expect(fetchNewApiAccountModelCatalog).toHaveBeenCalledTimes(1)
    fixture.embeddedCatalog = true
    await click(button('刷新'))
    expect(panel().textContent).toContain('adobe-image4 倍')
    expect(panel().textContent).not.toContain('账号分组')
    expect(fetchNewApiAccountModelCatalog).toHaveBeenCalledTimes(1)
  })
  it('旧目录换成其他Key后立即移除原账号报价，不借用账号接口', async () => {
    fixture.embeddedCatalog = false
    fixture.settings.newApiAccountSessions['wenyun-site'] = { siteProfileId: 'wenyun-site', username: 'own', userId: 3, accessToken: 'own-session', boundApiKey: 'media-key', boundApiKeyPurpose: 'media' }
    await open(); await settle()
    expect(panel().textContent).toContain('HUHN 0.06 / 次')
    fixture.settings = normalizeSettings({ ...fixture.settings, videoApiKey: 'other-key', profiles: fixture.settings.profiles.map(profile => ({ ...profile, apiKey: 'other-key' })) })
    await render(); await settle()
    expect(panel().textContent).not.toContain('HUHN 0.06 / 次')
    expect(panel().textContent).not.toContain('账号分组')
    expect(panel().textContent).toContain('此 Key 暂未返回可用分组')
    expect(panel().textContent).not.toContain('GPT Image')
    expect(fetchNewApiAccountModelCatalog).toHaveBeenCalledTimes(1)
  })
  it('换Key后不沿用上一把Key的倍率与报价', async () => {
    await open(); ratio = 3
    fixture.settings = normalizeSettings({ ...fixture.settings, videoApiKey: 'next-key', profiles: fixture.settings.profiles.map(profile => ({ ...profile, apiKey: 'next-key' })) })
    await render()
    expect(panel().textContent).toContain('adobe-image3 倍')
    expect(panel().textContent).toContain('HUHN 0.06 / 次')
    expect(requests.at(-1)?.headers).toMatchObject({ Authorization: 'Bearer next-key' })
  })
  it('目录失败不虚构固定价格和模型，错误可见', async () => {
    failed = true; await open()
    expect(panel().textContent).toContain('获取模型失败')
    expect(panel().textContent).not.toContain('HUHN 0.06')
  })
})
