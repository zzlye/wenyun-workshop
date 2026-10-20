import { nanoid } from 'nanoid'
import type { ApiProfile, NewApiAccountSession } from '../types'
import { requestNewApiAccountResource } from './newApiAccount'

export interface LotteryActivity {
  id: number
  name: string
  status: 'active' | 'paused' | 'ended' | 'exhausted'
  mode: 'initial_percent' | 'remaining_percent' | 'random_shares' | 'fixed'
  total_quota: number
  remaining_quota: number
  min_topup_quota: number
  topup_scope: 'lifetime' | 'period'
  topup_start: number
  topup_end: number
  per_user_limit: number
  used_draws: number
  eligible_topup_quota: number
  remaining_shares: number
  fixed_quota: number
  min_percent: number
  max_percent: number
}

export interface LotteryDraw {
  id: number
  activity_id: number
  user_id: number
  quota: number
  created_at: number
}
export interface LotteryWinner {
  id: number
  username: string
  quota: number
}
export interface LotteryPage<T> {
  items: T[]
  total: number
}
type SessionUpdated = (session: NewApiAccountSession) => void

// 主动切换活动可取消查询，网络卡住也不会无限占用请求。
function readSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(30000)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export function fetchLotteryActivities(
  profile: ApiProfile,
  session: NewApiAccountSession,
  page: number,
  signal?: AbortSignal,
  onSessionUpdated?: SessionUpdated,
) {
  return requestNewApiAccountResource<LotteryPage<LotteryActivity> & { paid_topup_quota: number }>(
    profile,
    session,
    `/api/user/lottery?p=${page}&page_size=10`,
    { signal: readSignal(signal) },
    onSessionUpdated,
  )
}

export function fetchLotteryDraws(
  profile: ApiProfile,
  session: NewApiAccountSession,
  id: number,
  page: number,
  signal?: AbortSignal,
  onSessionUpdated?: SessionUpdated,
) {
  return requestNewApiAccountResource<LotteryPage<LotteryDraw>>(
    profile,
    session,
    `/api/user/lottery/${id}/draws?p=${page}&page_size=20`,
    { signal: readSignal(signal) },
    onSessionUpdated,
  )
}

export function fetchLotteryWinners(
  profile: ApiProfile,
  session: NewApiAccountSession,
  id: number,
  signal?: AbortSignal,
  onSessionUpdated?: SessionUpdated,
) {
  return requestNewApiAccountResource<LotteryWinner[]>(
    profile,
    session,
    `/api/user/lottery/${id}/winners`,
    { signal: readSignal(signal) },
    onSessionUpdated,
  )
}

export function drawNewApiLottery(
  profile: ApiProfile,
  session: NewApiAccountSession,
  id: number,
  requestId: string,
  onSessionUpdated?: SessionUpdated,
) {
  return requestNewApiAccountResource<LotteryDraw>(
    profile,
    session,
    `/api/user/lottery/${id}/draw`,
    { method: 'POST', body: { request_id: requestId }, signal: AbortSignal.timeout(30000) },
    onSessionUpdated,
  )
}

export function lotteryParticipation(activity: LotteryActivity) {
  const remaining = Math.max(0, activity.per_user_limit - activity.used_draws)
  const qualified = activity.eligible_topup_quota >= activity.min_topup_quota
  return {
    remaining,
    qualified,
    canDraw: activity.status === 'active' && qualified && remaining > 0 && activity.remaining_quota > 0,
  }
}

export const LOTTERY_SEEN_EVENT = 'wenyun:lottery-seen'
const seenFallback = new Map<string, number[]>()
export function lotterySeenKey(site: string, account: string | number) {
  return `wenyun:lottery-seen:${encodeURIComponent(site.replace(/\/+$/, ''))}:${account}`
}
export function readSeenLotteryIds(key: string): number[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || 'null')
    if (Array.isArray(saved)) return saved.filter((id): id is number => Number.isSafeInteger(id) && id > 0)
  } catch {
    /* 存储不可用时只影响提醒的跨重启保留，不影响抽奖。 */
  }
  return seenFallback.get(key) ?? []
}
export function hasUnseenLottery(activities: LotteryActivity[], seen: number[]): boolean {
  return activities.some((item) => item.status === 'active' && !seen.includes(item.id))
}
// 查看成功加载的活动后才消除提醒；账号之间及不同站点的已读记录相互隔离。
export function markLotteriesSeen(key: string, activities: LotteryActivity[]) {
  const seen = readSeenLotteryIds(key)
  const next = [
    ...new Set([...seen, ...activities.filter((item) => item.status === 'active').map((item) => item.id)]),
  ]
  if (next.length === seen.length) return
  seenFallback.set(key, next)
  try {
    localStorage.setItem(key, JSON.stringify(next))
  } catch {
    /* 同一进程仍通过内存与事件同步红点。 */
  }
  window.dispatchEvent(new Event(LOTTERY_SEEN_EVENT))
}

// 请求编号按账号和活动持久保存；断网、刷新与重启后重试取回原结果，不再消耗一次机会。
export function lotteryRequestKey(userId: string | number, activityId: number) {
  return `wenyun:lottery-request:${userId}:${activityId}`
}
const pendingRequests = new Map<string, string>()
export function readLotteryRequest(key: string): string | null {
  try {
    return localStorage.getItem(key) || pendingRequests.get(key) || null
  } catch {
    return pendingRequests.get(key) || null
  }
}
export function ensureLotteryRequest(key: string): string {
  const id = readLotteryRequest(key) || nanoid()
  pendingRequests.set(key, id)
  try {
    localStorage.setItem(key, id)
  } catch {
    /* 存储受限时仍使用内存幂等保护。 */
  }
  return id
}
export function clearLotteryRequest(key: string) {
  pendingRequests.delete(key)
  try {
    localStorage.removeItem(key)
  } catch {
    /* 不因存储清理失败影响已经返回的奖励。 */
  }
}

// 奖池与充值门槛统一读取 NewAPI 的额度单位、展示币种和汇率，不混用支付金额。
export function formatLotteryQuota(quota: number, status: Record<string, unknown> | null): string {
  const unit = Number(status?.quota_per_unit)
  if (!status || !Number.isFinite(unit) || unit <= 0 || status.quota_display_type === 'TOKENS')
    return `${quota.toLocaleString('zh-CN')} 额度`
  const type = status.quota_display_type
  const rate = Number(
    type === 'CUSTOM' ? status.custom_currency_exchange_rate : type === 'CNY' ? status.usd_exchange_rate : 1,
  )
  const symbol = type === 'CUSTOM' ? String(status.custom_currency_symbol || '¤') : type === 'CNY' ? '¥' : '$'
  const amount = (quota / unit) * (Number.isFinite(rate) && rate > 0 ? rate : 1)
  return `${symbol} ${amount.toLocaleString('zh-CN', { maximumFractionDigits: 6 })}`
}

export function lotteryPeriod(start: number, end: number): string {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${formatter.format(start * 1000)} — ${formatter.format(end * 1000)}`
}
