import { readRuntimeEnv } from './runtimeEnv'

export interface DevProxyConfig {
  enabled: boolean
  prefix: string
  target: string
  changeOrigin: boolean
  secure: boolean
}

const DEFAULT_PROXY_PREFIX = '/api-proxy'
export const ASSET_PROXY_PREFIX = '/asset-proxy'
const LOCKED_PROXY_TARGETS = [
  {
    baseUrl: 'https://api.zzlye.xyz/v1',
    origin: 'https://api.zzlye.xyz',
    apiPrefix: '/api-proxy/wenyun',
    newApiPrefix: '/newapi-proxy/wenyun',
    performancePrefix: '/model-performance-proxy/wenyun',
    pricingPrefix: '/model-pricing-proxy/wenyun',
  },
  {
    baseUrl: 'https://zzlye.xyz:60/v1',
    origin: 'https://zzlye.xyz:60',
    apiPrefix: '/api-proxy/wenyun',
    newApiPrefix: '/newapi-proxy/wenyun',
    performancePrefix: '/model-performance-proxy/wenyun',
    pricingPrefix: '/model-pricing-proxy/wenyun',
  },
  {
    baseUrl: 'https://1520635.xyz:3901/v1',
    origin: 'https://1520635.xyz:3901',
    apiPrefix: '/api-proxy/public',
    newApiPrefix: '/newapi-proxy/public',
    performancePrefix: '/model-performance-proxy/public',
    pricingPrefix: '/model-pricing-proxy/public',
  },
] as const

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ''

  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const url = new URL(input)
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const v1Index = pathSegments.indexOf('v1')
    const normalizedSegments = v1Index >= 0
      ? pathSegments.slice(0, v1Index + 1)
      : pathSegments.length
        ? [...pathSegments, 'v1']
        : []
    const pathname = normalizedSegments.length ? `/${normalizedSegments.join('/')}` : ''
    return `${url.origin}${pathname}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export function normalizeDevProxyConfig(input: unknown): DevProxyConfig | null {
  if (!input || typeof input !== 'object') return null

  const record = input as Record<string, unknown>
  const target = normalizeBaseUrl(typeof record.target === 'string' ? record.target : '')
  if (!target) return null

  const rawPrefix = typeof record.prefix === 'string' ? record.prefix : DEFAULT_PROXY_PREFIX
  const trimmedPrefix = rawPrefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  const prefix = trimmedPrefix ? `/${trimmedPrefix}` : DEFAULT_PROXY_PREFIX

  return {
    enabled: Boolean(record.enabled),
    prefix,
    target,
    changeOrigin: record.changeOrigin !== false,
    secure: Boolean(record.secure),
  }
}

export function getLockedApiProxyPrefix(baseUrl: string): string | null {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl).toLowerCase()
  return LOCKED_PROXY_TARGETS.find((target) => target.baseUrl.toLowerCase() === normalizedBaseUrl)?.apiPrefix ?? null
}

export function isLockedApiProxyTarget(baseUrl: string): boolean {
  return getLockedApiProxyPrefix(baseUrl) !== null
}

export function getLockedNewApiProxyPrefix(baseUrl: string): string | null {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl).toLowerCase()
  return LOCKED_PROXY_TARGETS.find((target) => target.baseUrl.toLowerCase() === normalizedBaseUrl)?.newApiPrefix ?? null
}

export function getLockedNewApiProxyUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const target = LOCKED_PROXY_TARGETS.find((item) => {
      if (item.origin.toLowerCase() === parsed.origin.toLowerCase()) return true
      // 文运裸域在服务器上给酒馆使用，图片 API 偶尔会返回裸域资源地址，必须改走同源代理。
      return item.newApiPrefix === '/newapi-proxy/wenyun' && parsed.origin.toLowerCase() === 'https://zzlye.xyz'
    })
    if (!target) return null
    // NewAPI 的刷新 Cookie 固定在 /api/user/auth，文运同源暴露该精确路径才能让浏览器自动携带 Cookie。
    if (target.newApiPrefix === '/newapi-proxy/wenyun' && parsed.pathname === '/api/user/auth/refresh') {
      return `${parsed.pathname}${parsed.search}`
    }
    return `${target.newApiPrefix}${parsed.pathname}${parsed.search}`
  } catch {
    return null
  }
}

export function getLockedNewApiPerformanceProxyUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const target = LOCKED_PROXY_TARGETS.find((item) => item.origin.toLowerCase() === parsed.origin.toLowerCase())
    if (!target) return null
    // 成功率接口需要 NewAPI 前台登录态，Docker 里用只读同源代理在服务端注入凭证。
    if (parsed.pathname !== '/api/perf-metrics/summary') return null
    return `${target.performancePrefix}${parsed.pathname}${parsed.search}`
  } catch {
    return null
  }
}

export function getLockedNewApiPricingProxyUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const target = LOCKED_PROXY_TARGETS.find((item) => item.origin.toLowerCase() === parsed.origin.toLowerCase())
    if (!target) return null
    // NewAPI 价格接口可配置为需要前台登录态，内置站点走只读代理在服务端注入凭证。
    if (parsed.pathname !== '/api/pricing') return null
    return `${target.pricingPrefix}${parsed.pathname}${parsed.search}`
  } catch {
    return null
  }
}

export function getLockedAssetProxyUrl(url: string): string {
  return getLockedNewApiProxyUrl(url) ?? getGenericAssetProxyUrl(url)
}

export function getGenericAssetProxyUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) return url
    const scheme = parsed.protocol === 'https:' ? 'https' : 'http'
    // Docker Nginx 不会在 $arg_url 校验前解码 query，因此用路径式代理避免 https%3A 被误判非法。
    return `${ASSET_PROXY_PREFIX}/${scheme}/${parsed.host}${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

export function shouldUseApiProxyForBaseUrl(
  apiProxy: boolean,
  baseUrl: string,
  proxyConfig: DevProxyConfig | null = readClientDevProxyConfig(),
): boolean {
  // 两个内置站点在 Docker 里固定走各自同源代理，避免浏览器直连非标准端口失败。
  if (getLockedApiProxyPrefix(baseUrl)) return true
  return isApiProxyAvailable(proxyConfig) && apiProxy
}

export function buildApiUrl(
  baseUrl: string,
  path: string,
  proxyConfig?: DevProxyConfig | null,
  useApiProxy = false,
): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const endpointPath = path.replace(/^\/+/, '')

  if (useApiProxy) {
    return `${getLockedApiProxyPrefix(normalizedBaseUrl) ?? proxyConfig?.prefix ?? DEFAULT_PROXY_PREFIX}/${endpointPath}`
  }

  const apiPath = normalizedBaseUrl.endsWith('/v1')
    ? endpointPath
    : ['v1', endpointPath].join('/')

  return normalizedBaseUrl ? `${normalizedBaseUrl}/${apiPath}` : `/${apiPath}`
}

export function resolveDevProxyConfig(input: unknown, isDev: boolean): DevProxyConfig | null {
  if (!isDev) return null
  return normalizeDevProxyConfig(input)
}

export function readClientDevProxyConfig(): DevProxyConfig | null {
  return resolveDevProxyConfig(
    typeof __DEV_PROXY_CONFIG__ === 'undefined' ? null : __DEV_PROXY_CONFIG__,
    import.meta.env.DEV,
  )
}

export function isApiProxyAvailable(proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return readRuntimeEnv(import.meta.env.VITE_API_PROXY_AVAILABLE) === 'true' || Boolean(proxyConfig?.enabled)
}

export function isApiProxyLocked(proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return readRuntimeEnv(import.meta.env.VITE_API_PROXY_LOCKED) === 'true' && isApiProxyAvailable(proxyConfig)
}

export function shouldUseApiProxy(apiProxy: boolean, proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return isApiProxyAvailable(proxyConfig) && (apiProxy || isApiProxyLocked(proxyConfig))
}
