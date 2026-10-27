import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxyForBaseUrl } from './devProxy'
import { FIXED_IMAGE_MODEL_OPTIONS, getFixedImageRequestModel } from './modelPricing'
import { parseModelListPayload } from './modelList'
import { parseMediaCatalogMetadata, type MediaBilling, type MediaCatalogMetadata } from './mediaCatalogPricing'

export type ModelOption = { value: string; label: string; group?: string; ratio?: number; billing?: MediaBilling; description?: string }
export type ModelCategory = { label: string; models: ModelOption[]; ratio?: number }
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
  return [...categories].map(([label, models]) => ({ label, models, ratio: models[0]?.ratio }))
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
      && (endpoints.get(value)?.includes('image-generation') || /^(?:AZ-|官-)?gpt-image-/i.test(value))) images.push({ value, label: value })
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
  const response = await fetch(buildApiUrl(baseUrl, '/models', config, shouldUseApiProxyForBaseUrl(apiProxy, baseUrl, config)), {
    headers: { Authorization: `Bearer ${apiKey.trim()}` }, cache: 'no-store', signal,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.success === false || payload?.error) throw new Error(`获取模型失败（${response.status}）`)
  if (!payload || (!Array.isArray(payload) && !Array.isArray(payload.data) && !Array.isArray(payload.models))) throw new Error('模型列表格式不正确')
  return parseMediaModelCatalog(payload)
}
