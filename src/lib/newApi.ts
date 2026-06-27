import type { ApiProfile } from '../types'
import { getFixedImageRequestModel } from './apiProfiles'
import { getLockedNewApiProxyUrl } from './devProxy'

export interface NewApiBalanceResult {
  text: string
  currency: string
  updatedAt: number
}

export interface NewApiNoticeResult {
  content: string
  updatedAt: number
  publishedAt?: string
  items: NewApiNoticeItem[]
}

export interface NewApiNoticeItem {
  id?: string | number
  content: string
  publishedAt?: string
  type?: string
}

export interface NewApiModelUnitCostResult {
  text: string
  updatedAt: number
  found?: boolean
}

export interface NewApiPriceTableItem {
  model: string
  text: string
  rawPrice: number
}

export interface NewApiPriceTableResult {
  items: NewApiPriceTableItem[]
  updatedAt: number
  found: boolean
}

export interface NewApiModelPerformanceItem {
  model: string
  avgLatencyMs: number | null
  successRate: number | null
  avgTps: number | null
  requestCount: number | null
}

export interface NewApiModelPerformanceResult {
  items: NewApiModelPerformanceItem[]
  updatedAt: number
  found: boolean
}

interface NewApiStatusInfo {
  currencySymbol: string
  quotaPerUnit: number
  raw: unknown
}

const DEFAULT_CURRENCY_SYMBOL = 'HUHN'
const DEFAULT_QUOTA_PER_UNIT = 500_000
const FALLBACK_MODEL_UNIT_COST = `${DEFAULT_CURRENCY_SYMBOL} 0.06`
const PUBLIC_FETCH_TIMEOUT_MS = 6000
const WENYUN_PUBLIC_PROXY_PREFIX = '/wy-public/wenyun'

class HttpStatusError extends Error {
  status: number

  constructor(status: number) {
    super(`请求失败：${status}`)
    this.status = status
  }
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function getApiOrigin(baseUrl: string): string {
  const normalized = trimTrailingSlash(baseUrl)
  if (!normalized) return ''

  try {
    const url = new URL(normalized)
    return url.origin
  } catch {
    return normalized.replace(/\/v1$/i, '')
  }
}

function getApiRoot(baseUrl: string): string {
  return trimTrailingSlash(baseUrl).replace(/\/v1$/i, '')
}

function withNoCacheParam(url: string): string {
  // 手动查余额必须绕过浏览器、代理和上游缓存，避免第二次点击直接复用旧响应。
  const cacheKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('_t', cacheKey)
    return parsed.toString()
  } catch {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}_t=${encodeURIComponent(cacheKey)}`
  }
}

function buildRequestHeaders(apiKey?: string, noCache = false): HeadersInit | undefined {
  const headers: Record<string, string> = {}
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`
  if (noCache) {
    headers['Cache-Control'] = 'no-cache, no-store, max-age=0'
    headers.Pragma = 'no-cache'
  }
  return Object.keys(headers).length ? headers : undefined
}

async function fetchJson(url: string, apiKey?: string, options: { noCache?: boolean } = {}): Promise<unknown> {
  const requestUrl = options.noCache ? withNoCacheParam(url) : url
  const response = await fetch(getLockedNewApiProxyUrl(requestUrl) ?? requestUrl, {
    cache: 'no-store',
    headers: buildRequestHeaders(apiKey, options.noCache),
  })
  if (!response.ok) throw new HttpStatusError(response.status)
  return response.json()
}

async function fetchJsonWithTimeout(url: string, apiKey?: string, timeoutMs = PUBLIC_FETCH_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(getLockedNewApiProxyUrl(url) ?? url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: apiKey?.trim()
        ? { Authorization: `Bearer ${apiKey.trim()}` }
        : undefined,
    })
    if (!response.ok) throw new HttpStatusError(response.status)
    return response.json()
  } finally {
    globalThis.clearTimeout(timer)
  }
}

async function fetchPublicJsonWithCorsFallback(url: string, timeoutMs = PUBLIC_FETCH_TIMEOUT_MS): Promise<unknown> {
  const sameOriginProxyUrl = getWenyunPublicProxyUrl(url)
  if (sameOriginProxyUrl) {
    try {
      return await fetchJsonWithTimeout(sameOriginProxyUrl, undefined, timeoutMs)
    } catch {
      // 同源代理在部分静态部署不可用时，继续尝试直连和公共代理。
    }
  }

  try {
    return await fetchJsonWithTimeout(url, undefined, timeoutMs)
  } catch (err) {
    const proxiedUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    try {
      return await fetchJsonWithTimeout(proxiedUrl, undefined, timeoutMs)
    } catch {
      throw err
    }
  }
}

async function fetchPublicPriceJson(url: string, apiKey?: string, timeoutMs = 2500): Promise<unknown> {
  const sameOriginProxyUrl = getWenyunPublicProxyUrl(url)
  if (sameOriginProxyUrl) return fetchJsonWithTimeout(sameOriginProxyUrl, apiKey, timeoutMs)
  return fetchPublicJsonWithCorsFallback(url, timeoutMs)
}

function getWenyunPublicProxyUrl(url: string): string | null {
  const lockedProxyUrl = getLockedNewApiProxyUrl(url)
  if (lockedProxyUrl) return lockedProxyUrl

  try {
    const parsed = new URL(url)
    if (parsed.origin !== 'https://zzlye.xyz:60') return null
    return `${WENYUN_PUBLIC_PROXY_PREFIX}${parsed.pathname}${parsed.search}`
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    const numeric = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(numeric)) return numeric
  }
  return null
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function getPayloadData(payload: unknown): unknown {
  return isRecord(payload) && 'data' in payload ? payload.data : payload
}

function normalizeLookupKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findValueByNormalizedKeys(input: unknown, keys: string[], depth = 0): unknown {
  if (depth > 5 || !input || typeof input !== 'object') return undefined
  const normalizedKeys = new Set(keys.map(normalizeLookupKey))

  if (Array.isArray(input)) {
    for (const item of input) {
      const found = findValueByNormalizedKeys(item, keys, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (normalizedKeys.has(normalizeLookupKey(key))) return value
  }

  for (const value of Object.values(input as Record<string, unknown>)) {
    const found = findValueByNormalizedKeys(value, keys, depth + 1)
    if (found !== undefined) return found
  }

  return undefined
}

function parseJsonLike(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value
  try {
    return JSON.parse(text)
  } catch {
    return value
  }
}

function formatAmount(value: number): string {
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function formatCurrency(value: number, currencySymbol: string): string {
  const amount = formatAmount(value)
  return /^[A-Za-z]{2,}$/.test(currencySymbol) ? `${currencySymbol} ${amount}` : `${currencySymbol}${amount}`
}

function getCurrencySymbolFromCode(code: string | null): string {
  const normalized = code?.trim().toUpperCase()
  if (!normalized) return DEFAULT_CURRENCY_SYMBOL
  if (normalized === 'USD') return '$'
  if (normalized === 'CNY' || normalized === 'RMB' || normalized === 'CNH') return '¥'
  if (normalized === 'EUR') return '€'
  if (normalized === 'GBP') return '£'
  if (normalized === 'JPY') return '¥'
  return code?.trim() || DEFAULT_CURRENCY_SYMBOL
}

function parseNewApiStatus(payload: unknown): NewApiStatusInfo {
  const data = getPayloadData(payload)
  const currencyKeys = [
    'custom_currency_symbol',
    'customCurrencySymbol',
    'CustomCurrencySymbol',
    'currency_symbol',
    'currencySymbol',
    'display_currency_symbol',
    'DisplayCurrencySymbol',
    'currency',
    'display_currency',
    'DisplayCurrency',
  ]
  const currencyValue = currencyKeys
    .map((key) => findValueByNormalizedKeys(data, [key]))
    .find((value) => typeof value === 'string' && value.trim())
  const currencyText = typeof currencyValue === 'string' ? currencyValue.trim() : ''
  const quotaPerUnitValue = findValueByNormalizedKeys(data, ['quota_per_unit', 'QuotaPerUnit'])
  const quotaPerUnit = typeof quotaPerUnitValue === 'number'
    ? quotaPerUnitValue
    : Number(quotaPerUnitValue)
  const currencySymbol = currencyText.length <= 8 && currencyText
    ? getCurrencySymbolFromCode(currencyText)
    : DEFAULT_CURRENCY_SYMBOL

  return {
    currencySymbol,
    quotaPerUnit: Number.isFinite(quotaPerUnit) && quotaPerUnit > 0 ? quotaPerUnit : DEFAULT_QUOTA_PER_UNIT,
    raw: data,
  }
}

async function fetchNewApiStatus(apiRoot: string, origin: string): Promise<NewApiStatusInfo> {
  const attempts = [`${origin}/api/status`, `${apiRoot}/api/status`, `${origin}/status`]
  let lastError: unknown = null
  for (const url of attempts) {
    try {
      return parseNewApiStatus(await fetchPublicJsonWithCorsFallback(url))
    } catch (err) {
      lastError = err
    }
  }
  if (lastError) console.warn('Failed to load NewAPI status:', lastError)
  return {
    currencySymbol: DEFAULT_CURRENCY_SYMBOL,
    quotaPerUnit: DEFAULT_QUOTA_PER_UNIT,
    raw: null,
  }
}

function quotaToCurrency(value: number, status: NewApiStatusInfo): number {
  return value / status.quotaPerUnit
}

function formatQuotaCurrency(value: number, status: NewApiStatusInfo): string {
  return formatCurrency(quotaToCurrency(value, status), status.currencySymbol)
}

function parseSubscriptionBalance(subscription: unknown, usage: unknown, status: NewApiStatusInfo): string | null {
  if (!isRecord(subscription)) return null
  const limit = readNumber(subscription, ['hard_limit_usd', 'system_hard_limit_usd', 'soft_limit_usd'])
  const usedCents = isRecord(usage) ? readNumber(usage, ['total_usage']) : null

  if (limit == null && usedCents == null) return null
  if (limit != null && usedCents != null) {
    const used = usedCents / 100
    return `可用 ${formatCurrency(Math.max(0, limit - used), status.currencySymbol)} / 总额 ${formatCurrency(limit, status.currencySymbol)}`
  }
  if (limit != null) return `总额 ${formatCurrency(limit, status.currencySymbol)}`
  return `已用 ${formatCurrency((usedCents ?? 0) / 100, status.currencySymbol)}`
}

function parseCreditGrantBalance(payload: unknown, status: NewApiStatusInfo): string | null {
  if (!isRecord(payload)) return null
  const available = readNumber(payload, ['total_available', 'available'])
  const granted = readNumber(payload, ['total_granted', 'granted'])
  const used = readNumber(payload, ['total_used', 'used'])
  if (available != null && granted != null) return `可用 ${formatCurrency(available, status.currencySymbol)} / 总额 ${formatCurrency(granted, status.currencySymbol)}`
  if (available != null) return `可用 ${formatCurrency(available, status.currencySymbol)}`
  if (granted != null && used != null) return `可用 ${formatCurrency(Math.max(0, granted - used), status.currencySymbol)} / 总额 ${formatCurrency(granted, status.currencySymbol)}`
  return null
}

function parseUserBalance(payload: unknown, status: NewApiStatusInfo): string | null {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload
  if (!isRecord(data)) return null
  const quota = readNumber(data, ['quota', 'remain_quota', 'remainQuota', 'balance'])
  const usedQuota = readNumber(data, ['used_quota'])
  if (quota != null && usedQuota != null) return `可用 ${formatQuotaCurrency(quota, status)} / 已用 ${formatQuotaCurrency(usedQuota, status)}`
  if (quota != null) return `可用 ${formatQuotaCurrency(quota, status)}`
  return null
}

export async function queryNewApiBalance(profile: ApiProfile): Promise<NewApiBalanceResult> {
  const apiRoot = getApiRoot(profile.baseUrl)
  const origin = getApiOrigin(profile.baseUrl)
  if (!apiRoot || !origin) throw new Error('API URL 无效')
  if (!profile.apiKey.trim()) throw new Error('请先填写 API Key')
  const status = await fetchNewApiStatus(apiRoot, origin)

  const attempts: Array<() => Promise<string | null>> = [
    async () => parseUserBalance(await fetchJson(`${origin}/api/user/self`, profile.apiKey, { noCache: true }), status),
    async () => {
      const [subscription, usage] = await Promise.all([
        fetchJson(`${apiRoot}/dashboard/billing/subscription`, profile.apiKey, { noCache: true }),
        fetchJson(`${apiRoot}/dashboard/billing/usage`, profile.apiKey, { noCache: true }),
      ])
      return parseSubscriptionBalance(subscription, usage, status)
    },
    async () => parseCreditGrantBalance(await fetchJson(`${apiRoot}/dashboard/billing/credit_grants`, profile.apiKey, { noCache: true }), status),
  ]

  let lastError: unknown = null
  for (const attempt of attempts) {
    try {
      const text = await attempt()
      if (text) return { text, currency: status.currencySymbol, updatedAt: Date.now() }
    } catch (err) {
      lastError = err
    }
  }

  throw new Error(lastError instanceof Error ? lastError.message : '余额查询失败')
}

function getNoticeItemText(input: unknown): string {
  if (typeof input === 'string') return input.trim()
  if (!isRecord(input)) return ''
  const title = readString(input, ['title', 'name', 'subject']) ?? ''
  const content = readString(input, ['content', 'message', 'text', 'description', 'body']) ?? ''
  const parts = [
    title ? `### ${title}` : '',
    content,
  ].filter(Boolean)
  return parts.join('\n\n').trim()
}

function getNoticeItemDate(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  return readString(input, ['publishDate', 'published_at', 'publishedAt', 'created_at', 'createdAt', 'updated_at', 'updatedAt', 'time', 'date']) ?? undefined
}

function getNoticeItemId(input: unknown): string | number | undefined {
  if (!isRecord(input)) return undefined
  const id = input.id ?? input.notice_id ?? input.noticeId
  return typeof id === 'string' || typeof id === 'number' ? id : undefined
}

function getNoticeItemType(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  return readString(input, ['type', 'status', 'level']) ?? undefined
}

function toNoticeItem(input: unknown): NewApiNoticeItem | null {
  const content = getNoticeItemText(input)
  if (!content) return null
  return {
    id: getNoticeItemId(input),
    content,
    publishedAt: getNoticeItemDate(input),
    type: getNoticeItemType(input),
  }
}

function findNoticeArray(input: unknown, depth = 0): unknown[] | null {
  if (depth > 5 || !input || typeof input !== 'object') return null
  if (Array.isArray(input)) return input

  const record = input as Record<string, unknown>
  for (const key of ['announcements', 'notices', 'notice', 'items', 'list']) {
    const value = record[key]
    if (Array.isArray(value)) return value
  }

  for (const value of Object.values(record)) {
    const found = findNoticeArray(value, depth + 1)
    if (found) return found
  }

  return null
}

function sortNoticeItems(items: NewApiNoticeItem[]) {
  return [...items].sort((a, b) => {
    const left = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
    const right = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0)
  })
}

function parseNoticePayload(payload: unknown): NewApiNoticeResult {
  const updatedAt = Date.now()
  if (typeof payload === 'string') {
    const content = payload.trim()
    return { content, updatedAt, items: content ? [{ content }] : [] }
  }
  const data = isRecord(payload) && 'data' in payload ? payload.data : payload
  const noticeArray = findNoticeArray(data)
  if (noticeArray) {
    const items = sortNoticeItems(noticeArray.map(toNoticeItem).filter((item): item is NewApiNoticeItem => Boolean(item))).slice(0, 20)
    return {
      content: items.map((item) => item.content).join('\n\n---\n\n'),
      updatedAt,
      publishedAt: items.map((item) => item.publishedAt).find(Boolean),
      items,
    }
  }
  if (typeof data === 'string') {
    const content = data.trim()
    return { content, updatedAt, items: content ? [{ content }] : [] }
  }
  if (!isRecord(data)) return { content: '', updatedAt, items: [] }

  for (const key of ['notices', 'notice', 'content', 'message', 'announcement', 'announcements', 'items', 'list']) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) {
      const item = toNoticeItem({ ...data, content: value.trim() })
      return { content: value.trim(), updatedAt, publishedAt: item?.publishedAt, items: item ? [item] : [{ content: value.trim() }] }
    }
    if (isRecord(value)) {
      const nested = parseNoticePayload(value)
      if (nested.content) return nested
    }
  }

  const item = toNoticeItem(data)
  return {
    content: item?.content ?? '',
    updatedAt,
    publishedAt: item?.publishedAt,
    items: item ? [item] : [],
  }
}

export async function fetchNewApiNotice(baseUrl: string): Promise<NewApiNoticeResult> {
  const origin = getApiOrigin(baseUrl)
  if (!origin) throw new Error('API URL 无效')
  const statusUrl = new URL(`${origin}/api/status`)
  // 公告需要跟随后台实时变化，增加时间戳避免反代或浏览器复用旧状态响应。
  statusUrl.searchParams.set('_t', String(Date.now()))
  const notice = parseNoticePayload(await fetchPublicJsonWithCorsFallback(statusUrl.toString(), 5000))
  if (notice.content || notice.items.length > 0) return notice
  return {
    content: '',
    updatedAt: Date.now(),
    items: [],
  }
}

function findModelPricePayload(input: unknown, depth = 0): unknown {
  if (depth > 5 || !input || typeof input !== 'object') return undefined

  if (Array.isArray(input)) {
    for (const item of input) {
      const found = findModelPricePayload(item, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalized = normalizeLookupKey(key)
    if (normalized === 'modelprice' || normalized === 'modelprices') return parseJsonLike(value)
  }

  for (const value of Object.values(input as Record<string, unknown>)) {
    const found = findModelPricePayload(parseJsonLike(value), depth + 1)
    if (found !== undefined) return found
  }

  return undefined
}

function readModelPriceValue(input: unknown, model: string): number | null {
  const payload = parseJsonLike(input)
  const modelKey = model.trim().toLowerCase()
  if (!modelKey) return null

  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (!isRecord(item)) continue
      const itemModel = readString(item, ['model', 'model_name', 'name', 'id'])?.toLowerCase()
      if (itemModel !== modelKey) continue
      const price = readNumber(item, ['model_price', 'modelPrice', 'price', 'cost', 'quota', 'value'])
      if (price != null) return price
    }
    return null
  }

  if (!isRecord(payload)) return null
  for (const [key, value] of Object.entries(payload)) {
    if (key.toLowerCase() !== modelKey) continue
    if (typeof value === 'number') return value
    if (typeof value === 'string') {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) return numeric
    }
    if (isRecord(value)) {
      const price = readNumber(value, ['model_price', 'modelPrice', 'price', 'cost', 'quota', 'value'])
      if (price != null) return price
    }
  }

  return null
}

function formatModelUnitCost(value: number, status: NewApiStatusInfo): string {
  const amount = value > 1000 ? quotaToCurrency(value, status) : value
  return formatCurrency(amount, status.currencySymbol)
}

function readModelUnitCostFromPayload(payload: unknown, model: string): number | null {
  return readModelPriceValue(findModelPricePayload(payload), model)
    ?? readModelPriceValue(getPayloadData(payload), model)
}

function collectModelPriceValues(input: unknown): Array<{ model: string; price: number }> {
  const payload = parseJsonLike(input)
  const items: Array<{ model: string; price: number }> = []

  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (!isRecord(item)) continue
      const model = readString(item, ['model', 'model_name', 'name', 'id'])
      const price = readNumber(item, ['model_price', 'modelPrice', 'price', 'cost', 'quota', 'value'])
      if (model && price != null) items.push({ model, price })
    }
    return items
  }

  if (!isRecord(payload)) return items

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'number') {
      items.push({ model: key, price: value })
      continue
    }
    if (typeof value === 'string') {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) items.push({ model: key, price: numeric })
      continue
    }
    if (isRecord(value)) {
      const model = readString(value, ['model', 'model_name', 'name', 'id']) || key
      const price = readNumber(value, ['model_price', 'modelPrice', 'price', 'cost', 'quota', 'value'])
      if (model && price != null) items.push({ model, price })
    }
  }

  return items
}

function collectModelPricesFromPayload(payload: unknown, allowDirectPayload: boolean): Array<{ model: string; price: number }> {
  const nested = collectModelPriceValues(findModelPricePayload(payload))
  if (nested.length) return nested
  return allowDirectPayload ? collectModelPriceValues(getPayloadData(payload)) : []
}

function findPerformanceArray(input: unknown, depth = 0): unknown[] | null {
  if (depth > 5 || !input || typeof input !== 'object') return null
  if (Array.isArray(input)) return input

  const record = input as Record<string, unknown>
  for (const key of ['models', 'items', 'list', 'data']) {
    const value = record[key]
    if (Array.isArray(value)) return value
  }

  for (const value of Object.values(record)) {
    const found = findPerformanceArray(value, depth + 1)
    if (found) return found
  }

  return null
}

function toModelPerformanceItem(input: unknown): NewApiModelPerformanceItem | null {
  if (!isRecord(input)) return null
  const model = readString(input, ['model_name', 'modelName', 'model', 'name', 'id'])
  if (!model) return null

  return {
    model,
    avgLatencyMs: readNumber(input, ['avg_latency_ms', 'avgLatencyMs', 'latency_ms', 'latencyMs', 'latency']),
    successRate: readNumber(input, ['success_rate', 'successRate', 'uptime_pct', 'uptimePct', 'uptime']),
    avgTps: readNumber(input, ['avg_tps', 'avgTps', 'tps', 'throughput']),
    requestCount: readNumber(input, ['request_count', 'requestCount', 'requests', 'count']),
  }
}

function parseModelPerformancePayload(payload: unknown): NewApiModelPerformanceItem[] {
  const data = getPayloadData(payload)
  const source = findPerformanceArray(data) ?? findPerformanceArray(payload) ?? []
  const items = source
    .map(toModelPerformanceItem)
    .filter((item): item is NewApiModelPerformanceItem => Boolean(item))
  const uniqueItems = new Map<string, NewApiModelPerformanceItem>()
  for (const item of items) {
    const key = item.model.trim().toLowerCase()
    if (!key) continue
    uniqueItems.set(key, item)
  }
  return Array.from(uniqueItems.values())
}

function getNewApiModelPerformanceUrls(origin: string, apiRoot: string, safeHours: number): string[] {
  return Array.from(new Set([
    `${origin}/api/perf-metrics/summary?hours=${safeHours}`,
    `${apiRoot}/api/perf-metrics/summary?hours=${safeHours}`,
  ]))
}

function isNewApiAccessTokenFailure(error: unknown): boolean {
  if (isAuthOrRateLimitFailure(error)) return true
  if (!(error instanceof Error)) return false
  return /access token|未登录|not logged in|unauthorized|401/i.test(error.message)
}

function getPublicPriceUrls(origin: string, apiRoot: string): string[] {
  return Array.from(new Set([
    `${origin}/api/pricing`,
    `${apiRoot}/api/pricing`,
    `${origin}/api/ratio_config`,
    `${apiRoot}/api/ratio_config`,
  ]))
}

function isAuthOrRateLimitFailure(error: unknown): boolean {
  return error instanceof HttpStatusError && (error.status === 401 || error.status === 403 || error.status === 429)
}

export async function queryNewApiModelUnitCost(profile: ApiProfile): Promise<NewApiModelUnitCostResult> {
  const apiRoot = getApiRoot(profile.baseUrl)
  const origin = getApiOrigin(profile.baseUrl)
  if (!apiRoot || !origin) return { text: FALLBACK_MODEL_UNIT_COST, updatedAt: Date.now(), found: false }

  try {
    const status = await fetchNewApiStatus(apiRoot, origin)
    const requestModel = getFixedImageRequestModel(profile.model)
    let price = readModelUnitCostFromPayload(status.raw, requestModel)
      ?? readModelUnitCostFromPayload(status.raw, profile.model)

    if (profile.apiKey.trim()) {
      for (const url of getPublicPriceUrls(origin, apiRoot)) {
        try {
          const payload = await fetchPublicPriceJson(url, profile.apiKey)
          const nextPrice = readModelUnitCostFromPayload(payload, requestModel)
            ?? readModelUnitCostFromPayload(payload, profile.model)
          if (nextPrice != null) {
            price = nextPrice
            break
          }
        } catch (err) {
          // 文运站未登录或限流时不要继续打备用公开接口，避免控制台刷 401/429。
          if (isAuthOrRateLimitFailure(err)) break
        }
      }
    }

    return {
      text: price == null ? FALLBACK_MODEL_UNIT_COST : formatModelUnitCost(price, status),
      updatedAt: Date.now(),
      found: price != null,
    }
  } catch {
    return { text: FALLBACK_MODEL_UNIT_COST, updatedAt: Date.now(), found: false }
  }
}

export async function queryNewApiPriceTable(profile: ApiProfile): Promise<NewApiPriceTableResult> {
  const apiRoot = getApiRoot(profile.baseUrl)
  const origin = getApiOrigin(profile.baseUrl)
  if (!apiRoot || !origin) return { items: [], updatedAt: Date.now(), found: false }

  try {
    const status = await fetchNewApiStatus(apiRoot, origin)
    const entries = new Map<string, { model: string; price: number }>()
    const addEntries = (items: Array<{ model: string; price: number }>) => {
      for (const item of items) {
        const key = item.model.trim().toLowerCase()
        if (!key) continue
        entries.set(key, item)
      }
    }

    addEntries(collectModelPricesFromPayload(status.raw, false))

    if (profile.apiKey.trim()) {
      for (const url of getPublicPriceUrls(origin, apiRoot)) {
        try {
          const fetchedEntries = collectModelPricesFromPayload(await fetchPublicPriceJson(url, profile.apiKey), true)
          addEntries(fetchedEntries)
          if (fetchedEntries.length > 0) break
        } catch (err) {
          // NewAPI 文档里 pricing/ratio_config 是价格来源，但当前文运站会对未授权或限流请求返回 401/429。
          if (isAuthOrRateLimitFailure(err)) break
        }
      }
    }

    return {
      items: Array.from(entries.values())
        .map((item) => ({
          model: item.model,
          rawPrice: item.price,
          text: formatModelUnitCost(item.price, status),
        }))
        .sort((a, b) => a.model.localeCompare(b.model)),
      updatedAt: Date.now(),
      found: entries.size > 0,
    }
  } catch {
    return { items: [], updatedAt: Date.now(), found: false }
  }
}

export async function queryNewApiModelPerformance(profile: ApiProfile, hours = 24): Promise<NewApiModelPerformanceResult> {
  const apiRoot = getApiRoot(profile.baseUrl)
  const origin = getApiOrigin(profile.baseUrl)
  if (!apiRoot || !origin) throw new Error('API URL 无效')

  const safeHours = Number.isFinite(hours) && hours > 0 ? Math.min(Math.max(Math.round(hours), 1), 720) : 24
  let lastError: unknown = null

  for (const url of getNewApiModelPerformanceUrls(origin, apiRoot, safeHours)) {
    try {
      // 成功率是实时运营数据，强制绕过缓存，避免连续点击看到旧结果。
      // NewAPI 模型广场性能接口走前台公开访问，不使用 API Key，避免被识别成无效 access token。
      const payload = await fetchJson(url, undefined, { noCache: true })
      if (isRecord(payload) && payload.success === false) {
        throw new Error(readString(payload, ['message', 'msg', 'error', 'detail']) ?? '成功率检测失败')
      }
      const items = parseModelPerformancePayload(payload)
      return {
        items,
        updatedAt: Date.now(),
        found: items.length > 0,
      }
    } catch (err) {
      lastError = err
    }
  }

  if (isNewApiAccessTokenFailure(lastError)) {
    return { items: [], updatedAt: Date.now(), found: false }
  }

  throw new Error(lastError instanceof Error ? lastError.message : '成功率检测失败')
}
