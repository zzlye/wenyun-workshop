import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { requestNewApiAccountResource } from './newApiAccount'
import { defaultUsageLogFilters, fetchAccountUsageLogs, parseAccountUsageLogs, usageLogsQuery, usageLogTime, usageLogType } from './newApiLogs'
import { formatLotteryQuota } from './newApiLottery'

vi.mock('./newApiAccount', () => ({ requestNewApiAccountResource: vi.fn() }))
const session = { siteProfileId: 'wenyun-site', userId: 7, username: '测试账号', accessToken: 'fixture-access' }
const filters = defaultUsageLogFilters(new Date(2026, 9, 27, 12))
const raw = { id: 12, created_at: 1793073600, type: 2, content: '<img src=x onerror=alert(1)>', model_name: 'gpt-image-2', group: '图片官渠', token_name: '媒体令牌', quota: 125000, prompt_tokens: 150, completion_tokens: 260, use_time: 23, is_stream: true, request_id: 'req-test', upstream_request_id: 'up-test', other: '{"admin_info":{"secret":"no-display"}}', channel: 166, key: 'secret' }

beforeEach(() => vi.clearAllMocks())

describe('本人日志读取', () => {
  it('固定使用本人只读接口，保留取消信号与会话续期回调', async () => {
    vi.mocked(requestNewApiAccountResource).mockResolvedValue({ items: [raw], total: 21 })
    const controller = new AbortController(), update = vi.fn()
    const result = await fetchAccountUsageLogs(DEFAULT_SETTINGS.profiles[0], session, filters, 2, 20, controller.signal, update)
    const args = vi.mocked(requestNewApiAccountResource).mock.calls[0]
    expect(args[2]).toMatch(/^\/api\/log\/self\?/)
    expect(args[2]).toContain('p=2&page_size=20')
    expect(args[2]).not.toContain('user_id')
    expect(args[3]?.method).toBe('GET')
    expect(args[3]?.signal?.aborted).toBe(false)
    controller.abort()
    expect(args[3]?.signal?.aborted).toBe(true)
    expect(args[4]).toBe(update)
    expect(result.total).toBe(21)
    expect(result.items[0]).toMatchObject({ model: 'gpt-image-2', group: '图片官渠', quota: 125000, stream: true })
  })

  it('日期按用户本地完整自然日编码，中文筛选和特殊符号保持原义', () => {
    const query = new URLSearchParams(usageLogsQuery({ ...filters, model: ' 图片&视频 ', group: '官渠+50x', requestId: 'req=a&b', type: 5 }, 1, 50))
    expect(query.get('start_timestamp')).toBe(String(new Date(2026, 9, 27).getTime() / 1000))
    expect(query.get('end_timestamp')).toBe(String(new Date(2026, 9, 27, 23, 59, 59).getTime() / 1000))
    expect(query.get('model_name')).toBe('图片&视频')
    expect(query.get('group')).toBe('官渠+50x')
    expect(query.get('request_id')).toBe('req=a&b')
    expect(query.has('token_name')).toBe(false)
    expect(query.get('type')).toBe('5')
  })

  it('阻止无效日期、倒序时间和无上限分页请求', () => {
    expect(() => usageLogsQuery({ ...filters, startDate: '2026-02-30' }, 1, 20)).toThrow('有效的日期')
    expect(() => usageLogsQuery({ ...filters, startDate: '' }, 1, 20)).toThrow()
    expect(() => usageLogsQuery({ ...filters, startDate: '2026-10-28' }, 1, 20)).toThrow('晚于')
    expect(() => usageLogsQuery(filters, 0, 20)).toThrow('页码')
    expect(() => usageLogsQuery(filters, 1, 10000)).toThrow('分页')
    expect(() => usageLogsQuery({ ...filters, type: 99 }, 1, 20)).toThrow('类型')
  })

  it('只保留展示字段，内容保持普通文本而不是HTML', () => {
    const item = parseAccountUsageLogs({ items: [raw], total: 1 }).items[0]
    expect(item.content).toBe(raw.content)
    expect(item).not.toHaveProperty('other')
    expect(item).not.toHaveProperty('channel')
    expect(item).not.toHaveProperty('key')
    expect(JSON.stringify(item)).not.toContain('no-display')
  })

  it('区分空结果和协议错误，不把格式错误伪装成零条', () => {
    expect(parseAccountUsageLogs({ items: [], total: 0 })).toEqual({ items: [], total: 0 })
    expect(() => parseAccountUsageLogs({})).toThrow('格式异常')
    expect(() => parseAccountUsageLogs({ items: [], total: -1 })).toThrow()
    expect(() => parseAccountUsageLogs({ items: [{}], total: 1 })).toThrow('记录格式')
  })

  it('订阅消费采用本人日志的公开额度字段，内部诊断仍被剔除', () => {
    const item = parseAccountUsageLogs({ items: [{ ...raw, other: JSON.stringify({ billing_source: 'subscription', subscription_consumed: 456, admin_info: { secret: 'no-display' } }) }], total: 1 }).items[0]
    expect(item.subscriptionQuota).toBe(456)
    expect(item.billingSource).toBe('subscription')
    expect(JSON.stringify(item)).not.toContain('no-display')
    expect(parseAccountUsageLogs({ items: [{ ...raw, other: '{invalid' }], total: 1 }).items[0].quota).toBe(125000)
  })

  it('请求失败不自行重试或改用全站日志', async () => {
    vi.mocked(requestNewApiAccountResource).mockRejectedValue(new Error('429 请求过于频繁'))
    await expect(fetchAccountUsageLogs(DEFAULT_SETTINGS.profiles[0], session, filters, 1, 20)).rejects.toThrow('429')
    expect(requestNewApiAccountResource).toHaveBeenCalledTimes(1)
  })

  it('金额使用站点额度单位和汇率，站点配置缺失时明确显示额度', () => {
    expect(formatLotteryQuota(125000, { quota_per_unit: 500000, quota_display_type: 'CUSTOM', custom_currency_symbol: 'HUHN', custom_currency_exchange_rate: 2 })).toBe('HUHN 0.5')
    expect(formatLotteryQuota(125000, null)).toBe('125,000 额度')
    expect(usageLogType(0)).toBe('未知')
    expect(usageLogType(6)).toBe('退款')
    expect(usageLogTime(NaN)).toBe('—')
  })
})
