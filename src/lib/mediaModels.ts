import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxyForBaseUrl } from './devProxy'
import { FIXED_IMAGE_MODEL_OPTIONS, getFixedImageRequestModel } from './modelPricing'
import { parseModelListPayload } from './modelList'

export type ModelOption = { value: string; label: string }
export type ModelCategory = { label: string; models: ModelOption[] }
export type MediaModelCatalog = { images: ModelOption[]; videos: ModelOption[] }

// 分类只影响菜单展示，调用时保留完整模型路由名。
export function groupMediaModels(models: ModelOption[]): ModelCategory[] {
  const categories = new Map<string, ModelOption[]>()
  for (const model of models) {
    const name = model.value.toLowerCase()
    const label = /^gpt-image/.test(name) ? 'GPT Image'
      : /banana/.test(name) ? '香蕉'
      : /seedream/.test(name) ? 'Seedream'
      : /^(mj|midjourney)(?:-|$)/.test(name) ? 'Midjourney'
      : /^(sd-?\d|seedance|doubao-seedance)/.test(name) ? 'Seedance'
      : /^sora/.test(name) ? 'Sora'
      : /^(veo|google-veo)/.test(name) ? 'Veo'
      : /^(kling|keling)/.test(name) ? '可灵'
      : /^wan/.test(name) ? '万相' : '其他模型'
    const items = categories.get(label) ?? []
    if (!items.some(item => item.value === model.value)) items.push(model)
    categories.set(label, items)
  }
  return [...categories].map(([label, models]) => ({ label, models }))
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
  // 专用 Key 同时返回图片与视频权限，不能把图片和聊天模型混进视频选择器。
  const videos = names.filter(name => endpoints.get(name)?.includes('openai-video')
    || /^(?:sd-?\d|seedance|doubao-seedance|sora|veo|google-veo|kling|keling|wan|vidu|hailuo|minimax-video|luma|runway)(?:[\w.-]|$)/i.test(name))
    .map(value => ({ value, label: value }))
  return { images, videos }
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
