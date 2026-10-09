import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFalProfile, createDefaultOpenAIProfile, DEFAULT_SETTINGS, FIXED_IMAGE_MODEL_OPTIONS, LOCKED_PUBLIC_PROFILE_ID, normalizeImageSizeForProfile, normalizeSettings } from './apiProfiles'
import { getOutputImageLimitForSettings, normalizeParamsForSettings } from './paramCompatibility'

describe('parameter compatibility', () => {
  it.each(FIXED_IMAGE_MODEL_OPTIONS)('MJ 比例切换至 $value 时转为目标模型可用尺寸', ({ value: model }) => {
    const size = normalizeImageSizeForProfile('16:9', DEFAULT_SETTINGS.activeProfileId, model)
    if (model === 'mj-v8.2') {
      expect(size).toBe('16:9')
      return
    }
    expect(size).toMatch(/^\d+x\d+$/)
    expect(size).toBe(model.toLowerCase().includes('banana') ? '1376x768' : '1280x720')

    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({ ...profile, model })),
    })
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '16:9' }, settings).size).toBe(size)
  })

  it.each(FIXED_IMAGE_MODEL_OPTIONS)('从 $value 切换回 MJ 时只保留比例', ({ value: model }) => {
    const size = normalizeImageSizeForProfile('16:9', DEFAULT_SETTINGS.activeProfileId, model)
    expect(normalizeImageSizeForProfile(size, DEFAULT_SETTINGS.activeProfileId, 'mj-v8.2')).toBe('16:9')
  })

  it('切换模型时清理不支持的极高品质', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({ ...profile, model: 'gpt-image-2' })),
    })
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality: 'xhigh' }, settings).quality).toBe('auto')
  })

  it.each([
    ['Nano-Banana-2', '512x512'],
    ['Nano-Banana-2', '12288x1536'],
    ['Nano-Banana-Pro', '4096x4096'],
    ['Nano-Banana-Pro', '6336x2688'],
  ])('保留 %s 的官方尺寸 %s，不套用通用像素限制', (model, size) => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({ ...profile, model })),
    })
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size }, settings).size).toBe(size)
  })

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
