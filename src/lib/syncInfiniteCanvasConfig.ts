import { useConfigStore } from '../infiniteCanvasSource/stores/use-config-store'
import type { AppSettings } from '../types'
import { getEffectiveImageApiProfile } from './accountApiKey'
import { getActiveApiProfile, normalizeSettings } from './apiProfiles'

export function syncInfiniteCanvasConfigFromSettings(settings: AppSettings) {
  const normalizedSettings = normalizeSettings(settings)
  const activeProfile = getEffectiveImageApiProfile(normalizedSettings, getActiveApiProfile(normalizedSettings))

  useConfigStore.setState((state) => ({
    // 集成版只使用文运工坊设置页里的直连渠道，避免原画布后台配置把请求改回“系统后端”。
    publicSettings: null,
    config: {
      ...state.config,
      channelMode: 'local',
      baseUrl: activeProfile.baseUrl,
      apiKey: activeProfile.apiKey,
      timeout: activeProfile.timeout,
      model: activeProfile.model,
      imageModel: activeProfile.model,
      textVideoBaseUrl: normalizedSettings.textVideoBaseUrl,
      textVideoApiKey: normalizedSettings.textVideoApiKey,
      textVideoApiProxy: normalizedSettings.textVideoApiProxy,
      textVideoTimeout: normalizedSettings.textVideoTimeout,
      textBaseUrl: normalizedSettings.textBaseUrl,
      textApiKey: normalizedSettings.textApiKey,
      textApiProxy: normalizedSettings.textApiProxy,
      textTimeout: normalizedSettings.textTimeout,
      videoBaseUrl: normalizedSettings.videoBaseUrl,
      videoApiKey: normalizedSettings.videoApiKey,
      videoApiProxy: normalizedSettings.videoApiProxy,
      videoTimeout: normalizedSettings.videoTimeout,
      textModel: normalizedSettings.textModel || state.config.textModel,
      videoModel: normalizedSettings.videoModel || state.config.videoModel,
    },
  }))
}
