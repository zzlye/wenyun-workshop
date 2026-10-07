import type { ApiProfile, NewApiAccountSession } from '../types'
import { getLockedNewApiProxyUrl } from './devProxy'
import { fetchNewApiAccountModelCatalog } from './newApiAccount'
import { VIDEO_ACCOUNT_GROUP } from './videoAccount'

type RecordValue = Record<string, unknown>
export interface VideoCatalogData {
  pricing: unknown
  performance: unknown
  status: unknown
  errors: string[]
  updatedAt: number
}
export interface VideoCatalogRow {
  model: string
  description: string
  priceText: string
  priceNote: string
  successRate: number | null
}
function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
}
function data(value: unknown): unknown {
  const object = record(value)
  return 'data' in object ? object.data : value
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function numeric(value: unknown): number | null {
  // 空值、布尔值不参与数字转换，避免把暂无价格或成功率误显示成零。
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
function entries(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.map(record) : []
}
function videoGroupEnabled(item: RecordValue): boolean {
  return Array.isArray(item.enable_groups) && (item.enable_groups.includes(VIDEO_ACCOUNT_GROUP) || item.enable_groups.includes('all'))
}

function formatPrice(amount: number, rawStatus: unknown): string {
  const status = record(data(rawStatus))
  const mode = text(status.quota_display_type)
  let symbol = 'USD'
  let exchange = 1
  if (mode === 'CUSTOM' && text(status.custom_currency_symbol) && (numeric(status.custom_currency_exchange_rate) ?? 0) > 0) {
    symbol = text(status.custom_currency_symbol)
    exchange = numeric(status.custom_currency_exchange_rate)!
  } else if (mode === 'CNY' && (numeric(status.usd_exchange_rate) ?? 0) > 0) {
    symbol = '¥'
    exchange = numeric(status.usd_exchange_rate)!
  }
  // model_price 已经是金额，不根据数值大小把它猜成内部额度。
  const converted = amount * exchange
  if (!Number.isFinite(converted)) return '暂无价格'
  return `${symbol} ${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 8 }).format(converted)}`
}

export function buildVideoCatalogRows(catalog: VideoCatalogData, allowedModels?: string[]): VideoCatalogRow[] {
  const prices = entries(data(catalog.pricing))
  const priceMap = new Map(prices.map(item => [text(item.model_name), item]))
  const metricMap = new Map(entries(record(data(catalog.performance)).models).map(item => [text(item.model_name), item]))
  const groupRatio = numeric(record(record(catalog.pricing).group_ratio)[VIDEO_ACCOUNT_GROUP])
  // 登录后以视频令牌的模型权限为准；未登录时只浏览接口明确公开给视频组的目录。
  const names = allowedModels ?? prices.filter(videoGroupEnabled).map(item => text(item.model_name))
  return [...new Set(names.map(name => name.trim()).filter(Boolean))].filter(name => {
    const price = priceMap.get(name)
    return !price || !Array.isArray(price.enable_groups) || videoGroupEnabled(price)
  }).sort((a, b) => a.localeCompare(b)).map(model => {
    const item = priceMap.get(model) ?? {}
    const metric = metricMap.get(model) ?? {}
    let successRate = numeric(metric.success_rate)
    if (successRate !== null && (successRate < 0 || successRate > 100 || numeric(metric.request_count) === 0)) successRate = null
    const mode = text(item.billing_mode).replace('per-second', 'per_second')
    const price = numeric(item.model_price)
    let priceText = '暂无价格'
    let priceNote = ''
    if (mode === 'tiered_expr' || entries(item.billing_plugin_variants).length) {
      // 不在浏览器执行服务端计费表达式，复杂条件价不能伪装成固定单价。
      priceText = '按参数计费'
    } else if (mode && !['ratio', 'per_second'].includes(mode)) {
      // 新计费模式应由接口明确约定，不能默认猜成按次收费。
      priceText = '按参数计费'
    } else if (numeric(item.quota_type) === 0) {
      priceText = '按用量计费'
    } else if (numeric(item.quota_type) === 1 && price !== null && price >= 0 && groupRatio !== null && groupRatio >= 0) {
      const amount = formatPrice(price * groupRatio, catalog.status)
      priceText = amount === '暂无价格' ? amount : `${amount} / ${mode === 'per_second' ? '秒' : '次'}`
      if (mode === 'per_second' && text(item.billing_expr)) priceNote = '基准价，随生成参数变化'
    }
    return { model, description: text(item.description) || '暂无简介', priceText, priceNote, successRate }
  })
}

async function readPublicCatalogResource(profile: ApiProfile, path: string, signal: AbortSignal): Promise<unknown> {
  const url = `${profile.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}${path}`
  const response = await fetch(getLockedNewApiProxyUrl(url) ?? url, { cache: 'no-store', credentials: 'omit', signal })
  const payload: unknown = await response.json()
  if (!response.ok || record(payload).success === false) throw new Error(`目录查询失败：${response.status}`)
  return payload
}

function abortable<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
  // 账号会话刷新是共用请求，不取消其他调用方，但本次目录查询仍须按时结束。
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('请求已取消或超时', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export async function fetchVideoModelCatalog(profile: ApiProfile, session?: NewApiAccountSession, signal?: AbortSignal): Promise<VideoCatalogData> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(abort, 10_000)
  try {
    const read = (resource: 'pricing' | 'performance') => session
      ? fetchNewApiAccountModelCatalog(profile, session, resource, controller.signal)
      : readPublicCatalogResource(profile, resource === 'pricing' ? '/api/pricing' : '/api/perf-metrics/summary?hours=24', controller.signal)
    const [pricing, performance, status] = await Promise.allSettled([
      abortable(read('pricing'), controller.signal), abortable(read('performance'), controller.signal),
      abortable(readPublicCatalogResource(profile, '/api/status', controller.signal), controller.signal),
    ])
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError')
    const errors: string[] = []
    if (pricing.status === 'rejected') errors.push('简介与价格暂未获取，请稍后刷新')
    if (performance.status === 'rejected') errors.push('成功率暂未获取，请稍后刷新')
    return {
      pricing: pricing.status === 'fulfilled' ? pricing.value : null,
      performance: performance.status === 'fulfilled' ? performance.value : null,
      status: status.status === 'fulfilled' ? status.value : null,
      errors, updatedAt: Date.now(),
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
