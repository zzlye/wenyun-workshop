import { describe, expect, it } from 'vitest'

import { getEffectiveImageApiProfile, getEffectiveVideoApiKey, validateEffectiveImageApiProfile } from './accountApiKey'
import { DEFAULT_SETTINGS, LOCKED_WENYUN_PROFILE_ID, normalizeSettings } from './apiProfiles'

describe('getEffectiveImageApiProfile', () => {
  it('老账号没有视频凭据或绑定了其他分组时不回退到图片Key和手填Key', () => {
    for (const group of [undefined, 'default', 'auto']) {
      const settings = normalizeSettings({ ...DEFAULT_SETTINGS, accountApiKeyMode: 'account', videoApiKey: 'manual-key',
        newApiAccountSessions: { [LOCKED_WENYUN_PROFILE_ID]: {
          siteProfileId: LOCKED_WENYUN_PROFILE_ID, username: 'demo', accessToken: 'manager-key',
          boundApiKey: 'image-key', boundVideoApiKey: 'wrong-key', boundVideoApiKeyGroup: group,
        } },
      })
      expect(getEffectiveVideoApiKey(settings)).toBe('')
      expect(getEffectiveImageApiProfile(settings).apiKey).toBe('image-key')
    }
  })
  it('keeps manual key when manual mode is selected', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      accountApiKeyMode: 'manual',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => profile.id === LOCKED_WENYUN_PROFILE_ID ? { ...profile, apiKey: 'manual-key' } : profile),
      newApiAccountSessions: {
        [LOCKED_WENYUN_PROFILE_ID]: {
          siteProfileId: LOCKED_WENYUN_PROFILE_ID,
          username: 'demo',
          accessToken: 'login-token',
          boundApiKey: 'account-key',
        },
      },
    })

    expect(getEffectiveImageApiProfile(settings).apiKey).toBe('manual-key')
  })

  it('uses account key when selected', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      accountApiKeyMode: 'account',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => profile.id === LOCKED_WENYUN_PROFILE_ID ? { ...profile, apiKey: 'manual-key' } : profile),
      newApiAccountSessions: {
        [LOCKED_WENYUN_PROFILE_ID]: {
          siteProfileId: LOCKED_WENYUN_PROFILE_ID,
          username: 'demo',
          accessToken: 'login-token',
          boundApiKey: 'account-key',
        },
      },
    })

    expect(getEffectiveImageApiProfile(settings).apiKey).toBe('account-key')
  })

  it('falls back to account key when manual key is empty', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      accountApiKeyMode: 'manual',
      newApiAccountSessions: {
        [LOCKED_WENYUN_PROFILE_ID]: {
          siteProfileId: LOCKED_WENYUN_PROFILE_ID,
          username: 'demo',
          accessToken: 'login-token',
          boundApiKey: 'account-key',
        },
      },
    })

    expect(getEffectiveImageApiProfile(settings).apiKey).toBe('account-key')
  })

  it('requires either manual key or account key', () => {
    const settings = normalizeSettings(DEFAULT_SETTINGS)

    expect(validateEffectiveImageApiProfile(settings, getEffectiveImageApiProfile(settings))).toBe('缺少 API Key，请填写 Key 或登录账号')
  })
})
