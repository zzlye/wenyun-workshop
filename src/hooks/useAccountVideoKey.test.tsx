// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store'
import { DEFAULT_SETTINGS, LOCKED_WENYUN_PROFILE_ID, normalizeSettings } from '../lib/apiProfiles'
import { getEffectiveVideoApiKey, getEffectiveImageApiProfile } from '../lib/accountApiKey'
import { AccountVideoKeySync, useAccountVideoKey } from './useAccountVideoKey'
import { useVideoModels } from './useVideoModels'
import { useMediaCatalog } from './useMediaCatalog'
import { groupMediaModels } from '../lib/mediaModels'
import type { AppSettings } from '../types'

vi.mock('../store', async () => {
  const { create } = await import('zustand')
  return { useStore: create<{ settings: AppSettings; setSettings: (patch: Partial<AppSettings>) => void }>(set => ({
    settings: {} as AppSettings,
    setSettings: patch => set(state => ({ settings: normalizeSettings({ ...state.settings, ...patch }) })),
  })) }
})
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root
let client: QueryClient
const session = { siteProfileId: LOCKED_WENYUN_PROFILE_ID, username: 'demo', userId: 2, accessToken: 'manager', boundApiKey: 'image-key' }
const mediaToken = { id: 9, name: '默认生图和视频 Key', purpose: 'media', is_default: true, status: 1, expired_time: -1, key: 'video-key' }
const response = (data: unknown) => new Response(JSON.stringify({ success: true, data }))

function Probe() {
  const key = useStore(state => getEffectiveVideoApiKey(state.settings))
  const binding = useAccountVideoKey()
  const models = useVideoModels(key, false)
  return <div>
    <span>{key}</span><span>{models.data?.join(',')}</span>
    {binding.isError && <span role="alert">{binding.error.message}</span>}
    <button onClick={() => void binding.refetch()}>重试</button>
  </div>
}
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><AccountVideoKeySync /><Probe /></QueryClientProvider>))
}
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
}
beforeEach(() => {
  useStore.setState({ settings: normalizeSettings({ ...DEFAULT_SETTINGS, accountApiKeyMode: 'account', newApiAccountSessions: { [LOCKED_WENYUN_PROFILE_ID]: session } }) })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  focusManager.setFocused(undefined)
  host.remove()
  vi.restoreAllMocks()
})

describe('账号视频凭据自动补齐', () => {
  it.each([['image-key', 'account'], ['other-custom-key', 'manual']])('迁移旧手填配置%s时，使用正确Key模式%s', async (manualKey, expectedMode) => {
    useStore.getState().setSettings({ accountApiKeyMode: 'manual', profiles: DEFAULT_SETTINGS.profiles.map(profile => ({ ...profile, apiKey: manualKey })) })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes('/api/token/?') ? response({ items: [mediaToken] }) : response([]))
    await render(); await settle(); await settle()
    const current = useStore.getState().settings
    expect(current.accountApiKeyMode).toBe(expectedMode)
    expect(getEffectiveImageApiProfile(current).apiKey).toBe(expectedMode === 'account' ? 'video-key' : manualKey)
  })
  it('恢复旧账号后先续期并换媒体Key，再用真实分组和倍率展示工坊与画布', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/auth/refresh')) return response({ id: 2, username: 'demo', access_token: 'catalog-renewed-manager' })
      if (url.includes('/api/token/?')) {
        if ((init?.headers as Record<string, string>).Authorization === 'Bearer manager') return new Response('{"message":"Unauthorized"}', { status: 401 })
        return response({ items: [mediaToken] })
      }
      if (url.endsWith('/models')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer video-key' })
        return new Response(JSON.stringify({ data: [{ id: 'gpt-image-2' }, { id: 'sd2.5-720p' }], media_catalog: {
          groups: ['后台图片分组', '后台视频分组'], group_ratio: { 后台图片分组: 4, 后台视频分组: 2 },
          status: { quota_display_type: 'CUSTOM', custom_currency_symbol: 'HUHN', custom_currency_exchange_rate: 1 },
          data: [{ model_name: 'gpt-image-2', enable_groups: ['后台图片分组'], quota_type: 1, model_price: .02 },
            { model_name: 'sd2.5-720p', enable_groups: ['后台视频分组'], quota_type: 1, model_price: .1, billing_mode: 'per_second' }],
        } }))
      }
      throw new Error('不应发送其他请求：' + url)
    })
    function CatalogProbe() {
      const settings = useStore(state => state.settings)
      const profile = getEffectiveImageApiProfile(settings)
      const catalog = useMediaCatalog(profile.baseUrl, profile.apiKey, false)
      return <span>{JSON.stringify({ groups: groupMediaModels([...(catalog.data?.images ?? []), ...(catalog.data?.videos ?? [])]), error: catalog.error?.message })}</span>
    }
    await act(async () => root.render(<QueryClientProvider client={client}><AccountVideoKeySync /><CatalogProbe /><CatalogProbe /></QueryClientProvider>))
    await settle(); await settle()
    expect(host.textContent).toContain('后台图片分组')
    expect(host.textContent).toContain('后台视频分组')
    expect(host.textContent).toContain('HUHN 0.08 / 次')
    expect(host.textContent).not.toContain('GPT Image')
    expect(getEffectiveImageApiProfile(useStore.getState().settings).apiKey).toBe('video-key')
    expect(getEffectiveVideoApiKey(useStore.getState().settings)).toBe('video-key')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/models'))).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(1)
  })
  it('旧登录续期短暂失败后自动恢复，保存新会话并补齐视频Key', async () => {
    let refreshes = 0
    useStore.getState().setSettings({ newApiAccountSessions: { [LOCKED_WENYUN_PROFILE_ID]: { ...session, authSessionId: 'old-session' } } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/auth/refresh')) {
        if (++refreshes === 1) return new Response(JSON.stringify({ success: false, message: '服务暂不可用' }), { status: 503 })
        return response({ access_token: 'renewed-manager', session: { sid: 'old-session' } })
      }
      if (url.includes('/api/token/?')) {
        if ((init?.headers as Record<string, string>).Authorization === 'Bearer manager') {
          return new Response(JSON.stringify({ success: false, message: 'Access token invalid' }), { status: 401 })
        }
        return response({ items: [mediaToken] })
      }
      if (url.endsWith('/models')) return response([{ id: 'wan' }])
      throw new Error('意外请求：' + url)
    })
    await render()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1200)) })
    await settle()
    expect(refreshes).toBe(2)
    expect(useStore.getState().settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]).toMatchObject({
      accessToken: 'renewed-manager', boundApiKey: 'video-key', boundApiKeyPurpose: 'media', boundVideoApiKey: 'video-key', boundVideoApiKeyGroup: 'auto',
    })
  })

  it('自动重试等待期间退出账号，不再发送旧账号请求', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    await render()
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => useStore.getState().setSettings({ newApiAccountSessions: {} }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1200)) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useStore.getState().settings.newApiAccountSessions).toEqual({})
  })

  it('老账号首次补齐遇到网络中断后自动恢复，模型列表使用视频Key', async () => {
    let attempts = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.includes('/api/token/?')) {
        if (++attempts === 1) throw new TypeError('Failed to fetch')
        return response({ items: [mediaToken] })
      }
      if (url.endsWith('/models')) return response([{ id: 'wan' }])
      throw new Error('意外请求：' + url)
    })
    await render()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1200)) })
    await settle()
    expect(getEffectiveVideoApiKey(useStore.getState().settings)).toBe('video-key')
    expect(host.textContent).toContain('wan')
    expect(attempts).toBe(2)
  })

  it('短暂服务故障重试耗尽后，切回页面会自动补齐且不重复创建Key', async () => {
    let available = false
    let attempts = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.includes('/api/token/?')) {
        attempts++
        if (!available) return new Response(JSON.stringify({ success: false, message: '服务暂不可用' }), { status: 503 })
        return response({ items: [mediaToken] })
      }
      if (url.endsWith('/models')) return response([{ id: 'wan' }])
      throw new Error('意外请求：' + url)
    })
    await render()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 3300)) })
    expect(attempts).toBe(3)
    expect(getEffectiveVideoApiKey(useStore.getState().settings)).toBe('')
    available = true
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true) })
    await settle()
    await settle()
    expect(getEffectiveVideoApiKey(useStore.getState().settings)).toBe('video-key')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/token/'))).toBe(false)
    focusManager.setFocused(undefined)
  })

  it('老账号自动绑定，两个观察者只创建一次，列表只用视频Key，退出后清空', async () => {
    let created: Record<string, unknown> | null = null
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/api/token/?')) return response({ items: created ? [{ ...created, id: 9, status: 1, key: 'vid***key' }] : [] })
      if (url.endsWith('/api/token/')) { created = JSON.parse(String(init?.body)); return response(null) }
      if (url.endsWith('/9/key')) return response({ key: 'video-key' })
      if (url.endsWith('/models')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer video-key' })
        return response([{ id: 'wan' }, { id: 'sd2.5-720p' }])
      }
      throw new Error('意外请求：' + url)
    })
    await render()
    await settle()
    await settle()
    expect(useStore.getState().settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]).toMatchObject({ boundApiKey: 'video-key', boundApiKeyPurpose: 'media', boundVideoApiKey: 'video-key', boundVideoApiKeyGroup: 'auto' })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/token/'))).toHaveLength(1)
    expect(host.textContent).toContain('sd2.5-720p,wan')
    await act(async () => useStore.getState().setSettings({ newApiAccountSessions: {} }))
    expect(host.textContent).not.toContain('video-key')
    expect(host.textContent).not.toContain('wan')
  })

  it('退出账号期间到达的绑定结果不恢复旧账号，也不发送模型请求', async () => {
    let resolveGroups!: (response: Response) => void
    const groups = new Promise<Response>(resolve => { resolveGroups = resolve })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).includes('/api/token/?')) return groups
      throw new Error('意外请求')
    })
    await render()
    await act(async () => useStore.getState().setSettings({ newApiAccountSessions: {} }))
    await act(async () => resolveGroups(response({ items: [mediaToken] })))
    await settle()
    expect(useStore.getState().settings.newApiAccountSessions).toEqual({})
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/models'))).toBe(false)
  })

  it('权限失败保留图片Key并显示错误，权限恢复后可以重试', async () => {
    let allowed = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.includes('/api/token/?')) return response({ items: [{ ...mediaToken, status: allowed ? 1 : 2 }] })
      if (url.endsWith('/models')) return response([{ id: 'wan' }])
      throw new Error('意外请求')
    })
    await render()
    await settle()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('已停用或过期')
    expect(useStore.getState().settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID].boundApiKey).toBe('image-key')
    allowed = true
    await act(async () => host.querySelector('button')!.click())
    await settle()
    await settle()
    expect(host.textContent).toContain('video-key')
    expect(host.textContent).not.toContain('已停用或过期')
  })
})
