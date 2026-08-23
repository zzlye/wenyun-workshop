export const DEFAULT_IMAGES_MODEL = 'gpt-image-2'
export const GPT_IMAGE_2_4K_MODEL = 'gpt-image-2-4k'
export const GPT_IMAGE_2_4K_REQUEST_MODEL = 'gpt-image-2-4k'
export const GPT_IMAGE_2_VIP_MODEL = GPT_IMAGE_2_4K_MODEL
export const GPT_IMAGE_2_SUPER_MODEL = GPT_IMAGE_2_4K_MODEL
export const GPT_IMAGE_2_VIP_REQUEST_MODEL = GPT_IMAGE_2_4K_REQUEST_MODEL
export const GPT_IMAGE_2_SUPER_REQUEST_MODEL = GPT_IMAGE_2_4K_REQUEST_MODEL

export type FixedImageModelPricing = {
  model: string
  label: string
  requestModel: string
  unitCostText: string
  resolutionText: string
}

export type ModelPriceRow = {
  model: string
  upstreamModel?: string
  priceText: string
  resolutionText?: string
}

// 图片模型价格统一放这里，模型列表和发送按钮都会读取这份配置。
export const FIXED_IMAGE_MODEL_PRICING: FixedImageModelPricing[] = [
  { model: DEFAULT_IMAGES_MODEL, label: DEFAULT_IMAGES_MODEL, requestModel: DEFAULT_IMAGES_MODEL, unitCostText: 'HUHN 0.06', resolutionText: '1K' },
  { model: GPT_IMAGE_2_4K_MODEL, label: GPT_IMAGE_2_4K_MODEL, requestModel: GPT_IMAGE_2_4K_REQUEST_MODEL, unitCostText: 'HUHN 0.09', resolutionText: '1K、2K、4K' },
  { model: 'Nano-Banana-2', label: 'Nano Banana 2', requestModel: 'nano-banana-2', unitCostText: 'HUHN 0.09', resolutionText: '1K、2K、4K' },
  { model: 'Nano-Banana-Pro', label: 'Nano Banana Pro', requestModel: 'nano-banana-pro', unitCostText: 'HUHN 0.15', resolutionText: '1K、2K、4K' },
]

export const FIXED_IMAGE_MODEL_OPTIONS = FIXED_IMAGE_MODEL_PRICING.map((item) => ({
  value: item.model,
  label: item.label,
}))

const FIXED_IMAGE_MODEL_VALUES = new Set<string>(FIXED_IMAGE_MODEL_PRICING.map((item) => item.model))

export function isBananaImageModel(model: string): boolean {
  return /^Nano-Banana(?:-|$)/i.test(model.trim())
}

export function getBananaPricedImageModel(model: string): string {
  const normalized = model.trim()
  if (!isBananaImageModel(normalized)) return model
  return /^Nano-Banana-Pro$/i.test(normalized) ? 'nano-banana-pro' : 'nano-banana-2'
}

export function getFixedImagePricing(model: string): FixedImageModelPricing | null {
  const normalized = model.trim()
  const normalizedKey = normalized.toLowerCase()
  if (!normalized) return null

  const exact = FIXED_IMAGE_MODEL_PRICING.find((item) => (
    item.model.toLowerCase() === normalizedKey ||
    item.requestModel.toLowerCase() === normalizedKey
  ))
  if (exact) return exact

  if (/^gpt-image-2-(?:vip|超分)$/i.test(normalized)) {
    return FIXED_IMAGE_MODEL_PRICING.find((item) => item.model === GPT_IMAGE_2_4K_MODEL) ?? null
  }

  if (!isBananaImageModel(normalized)) return null
  return FIXED_IMAGE_MODEL_PRICING.find((item) => (
    /^Nano-Banana-Pro(?:-(?:1k|2k|4k))?$/i.test(normalized)
      ? item.requestModel === 'nano-banana-pro'
      : item.requestModel === 'nano-banana-2'
  )) ?? null
}

export function getFixedImageRequestModel(model: string): string {
  return getFixedImagePricing(model)?.requestModel ?? model.trim()
}

export function getFixedImageModelUnitCostText(model: string): string | null {
  return getFixedImagePricing(model)?.unitCostText ?? null
}

export function getImageModelSubmitCostText(model: string): string {
  return getFixedImageModelUnitCostText(model) ?? 'HUHN --'
}

export function getImageModelOptionsForProfile(profileId: string) {
  void profileId
  return [...FIXED_IMAGE_MODEL_OPTIONS]
}

export function buildFixedModelPriceRows(profileId: string): ModelPriceRow[] {
  const knownModels = new Set<string>()
  const rows: ModelPriceRow[] = getImageModelOptionsForProfile(profileId).map((option) => {
    const pricing = getFixedImagePricing(option.value)
    const requestModel = pricing?.requestModel ?? option.value
    knownModels.add(option.value.toLowerCase())
    knownModels.add(requestModel.toLowerCase())

    return {
      model: option.value,
      upstreamModel: requestModel !== option.value ? requestModel : undefined,
      priceText: pricing?.unitCostText ?? 'HUHN --',
      resolutionText: pricing?.resolutionText,
    }
  })

  return rows
}

export function normalizeFixedImageModel(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_IMAGES_MODEL
  const model = value.trim()
  if (/^gpt-image-2-(?:vip|超分)$/i.test(model)) return GPT_IMAGE_2_4K_MODEL
  if (/^Nano-Banana$/i.test(model)) return 'Nano-Banana-2'
  if (/^Nano-Banana-Pro-(?:1k|2k|4k)$/i.test(model)) return 'Nano-Banana-Pro'
  if (/^Nano-Banana-2-(?:1k|2k|4k)$/i.test(model)) return 'Nano-Banana-2'
  if (/^Nano-Banana-(?:1k|2k|4k)$/i.test(model)) return 'Nano-Banana-2'

  // 画布节点可能保存上游接口返回的小写模型 ID，这里统一还原为站点使用的显示模型，避免被误判成默认模型。
  const normalizedKey = model.toLowerCase()
  const fixedModel = FIXED_IMAGE_MODEL_PRICING.find((item) => (
    item.model.toLowerCase() === normalizedKey || item.requestModel.toLowerCase() === normalizedKey
  ))
  if (fixedModel) return fixedModel.model

  return FIXED_IMAGE_MODEL_VALUES.has(model) ? model : DEFAULT_IMAGES_MODEL
}
