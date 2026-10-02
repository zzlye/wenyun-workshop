import { afterEach, describe, expect, it } from 'vitest'

import { defaultConfig, useConfigStore } from '../infiniteCanvasSource/stores/use-config-store'
import { DEFAULT_SETTINGS, LOCKED_WENYUN_PROFILE_ID, LOCKED_PUBLIC_PROFILE_ID } from './apiProfiles'
import { syncInfiniteCanvasConfigFromSettings } from './syncInfiniteCanvasConfig'
import { CANVAS_VIDEO_BASE_URL, CANVAS_VIDEO_TIMEOUT } from './videoModel'

afterEach(() => {
  useConfigStore.setState({
    config: defaultConfig,
    publicSettings: null,
    isPublicSettingsLoading: false,
    isConfigOpen: false,
    shouldPromptContinue: false,
  })
})

describe('syncInfiniteCanvasConfigFromSettings', () => {
  it('keeps canvas video requests on local direct settings when old backend settings remain in store', () => {
    useConfigStore.setState({
      publicSettings: {
        modelChannel: {
          allowCustomChannel: false,
          availableModels: ['backend-video'],
          defaultModel: 'backend-video',
          defaultImageModel: 'backend-image',
          defaultVideoModel: 'backend-video',
          defaultTextModel: 'backend-text',
          systemPrompt: '',
          modelCosts: [],
        },
        auth: { allowRegister: false, linuxDo: { enabled: false } },
      },
    })

    syncInfiniteCanvasConfigFromSettings({
      ...DEFAULT_SETTINGS,
      videoBaseUrl: 'https://api.geeknow.ai/v1',
      videoApiKey: 'video-key',
      videoModel: 'sora-2',
      videoTimeout: 120,
    })

    const state = useConfigStore.getState()
    expect(state.publicSettings).toBeNull()
    expect(state.config.channelMode).toBe('local')
    expect(state.config.videoBaseUrl).toBe(CANVAS_VIDEO_BASE_URL)
    expect(state.config.videoApiKey).toBe('video-key')
    expect(state.config.videoModel).toBe('sora-2')
    expect(state.config.videoTimeout).toBe(CANVAS_VIDEO_TIMEOUT)
  })

  it('syncs the logged-in account key to canvas when account key mode is selected', () => {
    syncInfiniteCanvasConfigFromSettings({
      ...DEFAULT_SETTINGS,
      accountApiKeyMode: 'account',
      newApiAccountSessions: {
        [LOCKED_WENYUN_PROFILE_ID]: {
          siteProfileId: LOCKED_WENYUN_PROFILE_ID,
          username: 'demo',
          accessToken: 'login-token',
          boundApiKey: 'account-key',
        },
      },
    })

    const state = useConfigStore.getState()
    expect(state.config.channelMode).toBe('local')
    expect(state.config.apiKey).toBe('account-key')
    expect(state.config.videoApiKey).toBe('account-key')
  })

  it.each([
    { mode: 'manual' as const, manual: '', expected: 'account-key' },
    { mode: 'manual' as const, manual: 'video-key', expected: 'video-key' },
    { mode: 'account' as const, manual: 'video-key', expected: 'account-key' },
  ])('视频鉴权遵守账号与手填密钥选择：$mode / $manual', ({ mode, manual, expected }) => {
    const settings = {
      ...DEFAULT_SETTINGS, activeProfileId: LOCKED_PUBLIC_PROFILE_ID,
      accountApiKeyMode: mode, videoApiKey: manual,
      newApiAccountSessions: {
        [LOCKED_WENYUN_PROFILE_ID]: {
          siteProfileId: LOCKED_WENYUN_PROFILE_ID, username: 'demo',
          accessToken: 'management-token', boundApiKey: 'account-key',
        },
        [LOCKED_PUBLIC_PROFILE_ID]: {
          siteProfileId: LOCKED_PUBLIC_PROFILE_ID, username: 'other',
          accessToken: 'other-management-token', boundApiKey: 'wrong-site-key',
        },
      },
    }
    syncInfiniteCanvasConfigFromSettings(settings)
    expect(useConfigStore.getState().config.videoApiKey).toBe(expected)
    expect(settings.videoApiKey).toBe(manual)
    // 退出账号后重新同步，不残留上次的账号密钥。
    syncInfiniteCanvasConfigFromSettings({ ...settings, newApiAccountSessions: {} })
    expect(useConfigStore.getState().config.videoApiKey).toBe(manual)
  })

  it('登录但没有绑定API令牌时不拿管理令牌生成视频', () => {
    syncInfiniteCanvasConfigFromSettings({
      ...DEFAULT_SETTINGS, videoApiKey: '',
      newApiAccountSessions: {
        [LOCKED_WENYUN_PROFILE_ID]: {
          siteProfileId: LOCKED_WENYUN_PROFILE_ID, username: 'demo', accessToken: 'management-token',
        },
      },
    })
    expect(useConfigStore.getState().config.videoApiKey).toBe('')
  })
})
