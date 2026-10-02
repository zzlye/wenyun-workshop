import type { ApiProfile, AppSettings } from '../types'
import { getActiveApiProfile, LOCKED_WENYUN_PROFILE_ID, normalizeSettings } from './apiProfiles'

export function getEffectiveVideoApiKey(settings: AppSettings): string {
  const normalized = normalizeSettings(settings)
  // 视频地址固定属于文运站，切换出图站点时不能使用其他站点的凭据，也不能拿管理令牌生成。
  const accountKey = normalized.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]?.boundApiKey?.trim() ?? ''
  const manualKey = normalized.videoApiKey.trim()
  return accountKey && (normalized.accountApiKeyMode === 'account' || !manualKey) ? accountKey : manualKey
}

export function getAccountSessionForProfile(settings: AppSettings, profileId: string) {
  return normalizeSettings(settings).newApiAccountSessions[profileId] ?? null
}

export function getEffectiveImageApiProfile(settings: AppSettings, profile: ApiProfile = getActiveApiProfile(settings)): ApiProfile {
  const normalized = normalizeSettings(settings)
  const session = normalized.newApiAccountSessions[profile.id]
  const manualKey = profile.apiKey.trim()
  const accountKey = session?.boundApiKey?.trim() ?? ''
  const shouldUseAccountKey = normalized.accountApiKeyMode === 'account' || !manualKey
  const apiKey = shouldUseAccountKey && accountKey ? accountKey : manualKey

  return {
    ...profile,
    apiKey,
  }
}

export function validateEffectiveImageApiProfile(settings: AppSettings, profile: ApiProfile): string | null {
  const manualKey = profile.apiKey.trim()
  const accountKey = normalizeSettings(settings).newApiAccountSessions[profile.id]?.boundApiKey?.trim() ?? ''
  if (!manualKey && !accountKey) return '缺少 API Key，请填写 Key 或登录账号'
  return null
}
