import { DEFAULT_PARAMS, type AppSettings, type TaskParams } from '../types'
import { getActiveApiProfile, normalizeImageSizeForProfile } from './apiProfiles'
import { normalizeImageBackground, supportsExtendedImageQuality } from './modelPricing'
import { isMidjourneyModel, normalizeMidjourneyRatio } from './midjourney'

export const DEFAULT_FAL_IMAGE_SIZE = '1360x1024'
export const MAX_FAL_OUTPUT_IMAGES = 4
export const MAX_OPENAI_OUTPUT_IMAGES = 10

export function getOutputImageLimitForSettings(settings: AppSettings) {
  if (isMidjourneyModel(getActiveApiProfile(settings).model)) return 1
  return getActiveApiProfile(settings).provider === 'fal' ? MAX_FAL_OUTPUT_IMAGES : MAX_OPENAI_OUTPUT_IMAGES
}

export function normalizeParamsForSettings(
  params: TaskParams,
  settings: AppSettings,
  options: { hasInputImages?: boolean } = {},
): TaskParams {
  const activeProfile = getActiveApiProfile(settings)
  const outputImageLimit = getOutputImageLimitForSettings(settings)
  if (isMidjourneyModel(activeProfile.model)) {
    return { ...params, size: normalizeMidjourneyRatio(params.size), n: 1, background: undefined }
  }
  // 所有模型共用尺寸转换，香蕉官方预设和 MJ 比例均按目标模型处理。
  const normalizedSize = normalizeImageSizeForProfile(params.size, activeProfile.id, activeProfile.model)
  const nextParams: TaskParams = {
    ...params,
    size: normalizedSize === 'auto' ? DEFAULT_PARAMS.size : normalizedSize || DEFAULT_PARAMS.size,
    quality: (params.quality === 'xhigh' || params.quality === 'max') && !supportsExtendedImageQuality(activeProfile.model)
      ? DEFAULT_PARAMS.quality : params.quality || DEFAULT_PARAMS.quality,
    output_format: 'png',
    output_compression: DEFAULT_PARAMS.output_compression,
    n: Math.min(outputImageLimit, Math.max(1, params.n || DEFAULT_PARAMS.n)),
  }

  // 模型切换后清理透明背景，避免残留参数传给没有开放该能力的渠道。
  const background = normalizeImageBackground(activeProfile.model, params.background)
  if (background) nextParams.background = background
  else if ('background' in nextParams) nextParams.background = undefined

  if (activeProfile.provider === 'openai' && activeProfile.codexCli) {
    nextParams.quality = DEFAULT_PARAMS.quality
  }

  if (activeProfile.provider === 'fal') {
    if (!options.hasInputImages && nextParams.size === 'auto') nextParams.size = DEFAULT_FAL_IMAGE_SIZE
    if (nextParams.quality === 'auto') nextParams.quality = 'high'
    nextParams.moderation = DEFAULT_PARAMS.moderation
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  return nextParams
}

export function getChangedParams(current: TaskParams, next: TaskParams): Partial<TaskParams> {
  const patch: Partial<TaskParams> = {}
  for (const key of Object.keys(next) as Array<keyof TaskParams>) {
    if (current[key] !== next[key]) {
      ;(patch as Record<keyof TaskParams, TaskParams[keyof TaskParams]>)[key] = next[key]
    }
  }
  return patch
}
