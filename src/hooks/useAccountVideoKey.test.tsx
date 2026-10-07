// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store'
import { DEFAULT_SETTINGS, LOCKED_WENYUN_PROFILE_ID, normalizeSettings } from '../lib/apiProfiles'
import { getEffectiveVideoApiKey } from '../lib/accountApiKey'
import { AccountVideoKeySync, useAccountVideoKey } from './useAccountVideoKey'
import { useVideoModels } from './useVideoModels'
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
  host.remove()
  vi.restoreAllMocks()
})

describe('账号视频凭据自动补齐', () => {
  it('老账号自动绑定，两个观察者只创建一次，列表只用视频Key，退出后清空', async () => {
    let created: Record<string, unknown> | null = null
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/self/groups')) return response({ 视频: {} })
      if (url.includes('/api/token/?')) return response({ items: created ? [{ ...created, id: 9, status: 1, key: 'vid***key' }] : [] })
      if (url.endsWith('/api/token/')) { created = JSON.parse(String(init?.body)); return response(null) }
      if (url.endsWith('/9/key')) return response({ key: 'video-key' })
      if (url.endsWith('/models')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer video-key' })
        return response([{ id: 'wan' }, { id: 'sd' }])
      }
      throw new Error('意外请求：' + url)
    })
    await render()
    await settle()
    await settle()
    expect(useStore.getState().settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]).toMatchObject({ boundApiKey: 'image-key', boundVideoApiKey: 'video-key', boundVideoApiKeyGroup: '视频' })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/token/'))).toHaveLength(1)
    expect(host.textContent).toContain('sd,wan')
    await act(async () => useStore.getState().setSettings({ newApiAccountSessions: {} }))
    expect(host.textContent).not.toContain('video-key')
    expect(host.textContent).not.toContain('wan')
  })

  it('退出账号期间到达的绑定结果不恢复旧账号，也不发送模型请求', async () => {
    let resolveGroups!: (response: Response) => void
    const groups = new Promise<Response>(resolve => { resolveGroups = resolve })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).endsWith('/self/groups')) return groups
      if (String(input).includes('/api/token/?')) return response({ items: [{ id: 9, name: 'wy-video-old', group: '视频', unlimited_quota: true, key: 'video-key' }] })
      throw new Error('意外请求')
    })
    await render()
    await act(async () => useStore.getState().setSettings({ newApiAccountSessions: {} }))
    await act(async () => resolveGroups(response({ 视频: {} })))
    await settle()
    expect(useStore.getState().settings.newApiAccountSessions).toEqual({})
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/models'))).toBe(false)
  })

  it('权限失败保留图片Key并显示错误，权限恢复后可以重试', async () => {
    let allowed = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/self/groups')) return response(allowed ? { 视频: {} } : { default: {} })
      if (url.includes('/api/token/?')) return response({ items: [{ id: 9, name: 'wy-video-old', group: '视频', unlimited_quota: true, key: 'video-key' }] })
      if (url.endsWith('/models')) return response([{ id: 'wan' }])
      throw new Error('意外请求')
    })
    await render()
    await settle()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('未开通视频分组')
    expect(useStore.getState().settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID].boundApiKey).toBe('image-key')
    allowed = true
    await act(async () => host.querySelector('button')!.click())
    await settle()
    await settle()
    expect(host.textContent).toContain('video-key')
    expect(host.textContent).not.toContain('未开通视频分组')
  })
})
