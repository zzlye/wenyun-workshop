import type { ApiProfile, NewApiAccountSession } from '../types'
import { getLockedNewApiProxyUrl } from './devProxy'
import { fetchNewApiAccountModelCatalog } from './newApiAccount'
import { VIDEO_ACCOUNT_GROUP } from './videoAccount'

type RecordValue = Record<string, unknown>
export interface VideoCatalogData {
  pricing: unknown
  pricingSource: 'account' | 'public' | null
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
  priceTiers: { label: string; priceText: string }[]
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

function readResolutionPrices(expression: string): { label: string; price: number }[] | null {
  // 只读取分辨率等值条件和非负数字字面量，不执行服务端表达式或猜测其他参数。
  const number = String.raw`(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`
  const branch = new RegExp(String.raw`^param\s*\(\s*"resolution"\s*\)\s*==\s*"([A-Za-z0-9][A-Za-z0-9_.-]{0,63})"\s*\?\s*(${number})\s*:\s*`)
  const prices = new Map<string, number>()
  let rest = expression.trim()
  // 限制展示解析长度和档位数量，异常配置不会阻塞整个模型目录。
  if (!rest || rest.length > 16_384) return null
  let match = rest.match(branch)
  while (match) {
    const price = Number(match[2])
    if (prices.has(match[1]) || !Number.isFinite(price) || prices.size >= 64) return null
    prices.set(match[1], price)
    rest = rest.slice(match[0].length).trim()
    match = rest.match(branch)
  }
  if (!prices.size || !new RegExp(`^${number}$`).test(rest) || !Number.isFinite(Number(rest))) return null
  const standard = ['480p', '720p', '1080p']
  // 与 NewAPI 分辨率编辑器的保存约定一致：完整三档模板的末尾是 480p 价格。
  // 自定义或不完整条件链仅展示明确档位，不把兜底价擅自标成其他分辨率。
  if (prices.has('720p') && prices.has('1080p') && [...prices.keys()].every(key => standard.includes(key))) {
    if (!prices.has('480p')) prices.set('480p', Number(rest))
    return standard.map(label => ({ label, price: prices.get(label)! }))
  }
  return [...prices].map(([label, price]) => ({ label, price }))
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
    const expression = text(item.billing_expr)
    let priceText = '暂无价格'
    let priceNote = ''
    let priceTiers: VideoCatalogRow['priceTiers'] = []
    if (mode === 'tiered_expr' || entries(item.billing_plugin_variants).length) {
      // 不在浏览器执行服务端计费表达式，复杂条件价不能伪装成固定单价。
      priceText = '按参数计费'
    } else if (mode && !['ratio', 'per_second', 'per_request'].includes(mode)) {
      // 新计费模式应由接口明确约定，不能默认猜成按次收费。
      priceText = '按参数计费'
    } else if (numeric(item.quota_type) === 0) {
      priceText = '按用量计费'
    } else if (numeric(item.quota_type) === 1) {
      const unit = mode === 'per_second' ? '秒' : '次'
      if (expression) {
        const tiers = ['per_second', 'per_request'].includes(mode) ? readResolutionPrices(expression) : null
        // 可识别的分辨率规则逐档展示；其他旧式按秒表达式继续显示基础价。
        if (tiers && groupRatio !== null && groupRatio >= 0) {
          const converted = tiers.map(tier => ({ label: tier.label, amount: formatPrice(tier.price * groupRatio, catalog.status) }))
          if (converted.every(tier => tier.amount !== '暂无价格')) {
            priceText = '按分辨率计费'
            priceTiers = converted.map(tier => ({ label: tier.label, priceText: `${tier.amount} / ${unit}` }))
          } else priceText = '暂无价格'
        } else if (tiers) priceText = '暂无价格'
        else if (!/\bparam\s*\(/.test(expression) && price !== null && price >= 0 && groupRatio !== null && groupRatio >= 0) {
          const amount = formatPrice(price * groupRatio, catalog.status)
          priceText = amount === '暂无价格' ? amount : `${amount} / ${unit}`
          if (mode === 'per_second') priceNote = '基准价，随生成参数变化'
        } else priceText = '按参数计费'
      } else if (price !== null && price >= 0 && groupRatio !== null && groupRatio >= 0) {
        const amount = formatPrice(price * groupRatio, catalog.status)
        priceText = amount === '暂无价格' ? amount : `${amount} / ${unit}`
      }
    }
    return { model, description: text(item.description) || '暂无简介', priceText, priceNote, priceTiers, successRate }
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
    const read = async (resource: 'pricing' | 'performance') => {
      if (session) {
        try {
          const payload = await fetchNewApiAccountModelCatalog(profile, session, resource, controller.signal)
          return { payload, source: 'account' as const }
        } catch (error) {
          if (controller.signal.aborted) throw error
          // 会话失效不影响公开目录；匿名重读不携带凭据，也不借用其他账号的报价。
        }
      }
      const path = resource === 'pricing' ? '/api/pricing' : '/api/perf-metrics/summary?hours=24'
      const payload = await readPublicCatalogResource(profile, path, controller.signal)
      return { payload, source: 'public' as const }
    }
    const [pricing, performance, status] = await Promise.allSettled([
      abortable(read('pricing'), controller.signal), abortable(read('performance'), controller.signal),
      abortable(readPublicCatalogResource(profile, '/api/status', controller.signal), controller.signal),
    ])
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError')
    const errors: string[] = []
    if (pricing.status === 'rejected') errors.push('简介与价格暂未获取，请稍后刷新')
    if (performance.status === 'rejected') errors.push('成功率暂未获取，请稍后刷新')
    return {
      pricing: pricing.status === 'fulfilled' ? pricing.value.payload : null,
      pricingSource: pricing.status === 'fulfilled' ? pricing.value.source : null,
      performance: performance.status === 'fulfilled' ? performance.value.payload : null,
      status: status.status === 'fulfilled' ? status.value : null,
      errors, updatedAt: Date.now(),
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
