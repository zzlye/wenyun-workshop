import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { requestNewApiAccountResource } from './newApiAccount'
import { defaultTaskLogFilters, taskLogsQuery, parseAccountTaskLogs, fetchAccountTaskLogs, fetchAccountTaskDetails, taskLogStatus, taskLogDuration } from './newApiTaskLogs'

vi.mock('./newApiAccount', () => ({ requestNewApiAccountResource: vi.fn() }))
const session = { siteProfileId: 'wenyun-site', userId: 7, username: '任务测试', accessToken: 'fixture-session' }
const profile = DEFAULT_SETTINGS.profiles[0]
const filters = { ...defaultTaskLogFilters(), startDate: '2026-10-27T10:00', endDate: '2026-10-27T11:00' }
const raw = { id: 12, task_id: 'async_test', submit_time: 100, start_time: 105, finish_time: 140, duration_finish_time: 130, status: 'FAILURE', fail_reason: '测试错误 <img src=x>', model_name: 'sd2.5-720p', is_async: true, quota: 125000, group: '视频', properties: { origin_model_name: 'fallback' }, data: { key: 'hidden' }, admin_info: { secret: 'hidden' }, result_url: 'https://hidden.invalid' }
beforeEach(() => vi.clearAllMocks())

it('任务列表固定本人接口，保留分页、认证会话、筛选和取消信号', async () => {
  vi.mocked(requestNewApiAccountResource).mockResolvedValue({ items: [raw], total: 25 })
  const controller = new AbortController(), update = vi.fn()
  const result = await fetchAccountTaskLogs(profile, session, { ...filters, model: '图&视频', taskId: 'async_中文&1', status: 'FAILURE' }, 2, 50, controller.signal, update)
  const args = vi.mocked(requestNewApiAccountResource).mock.calls[0]
  const url = new URL(args[2], 'https://fixture.invalid')
  expect(url.pathname).toBe('/api/task/self')
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ p: '2', page_size: '50', model_name: '图&视频', task_id: 'async_中文&1', status: 'FAILURE' })
  for (const forbidden of ['username', 'user_id', 'channel_id', 'type']) expect(url.searchParams.has(forbidden)).toBe(false)
  expect(args[1]).toEqual(session)
  expect(args[3]?.method).toBe('GET'); expect(args[4]).toBe(update)
  controller.abort(); expect(args[3]?.signal?.aborted).toBe(true)
  expect(result.total).toBe(25); expect(result.items[0].failReason).toBe(raw.fail_reason)
  expect(JSON.stringify(result)).not.toContain('hidden')
})

it('日期、状态及分页上限按实际后端契约校验', () => {
  const query = new URLSearchParams(taskLogsQuery(filters, 1, 20))
  expect(query.get('end_timestamp')).toBe(String(new Date(2026, 9, 27, 11, 0, 59).getTime() / 1000))
  expect(() => taskLogsQuery({ ...filters, status: 'invented' }, 1, 20)).toThrow('状态')
  expect(() => taskLogsQuery(filters, 1, 10000)).toThrow('分页')
  expect(() => taskLogsQuery({ ...filters, startDate: '2026-10-28' }, 1, 20)).toThrow('晚于')
})

it('空切片可识别，畸形协议不冒充空列表', () => {
  expect(parseAccountTaskLogs({ items: null, total: 0 })).toEqual({ items: [], total: 0 })
  for (const value of [{}, { items: null, total: 2 }, { items: [], total: -1 }, { items: [{}], total: 1 }]) expect(() => parseAccountTaskLogs(value)).toThrow('格式异常')
})

it('耗时从提交开始包含排队，使用展示结束时间排除后台保存耗时', () => {
  const log = parseAccountTaskLogs({ items: [raw], total: 1 }).items[0]
  expect(taskLogDuration(log)).toBe('30.0s')
  expect(taskLogDuration({ ...log, durationFinishTime: 0 })).toBe('—')
  expect(taskLogStatus('failed')).toBe('失败')
  expect(taskLogStatus('SUCCESS')).toBe('成功')
  expect(taskLogStatus('IN_PROGRESS')).toBe('进行中')
  expect(taskLogStatus('')).toBe('未知')
})

it('详情仅请求选中的异步任务并剔除内部字段', async () => {
  vi.mocked(requestNewApiAccountResource).mockResolvedValue({ task_id: 'async_test', prompt: '<script>plain</script>', parameters: { model: 'sd2.5', duration: '5', key: 'hidden' }, error: '上游失败', response_status_code: 400, full_parameters: { secret: 'hidden' }, routing_events: ['hidden'] })
  const result = await fetchAccountTaskDetails(profile, session, 'async_test')
  expect(vi.mocked(requestNewApiAccountResource).mock.calls[0][2]).toBe('/api/task/async_test/details')
  expect(result).toMatchObject({ prompt: '<script>plain</script>', error: '上游失败', responseStatusCode: 400, parameters: { model: 'sd2.5', duration: '5' } })
  expect(JSON.stringify(result)).not.toContain('hidden')
  await expect(fetchAccountTaskDetails(profile, session, '../all')).rejects.toThrow()
  expect(requestNewApiAccountResource).toHaveBeenCalledTimes(1)
})

it('错误请求不自动重试或退回管理员接口，详情任务编号必须一致', async () => {
  vi.mocked(requestNewApiAccountResource).mockRejectedValueOnce(new Error('429 请求过于频繁'))
  await expect(fetchAccountTaskLogs(profile, session, filters, 1, 20)).rejects.toThrow('429')
  expect(requestNewApiAccountResource).toHaveBeenCalledTimes(1)
  vi.mocked(requestNewApiAccountResource).mockResolvedValueOnce({ task_id: 'async_other' })
  await expect(fetchAccountTaskDetails(profile, session, 'async_test')).rejects.toThrow('格式异常')
})


it('媒体只保留当前任务的站内入口，任务快照过滤内部字段', async () => {
  vi.mocked(requestNewApiAccountResource).mockResolvedValue({ task_id: 'async_test', parameters: { duration: '5', secret: 'hidden' }, media: [
    { kind: 'image', url: '/api/task/async_test/media/0' },
    { kind: 'image', url: 'https://hidden.invalid/image' },
    { kind: 'video', url: '/api/task/async_other/media/0' },
    { kind: 'html', url: '/api/task/async_test/media/1' },
  ], references: [{ kind: 'audio', url: '/api/task/async_test/reference/0' }], full_parameters: {
    task_id: 'async_test', created_at: 100, request_content_type: 'application/json', request_conversion: ['Task'], request_body: '',
    request_details: { prompt: '输入提示词', references: [{ role: 'reference', kind: 'audio', content_type: 'audio/wave', key: 'hidden' }] },
    admin_info: { secret: 'hidden' },
  } })
  const result = await fetchAccountTaskDetails(profile, session, 'async_test')
  expect(result.media?.map(item => item.url)).toEqual(['/api/task/async_test/media/0', '', ''])
  expect(result.references?.[0].url).toBe('/api/task/async_test/reference/0')
  expect(result.fullParameters).toMatchObject({ created_at: 100, request_content_type: 'application/json', request_conversion: ['Task'], request_body: '', request_details: { parameters: { duration: '5' }, prompt: '输入提示词' } })
  expect(JSON.stringify(result)).not.toContain('hidden')
  expect(taskLogStatus('SUBMITTED')).toBe('排队中')
})
