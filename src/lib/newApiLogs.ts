import type { ApiProfile, NewApiAccountSession } from '../types'
import { requestNewApiAccountResource } from './newApiAccount'

export const USAGE_LOG_TYPES = [
  { value: 0, label: '全部类型' }, { value: 1, label: '充值' },
  { value: 2, label: '消费' }, { value: 3, label: '管理' },
  { value: 4, label: '系统' }, { value: 5, label: '错误' },
  { value: 6, label: '退款' }, { value: 7, label: '登录' },
] as const

export interface UsageLogFilters {
  startDate: string
  endDate: string
  type: number
  model: string
  group: string
  tokenName: string
  requestId: string
  upstreamRequestId?: string
  detail: string
}

export interface AccountUsageLog {
  id: number
  createdAt: number
  type: number
  content: string
  model: string
  group: string
  tokenName: string
  quota: number
  billingSource?: 'subscription' | 'wallet'
  subscriptionQuota?: number
  promptTokens: number
  completionTokens: number
  seconds: number
  stream: boolean
  requestId: string
  upstreamRequestId: string
}

export interface AccountUsageLogPage {
  items: AccountUsageLog[]
  total: number
}

export function defaultUsageLogFilters(now = new Date()): UsageLogFilters {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return { startDate: `${date}T00:00`, endDate: `${date}T${time}`, type: 0, model: '', group: '', tokenName: '', requestId: '', upstreamRequestId: '', detail: '' }
}

function dateTimestamp(value: string, end: boolean): number {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value)) throw new Error('请选择有效的日期')
  const date = new Date(value.includes('T') ? `${value}:${end ? '59' : '00'}` : `${value}T${end ? '23:59:59' : '00:00:00'}`)
  const normalized = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  if (!Number.isFinite(date.getTime()) || normalized !== value.slice(0, 10) || value.includes('T') && (date.getHours() !== Number(value.slice(11, 13)) || date.getMinutes() !== Number(value.slice(14, 16)))) throw new Error('请选择有效的日期')
  return Math.floor(date.getTime() / 1000)
}

export function usageLogsQuery(filters: UsageLogFilters, page: number, pageSize: number): string {
  const start = dateTimestamp(filters.startDate, false)
  const end = dateTimestamp(filters.endDate, true)
  if (start > end) throw new Error('开始日期不能晚于结束日期')
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('日志页码无效')
  if (![20, 50].includes(pageSize)) throw new Error('日志分页大小无效')
  if (!USAGE_LOG_TYPES.some(item => item.value === filters.type)) throw new Error('日志类型无效')
  if (Array.from(filters.detail.trim()).length > 256) throw new Error('详情关键词不能超过 256 个字符')
  const query = new URLSearchParams({
    p: String(page), page_size: String(pageSize), type: String(filters.type),
    start_timestamp: String(start), end_timestamp: String(end),
  })
  // 仅传本人接口支持的条件，不提供用户编号或管理端渠道筛选。
  for (const [key, value] of Object.entries({
    model_name: filters.model, group: filters.group, token_name: filters.tokenName,
    request_id: filters.requestId, upstream_request_id: filters.upstreamRequestId ?? '', detail: filters.detail,
  })) {
    if (value.trim()) query.set(key, value.trim())
  }
  return query.toString()
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0 }

export function parseAccountUsageLogs(value: unknown): AccountUsageLogPage {
  const data = record(value)
  if (!Array.isArray(data.items) || typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0) {
    throw new Error('日志数据格式异常，请稍后重试')
  }
  return {
    total: data.total,
    items: data.items.map(value => {
      const item = record(value)
      if (!Number.isSafeInteger(item.id) || typeof item.created_at !== 'number' || !Number.isFinite(item.created_at)) {
        throw new Error('日志记录格式异常，请稍后重试')
      }
      let other: Record<string, unknown> = {}
      try { other = record(typeof item.other === 'string' ? JSON.parse(item.other) : item.other) } catch { /* 历史附加信息损坏不影响基本日志展示。 */ }
      const billingSource = other.billing_source === 'subscription' || other.billing_source === 'wallet' ? other.billing_source : undefined
      // 白名单投影避免管理员会话返回的 other、渠道密钥等内部信息进入日志窗口。
      return {
        id: item.id as number, createdAt: item.created_at, type: number(item.type),
        content: text(item.content), model: text(item.model_name), group: text(item.group),
        tokenName: text(item.token_name), quota: number(item.quota),
        billingSource,
        subscriptionQuota: billingSource === 'subscription' && typeof other.subscription_consumed === 'number' && Number.isFinite(other.subscription_consumed) ? other.subscription_consumed : undefined,
        promptTokens: number(item.prompt_tokens), completionTokens: number(item.completion_tokens),
        seconds: number(item.use_time), stream: item.is_stream === true,
        requestId: text(item.request_id), upstreamRequestId: text(item.upstream_request_id),
      }
    }),
  }
}

export async function fetchAccountUsageLogs(
  profile: ApiProfile, session: NewApiAccountSession, filters: UsageLogFilters,
  page: number, pageSize: number, signal?: AbortSignal,
  onSessionUpdated?: (session: NewApiAccountSession) => void,
): Promise<AccountUsageLogPage> {
  // 所有账号（包括管理员）固定读取 self，范围由 NewAPI 登录态在服务端确定。
  const query = usageLogsQuery(filters, page, pageSize)
  const timeout = AbortSignal.timeout(30000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    const data = await requestNewApiAccountResource<unknown>(
      profile, session, `/api/log/self?${query}`, { method: 'GET', signal: requestSignal }, onSessionUpdated,
    )
    return parseAccountUsageLogs(data)
  } catch (error) {
    if (timeout.aborted && !signal?.aborted) throw new Error('日志读取超时，请稍后重试')
    throw error
  }
}

export function usageLogType(type: number): string {
  return type === 0 ? '未知' : USAGE_LOG_TYPES.find(item => item.value === type)?.label ?? '未知'
}

export function usageLogTime(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

export type AccountUsageStats = { quota: number; rpm: number; tpm: number }

// 当前 NewAPI 统计接口尚未支持请求编号，不能把忽略编号后的总量冒充筛选结果。
export function canQueryUsageStats(filters: UsageLogFilters): boolean {
  return !filters.requestId.trim() && !filters.upstreamRequestId?.trim()
}

export async function fetchAccountUsageStats(
  profile: ApiProfile, session: NewApiAccountSession, filters: UsageLogFilters, signal?: AbortSignal,
  onSessionUpdated?: (session: NewApiAccountSession) => void,
): Promise<AccountUsageStats> {
  if (!canQueryUsageStats(filters)) throw new Error('请求编号筛选暂不支持汇总统计')
  const query = new URLSearchParams(usageLogsQuery(filters, 1, 20))
  query.delete('p'); query.delete('page_size')
  // NewAPI 用量固定统计消费记录，RPM/TPM固定统计最近60秒，直接沿用后端结果。
  const timeout = AbortSignal.timeout(30000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const data = record(await requestNewApiAccountResource<unknown>(profile, session, `/api/log/self/stat?${query}`, { method: 'GET', signal: requestSignal }, onSessionUpdated))
  if (![data.quota, data.rpm, data.tpm].every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error('日志统计格式异常')
  return { quota: data.quota as number, rpm: data.rpm as number, tpm: data.tpm as number }
}

export async function fetchAccountLogGroups(
  profile: ApiProfile, session: NewApiAccountSession, signal?: AbortSignal,
  onSessionUpdated?: (session: NewApiAccountSession) => void,
): Promise<string[]> {
  const timeout = AbortSignal.timeout(30000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const request = (path: string) => requestNewApiAccountResource<unknown>(profile, session, path, { method: 'GET', signal: requestSignal }, onSessionUpdated)
  // 普通账号分组与媒体专用授权是独立来源，日志筛选必须合并而不是漏掉其中一种。
  const [user, media] = await Promise.allSettled([request('/api/user/self/groups'), request('/api/token/media-groups')])
  if (user.status === 'rejected' && media.status === 'rejected') throw user.reason
  const groups = user.status === 'fulfilled' ? Object.keys(record(user.value)) : []
  const extras = media.status === 'fulfilled' ? record(media.value).groups : []
  if (Array.isArray(extras)) groups.push(...extras.filter((value): value is string => typeof value === 'string'))
  return [...new Set(groups.filter(value => value && value !== 'auto'))]
}
