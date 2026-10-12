import { getActiveApiProfile, getCustomProviderDefinition } from './apiProfiles'
import { getEffectiveImageApiProfile } from './accountApiKey'
import { callFalAiImageApi } from './falAiImageApi'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import { prepareReferenceImageDataUrlForApi, type CallApiOptions, type CallApiResult } from './imageApiShared'
import { beginImageGenerationActivity } from './generationActivity'
import { hasImageTaskCredentials } from './imageTasks'
import { buildMidjourneyRequest, isMidjourneyModel } from './midjourney'
import { isLockedApiProxyTarget } from './devProxy'
import { supportsTransparentImageBackground } from './modelPricing'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const endActivity = beginImageGenerationActivity()
  try {
    const profile = getEffectiveImageApiProfile(opts.settings, getActiveApiProfile(opts.settings))
    // 素材预处理前先拒绝超限及遮罩，避免无效请求耗时或丢失参考图。
    if (isMidjourneyModel(profile.model) && !hasImageTaskCredentials(opts.imageTask)) {
      buildMidjourneyRequest(profile.model, opts.prompt, opts.params, opts.inputImageDataUrls, opts.maskDataUrl)
    }
    // 遮罩不可静默省略；在素材读取和付费请求之前校验，恢复已有任务时不重新校验旧素材。
    if (opts.maskDataUrl && !hasImageTaskCredentials(opts.imageTask)) {
      if (!opts.inputImageDataUrls.length) throw new Error('遮罩编辑需要主图，请先添加主图')
      if (isLockedApiProxyTarget(profile.baseUrl) && !supportsTransparentImageBackground(profile.model)) {
        throw new Error('当前模型尚未开放遮罩编辑，请移除遮罩或选择满血模型')
      }
    }
    // 服务端已有完整请求，恢复时不能再读取可能失效的本地原图或遮罩。
    const optimizedOpts = hasImageTaskCredentials(opts.imageTask)
      ? { ...opts, inputImageDataUrls: [], maskDataUrl: undefined }
      : await prepareImageInputsForApi(opts)
    if (profile.provider === 'fal') return callFalAiImageApi(optimizedOpts, profile)

    return callOpenAICompatibleImageApi(optimizedOpts, profile, getCustomProviderDefinition(opts.settings, profile.provider))
  } finally {
    endActivity()
  }
}

async function prepareImageInputsForApi(opts: CallApiOptions): Promise<CallApiOptions> {
  if (!opts.inputImageDataUrls.length) return opts

  const inputImageDataUrls = await Promise.all(
    opts.inputImageDataUrls.map((dataUrl, index) =>
      prepareReferenceImageDataUrlForApi(dataUrl, {
        keepOriginal: Boolean(opts.maskDataUrl && index === 0),
      }),
    ),
  )

  return { ...opts, inputImageDataUrls }
}
