// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import UsageLogsButton from './UsageLogsButton'
import UsageLogsModal from './UsageLogsModal'
import { DEFAULT_SETTINGS, LOCKED_WENYUN_PROFILE_ID } from '../lib/apiProfiles'
import { useStore } from '../store'
import { fetchAccountUsageLogs, type AccountUsageLog } from '../lib/newApiLogs'
import { fetchNewApiSiteStatus } from '../lib/newApiAccount'

vi.mock('../lib/newApiLogs', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/newApiLogs')>()), fetchAccountUsageLogs: vi.fn(),
}))
vi.mock('../lib/newApiAccount', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/newApiAccount')>()),
  fetchNewApiSiteStatus: vi.fn(async () => ({ quota_per_unit: 500000, quota_display_type: 'CUSTOM', custom_currency_symbol: 'HUHN', custom_currency_exchange_rate: 1 })),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const session = { siteProfileId: LOCKED_WENYUN_PROFILE_ID, userId: 901, username: '日志测试', accessToken: 'fixture-access', authSessionId: 'fixture-sid', boundApiKey: 'fixture-media' }
const initial = useStore.getState().settings
const log: AccountUsageLog = { id: 1, createdAt: 1793073600, type: 2, content: '生成完成 <img src=x onerror=alert(1)>', model: '测试模型', group: '图片官渠', tokenName: '媒体令牌', quota: 250000, promptTokens: 120, completionTokens: 320, seconds: 31, stream: false, requestId: 'req-123', upstreamRequestId: 'up-456' }
let root: Root, host: HTMLDivElement, client: QueryClient
const requireLogin = vi.fn()

async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }) }
async function render(button = false) {
  await act(async () => root.render(<QueryClientProvider client={client}>{button ? <UsageLogsButton onRequireLogin={requireLogin} /> : <UsageLogsModal profile={DEFAULT_SETTINGS.profiles[0]} session={session} onClose={() => {}} onRequireLogin={requireLogin} />}</QueryClientProvider>))
  await settle()
}
function findButton(label: string) {
  const found = Array.from(document.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label)
  expect(found).toBeDefined()
  return found!
}
async function click(label: string) { await act(async () => findButton(label).click()); await settle() }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchAccountUsageLogs).mockResolvedValue({ items: [log], total: 25 })
  useStore.setState({ settings: { ...DEFAULT_SETTINGS, newApiAccountSessions: { [LOCKED_WENYUN_PROFILE_ID]: session } } })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); client.clear(); host.remove()
  useStore.setState({ settings: initial }); vi.useRealTimers()
})

it('关闭时不读取日志，打开后自动读取当前账号和金额配置', async () => {
  await render(true)
  expect(fetchAccountUsageLogs).not.toHaveBeenCalled()
  expect(fetchNewApiSiteStatus).not.toHaveBeenCalled()
  await click('使用日志'); await settle()
  expect(fetchAccountUsageLogs).toHaveBeenCalledTimes(1)
  expect(vi.mocked(fetchAccountUsageLogs).mock.calls[0][1]).toEqual(session)
  expect(document.body.textContent).toContain('HUHN 0.5')
  expect(document.querySelector('[role=dialog]')).not.toBeNull()
})

it('未登录只打开登录窗口，不匿名请求日志', async () => {
  useStore.setState({ settings: { ...DEFAULT_SETTINGS, newApiAccountSessions: {} } })
  await render(true); await click('使用日志')
  expect(requireLogin).toHaveBeenCalledTimes(1)
  expect(fetchAccountUsageLogs).not.toHaveBeenCalled()
})

it('分页与刷新只请求当前页，筛选草稿输入不立即查询', async () => {
  await render()
  await click('下一页')
  expect(vi.mocked(fetchAccountUsageLogs).mock.calls.at(-1)?.[3]).toBe(2)
  await click('刷新')
  expect(vi.mocked(fetchAccountUsageLogs).mock.calls.at(-1)?.[3]).toBe(2)
  const before = vi.mocked(fetchAccountUsageLogs).mock.calls.length
  const input = document.querySelector<HTMLInputElement>('input[placeholder="全部模型"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '新模型'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(fetchAccountUsageLogs).toHaveBeenCalledTimes(before)
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await settle()
  expect(vi.mocked(fetchAccountUsageLogs).mock.calls.at(-1)?.[2].model).toBe('新模型')
  expect(vi.mocked(fetchAccountUsageLogs).mock.calls.at(-1)?.[3]).toBe(1)
})

it('日志详情按纯文本显示，不执行日志里的HTML', async () => {
  await render(); await click('详情')
  expect(document.body.textContent).toContain(log.content)
  expect(document.body.textContent).toContain('req-123')
  expect(document.querySelector('img')).toBeNull()
})

it('关闭窗口取消在途请求并移除内容', async () => {
  let signal: AbortSignal | undefined
  vi.mocked(fetchAccountUsageLogs).mockImplementation((_p, _s, _f, _page, _size, s) => { signal = s; return new Promise(() => {}) })
  await render(true); await click('使用日志')
  expect(signal?.aborted).toBe(false)
  await click('关闭日志')
  expect(signal?.aborted).toBe(true)
  expect(document.querySelector('[role=dialog]')).toBeNull()
})

it('切换账号立即清空上一账号内容，迟到续期不能覆盖新账号', async () => {
  await render(true); await click('使用日志')
  const update = vi.mocked(fetchAccountUsageLogs).mock.calls.at(-1)?.[6]
  vi.mocked(fetchAccountUsageLogs).mockImplementation(() => new Promise(() => {}))
  await act(async () => useStore.getState().setSettings({ newApiAccountSessions: { [LOCKED_WENYUN_PROFILE_ID]: { ...session, userId: 902, username: '另一个账号', accessToken: 'other-access', authSessionId: 'other-sid' } } }))
  await settle()
  expect(document.body.textContent).not.toContain(log.model)
  expect(document.body.textContent).toContain('另一个账号')
  update?.({ ...session, accessToken: 'late-access' })
  expect(useStore.getState().settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]?.accessToken).toBe('other-access')
})

it('退出账号后不显示日志，迟到续期不恢复登录', async () => {
  await render(true); await click('使用日志')
  const update = vi.mocked(fetchAccountUsageLogs).mock.calls.at(-1)?.[6]
  await act(async () => useStore.getState().setSettings({ newApiAccountSessions: {} }))
  update?.({ ...session, accessToken: 'late-access' })
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(useStore.getState().settings.newApiAccountSessions).toEqual({})
})

it('续期只更新认证字段，不覆盖同时更新的媒体Key', async () => {
  await render()
  await act(async () => {
    useStore.getState().setSettings({ newApiAccountSessions: { [LOCKED_WENYUN_PROFILE_ID]: { ...session, boundApiKey: 'new-media' } } })
    vi.mocked(fetchAccountUsageLogs).mock.calls[0][6]?.({ ...session, accessToken: 'renewed' })
  })
  expect(useStore.getState().settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]).toMatchObject({ accessToken: 'renewed', boundApiKey: 'new-media' })
})

it('读取失败提供重试入口，不自动轮询或随窗口聚焦重复请求', async () => {
  vi.mocked(fetchAccountUsageLogs).mockRejectedValue(new Error('429 请求过于频繁'))
  await render()
  expect(document.querySelector('[role=alert]')?.textContent).toContain('429')
  vi.useFakeTimers()
  await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(120000) })
  expect(fetchAccountUsageLogs).toHaveBeenCalledTimes(1)
  vi.useRealTimers()
  await click('重试')
  expect(fetchAccountUsageLogs).toHaveBeenCalledTimes(2)
})

it('登录明确过期后提供重新登录且不循环重试', async () => {
  vi.mocked(fetchAccountUsageLogs).mockRejectedValue(new Error('登录状态已过期，请退出账号后重新登录'))
  await render(); await click('重新登录')
  expect(requireLogin).toHaveBeenCalledTimes(1)
  expect(fetchAccountUsageLogs).toHaveBeenCalledTimes(1)
})

it('成功读取后等待两分钟和切回窗口都不后台轮询', async () => {
  await render()
  vi.useFakeTimers()
  await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(120000) })
  expect(fetchAccountUsageLogs).toHaveBeenCalledTimes(1)
})

it('空结果有明确提示，不把本页统计冒充全部日期汇总', async () => {
  vi.mocked(fetchAccountUsageLogs).mockResolvedValue({ items: [], total: 0 })
  await render()
  expect(document.body.textContent).toContain('暂无符合条件的日志')
  expect(document.body.textContent).toContain('本页消费')
  expect(findButton('下一页').disabled).toBe(true)
})
