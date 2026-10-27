import { buildApiUrl, getLockedNewApiProxyUrl, readClientDevProxyConfig, shouldUseApiProxyForBaseUrl } from './devProxy'
import { FIXED_IMAGE_MODEL_OPTIONS, getFixedImageRequestModel, isGptImageModel } from './modelPricing'
import { parseModelListPayload } from './modelList'
import { parseMediaCatalogMetadata, readMediaGroupDescriptions, record, type MediaBilling, type MediaCatalogMetadata } from './mediaCatalogPricing'

export type ModelOption = { value: string; label: string; group?: string; groupDescription?: string; ratio?: number; billing?: MediaBilling; description?: string }
export type ModelCategory = { label: string; models: ModelOption[]; description?: string; ratio?: number }
export type MediaModelCatalog = { images: ModelOption[]; videos: ModelOption[]; metadata?: MediaCatalogMetadata }

// 分类只影响菜单展示，调用时保留完整模型路由名。
export function groupMediaModels(models: ModelOption[]): ModelCategory[] {
  const categories = new Map<string, ModelOption[]>()
  for (const model of models) {
    // 分组只接受当前 Key 的后端授权目录，不能用品牌名伪装成后台分组。
    const label = model.group
    if (!label) continue
    const items = categories.get(label) ?? []
    if (!items.some(item => item.value === model.value)) items.push(model)
    categories.set(label, items)
  }
  return [...categories].map(([label, models]) => ({ label, models, ratio: models[0]?.ratio, description: models.find(model => model.groupDescription)?.groupDescription }))
}

export function parseMediaModelCatalog(payload: unknown): MediaModelCatalog {
  const names = parseModelListPayload(payload)
  const allowed = new Set(names.map(name => name.toLowerCase()))
  // 只展示已适配参数的图片模型；精确匹配实际路由，不能把受限后缀当作另一个模型放行。
  const images = FIXED_IMAGE_MODEL_OPTIONS.filter(item => allowed.has(getFixedImageRequestModel(item.value).toLowerCase()))
  const raw = payload as { data?: unknown; models?: unknown } | null
  const data = Array.isArray(payload) ? payload : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.models) ? raw.models : []
  const endpoints = new Map<string, string[]>()
  for (const entry of data) {
    if (entry && typeof entry === 'object' && typeof entry.id === 'string' && Array.isArray(entry.supported_endpoint_types)) {
      endpoints.set(entry.id, entry.supported_endpoint_types)
    }
  }
  // 后台可新增渠道前缀；实际模型 ID 必须完整保留，不能静默退回默认图片模型。
  for (const value of names) {
    if (!images.some(item => getFixedImageRequestModel(item.value).toLowerCase() === value.toLowerCase())
      && (endpoints.get(value)?.includes('image-generation') || isGptImageModel(value))) images.push({ value, label: value })
  }
  // 专用 Key 同时返回图片与视频权限，不能把图片和聊天模型混进视频选择器。
  const videos = names.filter(name => endpoints.get(name)?.includes('openai-video')
    || /^(?:sd-?\d|seedance|doubao-seedance|sora|veo|google-veo|kling|keling|wan|vidu|hailuo|minimax-video|luma|runway)(?:[\w.-]|$)/i.test(name))
    .map(value => ({ value, label: value }))
  const metadata = parseMediaCatalogMetadata(recordMetadata(payload))
  return { images, videos, ...(metadata ? { metadata } : {}) }
}

function recordMetadata(payload: unknown): unknown {
  return payload && typeof payload === 'object' ? (payload as { media_catalog?: unknown }).media_catalog : undefined
}

export async function fetchMediaModelCatalog(baseUrl: string, apiKey: string, apiProxy: boolean, signal?: AbortSignal): Promise<MediaModelCatalog> {
  const config = readClientDevProxyConfig()
  let response: Response
  let payload: unknown
  try {
    response = await fetch(buildApiUrl(baseUrl, '/models', config, shouldUseApiProxyForBaseUrl(apiProxy, baseUrl, config)), {
      headers: { Authorization: 'Bearer ' + apiKey.trim() }, cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    })
    // 响应头到达后断流也属于连接失败，不能误报成后台返回了空目录。
    payload = await response.json()
  } catch (error) {
    if (signal?.aborted) throw error
    if (error instanceof SyntaxError) throw new Error('模型列表格式不正确')
    throw new Error(error instanceof Error && error.name === 'TimeoutError' ? '模型列表读取超时，请稍后刷新' : '模型列表连接失败，请检查网络后刷新')
  }
  const body = record(payload)
  if (!response.ok || body.success === false || body.error) throw new Error(`获取模型失败（${response.status}）`)
  if (!payload || (!Array.isArray(payload) && !Array.isArray(body.data) && !Array.isArray(body.models))) throw new Error('模型列表格式不正确')
  return parseMediaModelCatalog(payload)
}


export async function fetchMediaGroupDescriptions(baseUrl: string, signal?: AbortSignal): Promise<Record<string, string>> {
  const url = new URL(baseUrl)
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '') + '/api/pricing'
  url.search = ''; url.hash = ''
  // 只补充公开说明，不发送生成 Key，也不覆盖该 Key 的授权分组和专属计费。
  const response = await fetch(getLockedNewApiProxyUrl(url.href) ?? url.href, {
    cache: 'no-store', credentials: 'omit',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || payload.success === false) throw new Error('分组说明暂时加载失败')
  return readMediaGroupDescriptions(payload)
}
