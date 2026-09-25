import { getActiveApiProfile, getCustomProviderDefinition } from './apiProfiles'
import { getEffectiveImageApiProfile } from './accountApiKey'
import { callFalAiImageApi } from './falAiImageApi'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import { prepareReferenceImageDataUrlForApi, type CallApiOptions, type CallApiResult } from './imageApiShared'
import { beginImageGenerationActivity } from './generationActivity'
import { hasImageTaskCredentials } from './imageTasks'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const endActivity = beginImageGenerationActivity()
  try {
    const profile = getEffectiveImageApiProfile(opts.settings, getActiveApiProfile(opts.settings))
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
