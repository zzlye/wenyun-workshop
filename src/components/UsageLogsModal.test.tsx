// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import UsageLogsButton from './UsageLogsButton'
import UsageLogsModal from './UsageLogsModal'
import { DEFAULT_SETTINGS, LOCKED_WENYUN_PROFILE_ID } from '../lib/apiProfiles'
import { useStore } from '../store'
import { fetchAccountUsageLogs, fetchAccountUsageStats, fetchAccountLogGroups, type AccountUsageLog } from '../lib/newApiLogs'
import { fetchNewApiSiteStatus, requestNewApiAccountMedia } from '../lib/newApiAccount'
import { fetchAccountTaskLogs, fetchAccountTaskDetails, type AccountTaskLog } from '../lib/newApiTaskLogs'

vi.mock('../lib/newApiTaskLogs', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/newApiTaskLogs')>()), fetchAccountTaskLogs: vi.fn(), fetchAccountTaskDetails: vi.fn(),
}))

vi.mock('../lib/newApiLogs', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/newApiLogs')>()), fetchAccountUsageLogs: vi.fn(), fetchAccountUsageStats: vi.fn(), fetchAccountLogGroups: vi.fn(),
}))
vi.mock('../lib/newApiAccount', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/newApiAccount')>()),
  requestNewApiAccountMedia: vi.fn(),
  fetchNewApiSiteStatus: vi.fn(async () => ({ quota_per_unit: 500000, quota_display_type: 'CUSTOM', custom_currency_symbol: 'HUHN', custom_currency_exchange_rate: 1 })),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const session = { siteProfileId: LOCKED_WENYUN_PROFILE_ID, userId: 901, username: '日志测试', accessToken: 'fixture-access', authSessionId: 'fixture-sid', boundApiKey: 'fixture-media' }
const initial = useStore.getState().settings
const log: AccountUsageLog = { id: 1, createdAt: 1793073600, type: 2, content: '生成完成 <img src=x onerror=alert(1)>', model: '测试模型', group: '图片官渠', tokenName: '媒体令牌', quota: 250000, promptTokens: 120, completionTokens: 320, seconds: 31, stream: false, requestId: 'req-123', upstreamRequestId: 'up-456' }
let root: Root, host: HTMLDivElement, client: QueryClient
const requireLogin = vi.fn()
const task: AccountTaskLog = { id: 88, taskId: 'async_fixture', model: 'sd2.5-720p', group: '视频', status: 'FAILURE', progress: '100%', platform: 'video', action: 'GENERATE', quota: 125000, submitTime: 1793073600, startTime: 1793073601, finishTime: 1793073620, durationFinishTime: 1793073620, failReason: '上游测试错误', isAsync: true, mediaExpired: false, mediaSaving: false, requestPath: '/v1/videos' }

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
  vi.mocked(fetchAccountUsageStats).mockResolvedValue({ quota: 4500000, rpm: 12, tpm: 24680 })
  vi.mocked(fetchAccountLogGroups).mockResolvedValue(['图片官渠', 'adobe-image', '视频'])
  vi.mocked(fetchAccountTaskLogs).mockResolvedValue({ items: [task], total: 25 })
  vi.mocked(fetchAccountTaskDetails).mockResolvedValue({ taskId: task.taskId, prompt: '测试提示词 <img src=x>', promptSource: 'request', error: '详情错误', responseStatusCode: 400, parameters: { duration: '5' } })
  useStore.setState({ settings: { ...DEFAULT_SETTINGS, newApiAccountSessions: { [LOCKED_WENYUN_PROFILE_ID]: session } } })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); client.clear(); host.remove()
  useStore.setState({ settings: initial }); vi.useRealTimers()
  vi.restoreAllMocks()
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
  const input = document.querySelector<HTMLInputElement>('input[aria-label="模型"]')!
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
  vi.useFakeTimers()
  vi.mocked(fetchAccountUsageLogs).mockRejectedValue(new Error('429 请求过于频繁'))
  await act(async () => root.render(<QueryClientProvider client={client}><UsageLogsModal profile={DEFAULT_SETTINGS.profiles[0]} session={session} onClose={() => {}} onRequireLogin={requireLogin} /></QueryClientProvider>))
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  expect(document.querySelector('[role=alert]')?.textContent).toContain('429')
  await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(120000) })
  expect(fetchAccountUsageLogs).toHaveBeenCalledTimes(1)
  expect(findButton('重试').disabled).toBe(false)
  await act(async () => { findButton('重试').click(); await vi.advanceTimersByTimeAsync(100) })
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

it('空结果有明确提示，汇总由后端而非本页计算', async () => {
  vi.mocked(fetchAccountUsageLogs).mockResolvedValue({ items: [], total: 0 })
  await render()
  expect(document.body.textContent).toContain('暂无符合条件的日志')
  expect(document.body.textContent).toContain('HUHN 9')
  expect(document.body.textContent).not.toContain('本页消费')
  expect(findButton('下一页').disabled).toBe(true)
})

it('分组是后台下拉，筛选可收起，上游请求编号可以查询', async () => {
  await render()
  expect(document.querySelector('select[aria-label="分组"]')?.textContent).toContain('adobe-image')
  expect(document.querySelector('input[aria-label="上游请求 ID"]')).not.toBeNull()
  await click('收起')
  expect(document.querySelector('input[aria-label="上游请求 ID"]')).toBeNull()
  await click('展开')
  expect(document.querySelector('input[aria-label="上游请求 ID"]')).not.toBeNull()
  await click('隐藏用量')
  expect(document.body.textContent).not.toContain('HUHN 9')
})

it('翻页不重复聚合统计，改筛选才拉取新的汇总', async () => {
  await render(); await settle()
  expect(fetchAccountUsageStats).toHaveBeenCalledTimes(1)
  expect(document.body.textContent).toContain('HUHN 9')
  vi.useFakeTimers()
  await act(async () => { await vi.advanceTimersByTimeAsync(120000) })
  vi.useRealTimers()
  await click('下一页')
  expect(fetchAccountUsageStats).toHaveBeenCalledTimes(1)
})

it('列表未返回时筛选仍可修改，新条件请求替代旧条件', async () => {
  let oldSignal: AbortSignal | undefined
  vi.mocked(fetchAccountUsageLogs).mockImplementation((_p, _s, f, _page, _size, signal) => {
    if (f.model === '立即查询') return Promise.resolve({ items: [], total: 0 })
    oldSignal = signal; return new Promise(() => {})
  })
  await render()
  const input = document.querySelector<HTMLInputElement>('input[aria-label="模型"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '立即查询'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  await click('搜索')
  expect(oldSignal?.aborted).toBe(true)
  expect(document.body.textContent).toContain('暂无符合条件的日志')
})

it('任务页签才读取本人任务，详情按点击读取并保留失败原因', async () => {
  await render()
  expect(fetchAccountTaskLogs).not.toHaveBeenCalled()
  await click('任务日志')
  expect(fetchAccountTaskLogs).toHaveBeenCalledTimes(1)
  expect(vi.mocked(fetchAccountTaskLogs).mock.calls[0][1]).toEqual(session)
  expect(document.body.textContent).toContain('sd2.5-720p')
  expect(document.body.textContent).toContain('失败')
  expect(fetchAccountTaskDetails).not.toHaveBeenCalled()
  await click('查看任务详情')
  expect(fetchAccountTaskDetails).toHaveBeenCalledTimes(1)
  expect(document.body.textContent).toContain('HUHN 0.25')
  expect(document.body.textContent).toContain('测试提示词 <img src=x>')
  expect(document.body.textContent).toContain('400')
  expect(document.querySelector('img')).toBeNull()
  await click('关闭任务详情'); await click('查看任务详情')
  expect(fetchAccountTaskDetails).toHaveBeenCalledTimes(1)
  await click('下一页')
  expect(vi.mocked(fetchAccountTaskLogs).mock.calls.at(-1)?.[3]).toBe(2)
  expect(fetchAccountTaskDetails).toHaveBeenCalledTimes(1)
})

it('任务模型筛选对齐本人页面，不提前读取草稿', async () => {
  await render(); await click('任务日志')
  expect(document.querySelector('select[aria-label="任务状态"]')).toBeNull()
  const input = document.querySelector<HTMLInputElement>('input[aria-label="模型"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'sd2.5-720p'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(fetchAccountTaskLogs).toHaveBeenCalledTimes(1)
  await click('搜索')
  expect(vi.mocked(fetchAccountTaskLogs).mock.calls.at(-1)?.[2].model).toBe('sd2.5-720p')
})

it('同条件搜索和刷新连点不重复查询，冷却后只发一次新请求', async () => {
  await render()
  for (let i = 0; i < 3; i++) { await click('刷新'); await click('搜索') }
  expect(fetchAccountUsageLogs).toHaveBeenCalledTimes(1)
  const realNow = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(realNow + 6000)
  await click('搜索')
  expect(fetchAccountUsageLogs).toHaveBeenCalledTimes(2)
  await click('搜索'); await click('搜索')
  expect(fetchAccountUsageLogs).toHaveBeenCalledTimes(2)
  vi.restoreAllMocks()
  await click('任务日志')
  for (let i = 0; i < 3; i++) { await click('刷新'); await click('搜索') }
  expect(fetchAccountTaskLogs).toHaveBeenCalledTimes(1)
})

it('在途相同条件搜索不取消重发，切换页签才取消旧请求', async () => {
  let usageSignal: AbortSignal | undefined, taskSignal: AbortSignal | undefined
  vi.mocked(fetchAccountUsageLogs).mockImplementation((_p, _s, _f, _page, _size, signal) => { usageSignal = signal; return new Promise(() => {}) })
  vi.mocked(fetchAccountTaskLogs).mockImplementation((_p, _s, _f, _page, _size, signal) => { taskSignal = signal; return new Promise(() => {}) })
  await render(true); await click('使用日志'); await click('搜索')
  expect(fetchAccountUsageLogs).toHaveBeenCalledTimes(1); expect(usageSignal?.aborted).toBe(false)
  await click('任务日志')
  expect(usageSignal?.aborted).toBe(true); expect(taskSignal?.aborted).toBe(false)
  await click('关闭日志'); expect(taskSignal?.aborted).toBe(true)
})

it('快速来回切换页签和关闭重开复用短缓存，不同时请求两种日志', async () => {
  await render(true); await click('使用日志'); await click('任务日志')
  await act(async () => (document.querySelector('[role=tab][aria-selected=false]') as HTMLButtonElement).click()); await settle()
  await click('任务日志')
  expect(fetchAccountUsageLogs).toHaveBeenCalledTimes(1); expect(fetchAccountTaskLogs).toHaveBeenCalledTimes(1)
  await click('关闭日志'); await click('使用日志'); await click('任务日志')
  expect(fetchAccountUsageLogs).toHaveBeenCalledTimes(1); expect(fetchAccountTaskLogs).toHaveBeenCalledTimes(1)
  vi.useFakeTimers()
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); window.dispatchEvent(new Event('focus')) })
  expect(fetchAccountTaskLogs).toHaveBeenCalledTimes(1)
})

it('退出时移除本人日志缓存，普通任务不请求异步详情', async () => {
  vi.mocked(fetchAccountTaskLogs).mockResolvedValue({ items: [{ ...task, isAsync: false, taskId: 'task_normal' }], total: 1 })
  await render(true); await click('使用日志'); await click('任务日志'); await click('查看任务详情')
  expect(fetchAccountTaskDetails).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('上游测试错误')
  await act(async () => useStore.getState().setSettings({ newApiAccountSessions: {} })); await settle()
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(client.getQueryCache().getAll().some(q => q.queryKey[0] === 'wenyun-task-logs')).toBe(false)
})

it('任务详情关闭会取消在途读取，任务列表本身不会下载结果文件', async () => {
  let signal: AbortSignal | undefined
  vi.mocked(fetchAccountTaskDetails).mockImplementation((_p, _s, _id, value) => { signal = value; return new Promise(() => {}) })
  await render(); await click('任务日志'); await click('查看任务详情')
  expect(signal?.aborted).toBe(false)
  await click('关闭任务详情'); expect(signal?.aborted).toBe(true)
  expect(fetchAccountTaskLogs).toHaveBeenCalledTimes(1)
  expect(document.querySelector('video,img')).toBeNull()
})

it('切换账号不会复用上一账号的任务缓存，旧详情请求被取消', async () => {
  let signal: AbortSignal | undefined
  vi.mocked(fetchAccountTaskDetails).mockImplementation((_p, _s, _id, value) => { signal = value; return new Promise(() => {}) })
  await render(true); await click('使用日志'); await click('任务日志'); await click('查看任务详情')
  const update = vi.mocked(fetchAccountTaskLogs).mock.calls[0][6]
  vi.mocked(fetchAccountTaskLogs).mockResolvedValue({ items: [], total: 0 })
  await act(async () => useStore.getState().setSettings({ newApiAccountSessions: { [LOCKED_WENYUN_PROFILE_ID]: { ...session, userId: 902, username: '其他用户', accessToken: 'other', authSessionId: 'other-sid' } } }))
  await settle(); await click('任务日志')
  expect(signal?.aborted).toBe(true)
  expect(document.body.textContent).not.toContain(task.taskId)
  expect(document.body.textContent).toContain('暂无符合条件的任务')
  expect(vi.mocked(fetchAccountTaskLogs).mock.calls.at(-1)?.[1].userId).toBe(902)
  update?.({ ...session, accessToken: 'late-access' })
  expect(useStore.getState().settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]?.accessToken).toBe('other')
})


it('合并时间范围确认后才更新筛选，ESC只关闭最上层', async () => {
  await render(true); await click('使用日志'); await click('任务日志')
  expect(document.querySelector('input[type="datetime-local"]')).toBeNull()
  await click('时间范围')
  expect(document.querySelectorAll('input[type="datetime-local"]')).toHaveLength(2)
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('[aria-label="选择时间范围"]')).toBeNull()
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await click('时间范围'); await click('近7天')
  expect(fetchAccountTaskLogs).toHaveBeenCalledTimes(1)
  await click('搜索'); expect(fetchAccountTaskLogs).toHaveBeenCalledTimes(2)
  await click('查看任务详情')
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('[data-task-details-dialog]')).toBeNull()
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
})

it('表格按本人任务列顺序展示并支持隐藏列，翻页不关闭详情', async () => {
  await render(); await click('任务日志')
  expect(Array.from(document.querySelectorAll('th')).map(node => node.textContent)).toEqual(['提交时间', '任务 ID', '接口 / 模型', '耗时', '状态', '进度', '详情'])
  await click('显示列')
  await act(async () => (document.querySelector('[aria-label="显示列选项"] input') as HTMLInputElement).click())
  expect(document.querySelectorAll('th')).toHaveLength(6)
  await click('查看任务详情'); await click('下一页')
  expect(document.querySelector('[data-task-details-dialog]')).not.toBeNull()
  expect(document.querySelector('[data-task-details-dialog]')?.textContent).toContain(task.taskId)
})

it('任务文件主动预览才读取，关闭详情取消读取并释放预览地址', async () => {
  vi.mocked(fetchAccountTaskDetails).mockResolvedValue({ taskId: task.taskId, prompt: '', promptSource: 'request', error: '', responseStatusCode: 200, parameters: {}, media: [{ kind: 'image', contentType: 'image/png', name: '生成图片', role: '', url: '/api/task/async_fixture/media/0', error: '' }] })
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture-image')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.mocked(requestNewApiAccountMedia).mockResolvedValue(new Blob(['fixture'], { type: 'image/png' }))
  await render(); await click('任务日志'); await click('查看任务详情')
  expect(requestNewApiAccountMedia).not.toHaveBeenCalled()
  await click('预览图片')
  expect(requestNewApiAccountMedia).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledTimes(1)
  expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:fixture-image')
  await click('关闭任务详情'); expect(revoke).toHaveBeenCalledWith('blob:fixture-image')
  let signal: AbortSignal | undefined
  vi.mocked(requestNewApiAccountMedia).mockImplementation((_p, _s, _url, value) => { signal = value; return new Promise(() => {}) })
  await click('查看任务详情'); await click('预览图片')
  expect(signal?.aborted).toBe(false)
  await click('关闭任务详情'); expect(signal?.aborted).toBe(true)
})

it('已过期素材不提供预览，也不发出媒体请求', async () => {
  vi.mocked(fetchAccountTaskDetails).mockResolvedValue({ taskId: task.taskId, prompt: '', promptSource: '', error: '', responseStatusCode: 200, parameters: {}, expiresAt: Math.floor(Date.now() / 1000) - 1, media: [{ kind: 'image', contentType: 'image/png', name: '', role: '', url: '/api/task/async_fixture/media/0', error: '' }] })
  await render(); await click('任务日志'); await click('查看任务详情')
  expect(document.body.textContent).toContain('生成结果文件已过期')
  expect(document.body.textContent).not.toContain('预览图片')
  expect(requestNewApiAccountMedia).not.toHaveBeenCalled()
})
