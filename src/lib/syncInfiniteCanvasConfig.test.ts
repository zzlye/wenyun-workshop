import { afterEach, describe, expect, it } from 'vitest'

import { defaultConfig, useConfigStore } from '../infiniteCanvasSource/stores/use-config-store'
import { DEFAULT_SETTINGS, LOCKED_WENYUN_PROFILE_ID } from './apiProfiles'
import { syncInfiniteCanvasConfigFromSettings } from './syncInfiniteCanvasConfig'
import { CANVAS_VIDEO_MODEL } from './videoModel'

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
    expect(state.config.videoBaseUrl).toBe('https://api.geeknow.ai/v1')
    expect(state.config.videoApiKey).toBe('video-key')
    expect(state.config.videoModel).toBe(CANVAS_VIDEO_MODEL)
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
  })
})
