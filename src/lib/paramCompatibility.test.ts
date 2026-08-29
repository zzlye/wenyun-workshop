import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFalProfile, createDefaultOpenAIProfile, DEFAULT_SETTINGS, LOCKED_PUBLIC_PROFILE_ID, normalizeSettings } from './apiProfiles'
import { getOutputImageLimitForSettings, normalizeParamsForSettings } from './paramCompatibility'

describe('parameter compatibility', () => {
  it('limits OpenAI output count to 10', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: false })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(getOutputImageLimitForSettings(settings)).toBe(10)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 12 }, settings).n).toBe(10)
  })

  it('keeps the locked fixed-site output count when stale settings contain fal.ai', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const settings = {
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    }

    expect(getOutputImageLimitForSettings(settings)).toBe(10)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 12 }, settings).n).toBe(10)
  })

  it('keeps OpenAI streaming output count so the request can disable streaming', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: true })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 4 }, settings).n).toBe(4)
  })

  it('keeps auto image quality for OpenAI compatible image providers', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality: 'auto' }, settings).quality).toBe('auto')
  })

  it('normalizes auto size through fixed-site defaults when stale settings contain fal.ai', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const settings = {
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    }

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings).size).toBe(DEFAULT_PARAMS.size)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings, { hasInputImages: true }).size).toBe(DEFAULT_PARAMS.size)
  })

  it('keeps public site image size options the same as Wenyun', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      activeProfileId: LOCKED_PUBLIC_PROFILE_ID,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '3840x2160' }, settings).size).toBe('3840x2160')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '2048x2048' }, settings).size).toBe('2048x2048')
  })

  it('limits Seedream 5 Pro requests to 2K while preserving the selected ratio', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({ ...profile, model: 'seedream-5-pro' })),
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '3840x2160' }, settings).size).toBe('2560x1440')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '2048x2048' }, settings).size).toBe('2048x2048')
  })
})
