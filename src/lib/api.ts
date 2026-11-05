import { getActiveApiProfile, getCustomProviderDefinition } from './apiProfiles'
import { getEffectiveImageApiProfile } from './accountApiKey'
import { callFalAiImageApi } from './falAiImageApi'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import { prepareReferenceImageDataUrlForApi, type CallApiOptions, type CallApiResult } from './imageApiShared'
import { beginImageGenerationActivity } from './generationActivity'
import { hasImageTaskCredentials } from './imageTasks'
import { buildMidjourneyRequest, isMidjourneyModel } from './midjourney'
import { isGptImage26Model } from './modelPricing'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const endActivity = beginImageGenerationActivity()
  try {
    const profile = getEffectiveImageApiProfile(opts.settings, getActiveApiProfile(opts.settings))
    const customProvider = getCustomProviderDefinition(opts.settings, profile.provider)
    const recovering = hasImageTaskCredentials(opts.imageTask) || opts.imageTask?.recoverOnly
    // 切换模型或接口后仍可能残留标注，分流前拒绝，防止其他接口静默丢弃图层。
    if (opts.markupDataUrl && !recovering) {
      if (!isGptImage26Model(profile.model) || profile.provider === 'fal' || customProvider) throw new Error('请选择 GPT Image 2.6 图片接口进行标注编辑')
      if (opts.maskDataUrl) throw new Error('标注和遮罩不能同时使用')
      if (!opts.inputImageDataUrls[0]) throw new Error('请先添加标注主图')
    }
    // 素材预处理前先拒绝超限及遮罩，避免无效请求耗时或丢失参考图。
    if (isMidjourneyModel(profile.model) && !hasImageTaskCredentials(opts.imageTask) && !opts.imageTask?.recoverOnly) {
      buildMidjourneyRequest(profile.model, opts.prompt, opts.params, opts.inputImageDataUrls, opts.maskDataUrl)
    }
    // 服务端已有完整请求，恢复时不能再读取可能失效的本地原图或遮罩。
    const optimizedOpts = recovering
      ? { ...opts, inputImageDataUrls: [], maskDataUrl: undefined, markupDataUrl: undefined }
      : await prepareImageInputsForApi(opts)
    if (profile.provider === 'fal') return callFalAiImageApi(optimizedOpts, profile)

    return callOpenAICompatibleImageApi(optimizedOpts, profile, customProvider)
  } finally {
    endActivity()
  }
}

async function prepareImageInputsForApi(opts: CallApiOptions): Promise<CallApiOptions> {
  if (!opts.inputImageDataUrls.length) return opts

  const inputImageDataUrls = await Promise.all(
    opts.inputImageDataUrls.map((dataUrl, index) =>
      prepareReferenceImageDataUrlForApi(dataUrl, {
        keepOriginal: Boolean((opts.maskDataUrl || opts.markupDataUrl) && index === 0),
      }),
    ),
  )

  return { ...opts, inputImageDataUrls }
}
