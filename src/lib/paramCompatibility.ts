import { DEFAULT_PARAMS, type AppSettings, type TaskParams } from '../types'
import { getActiveApiProfile, normalizeImageSizeForProfile } from './apiProfiles'
import { normalizeImageSize } from './size'

export const DEFAULT_FAL_IMAGE_SIZE = '1360x1024'
export const MAX_FAL_OUTPUT_IMAGES = 4
export const MAX_OPENAI_OUTPUT_IMAGES = 10

export function getOutputImageLimitForSettings(settings: AppSettings) {
  return getActiveApiProfile(settings).provider === 'fal' ? MAX_FAL_OUTPUT_IMAGES : MAX_OPENAI_OUTPUT_IMAGES
}

export function normalizeParamsForSettings(
  params: TaskParams,
  settings: AppSettings,
  options: { hasInputImages?: boolean } = {},
): TaskParams {
  const activeProfile = getActiveApiProfile(settings)
  const outputImageLimit = getOutputImageLimitForSettings(settings)
  const normalizedSize = normalizeImageSizeForProfile(normalizeImageSize(params.size), activeProfile.id)
  const nextParams: TaskParams = {
    ...params,
    size: normalizedSize === 'auto' ? DEFAULT_PARAMS.size : normalizedSize || DEFAULT_PARAMS.size,
    // 旧配置里保存的 auto 统一按最高品质提交，避免不同上游把 auto 解释成低档位。
    quality: params.quality === 'auto' ? 'high' : params.quality,
    output_format: 'png',
    output_compression: DEFAULT_PARAMS.output_compression,
    n: Math.min(outputImageLimit, Math.max(1, params.n || DEFAULT_PARAMS.n)),
  }

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
