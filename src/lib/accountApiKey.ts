import type { ApiProfile, AppSettings } from '../types'
import { getActiveApiProfile, normalizeSettings } from './apiProfiles'

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
