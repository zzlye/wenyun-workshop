import { describe, expect, it } from 'vitest'

import { buildFixedModelPriceRows, FIXED_IMAGE_MODEL_OPTIONS, getFixedImageRequestModel, getImageSizeTiersForModel, normalizeFixedImageModel, supportsExtendedImageQuality, supportsTransparentImageBackground } from './modelPricing'
import { DEFAULT_SETTINGS, normalizeImageSizeForProfile, normalizeSettings } from './apiProfiles'

describe('fixed image model pricing', () => {
  it('maps legacy vip and super-resolution names to the 4K model', () => {
    expect(getFixedImageRequestModel('gpt-image-2-vip')).toBe('gpt-image-2-4k')
    expect(getFixedImageRequestModel('gpt-image-2-超分')).toBe('gpt-image-2-4k')
    expect(getFixedImageRequestModel('gpt-image-2-4k')).toBe('gpt-image-2-4k')
    expect(getFixedImageRequestModel('seedream-5-pro')).toBe('seedream-5-pro')
  })

  it('includes supported resolutions for the model list', () => {
    const rows = buildFixedModelPriceRows('wenyun-site')

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'gpt-image-2', resolutionText: '1K', priceText: 'HUHN 0.06' }),
      expect.objectContaining({ model: 'gpt-image-2-4k', resolutionText: '1K、2K、4K', priceText: 'HUHN 0.09' }),
      expect.objectContaining({ model: 'seedream-5-pro', resolutionText: '1K、2K', priceText: 'HUHN --' }),
      expect.objectContaining({ model: 'Nano-Banana-2', resolutionText: '1K、2K、4K' }),
      expect.objectContaining({ model: 'nano-banana-2.1', resolutionText: '1K、2K、4K' }),
      expect.objectContaining({ model: 'Nano-Banana-Pro', resolutionText: '1K、2K、4K' }),
    ]))
    expect(rows.map((row) => row.model)).not.toContain('gpt-image-2-vip')
    expect(rows.map((row) => row.model)).not.toContain('sora-2')
    expect(rows.map((row) => row.model)).not.toContain('mj-niji7')
    expect(FIXED_IMAGE_MODEL_OPTIONS.map((option) => option.value)).toContain('seedream-5-pro')
    expect(FIXED_IMAGE_MODEL_OPTIONS.map((option) => option.value)).not.toContain('mj-niji7')
    expect(FIXED_IMAGE_MODEL_OPTIONS.map((option) => option.value)).toEqual(expect.arrayContaining([
      'gpt-image-2.5-sunburst-满血',
      'gpt-image-2.5-flare-满血',
      'gpt-image-2.5-sunburst-官渠',
      'gpt-image-2.5-flare-官渠',
    ]))
    expect(getImageSizeTiersForModel('seedream-5-pro')).toEqual(['1K', '2K'])
    expect(getFixedImageRequestModel('nano-banana-2.1')).toBe('nano-banana-2.1')
  })

  it('基础2.5模型仅支持1K，列表和参数能力保持一致', () => {
    for (const model of ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']) {
      expect(getImageSizeTiersForModel(model)).toEqual(['1K'])
      expect(getImageSizeTiersForModel(model.toUpperCase())).toEqual(['1K'])
      expect(buildFixedModelPriceRows('wenyun-site').find((row) => row.model === model)?.resolutionText).toBe('1K')
      expect(normalizeImageSizeForProfile('3840x2160', 'wenyun-site', model)).toBe('1280x720')
    }
  })

  it('图片二四K、满血和官渠路由继续保留全部清晰度', () => {
    const models = [
      'gpt-image-2-4k',
      'gpt-image-2.5-flare-满血',
      'gpt-image-2.5-sunburst-满血',
      'gpt-image-2.5-flare-官渠',
      'gpt-image-2.5-sunburst-官渠',
    ]

    for (const model of models) {
      expect(getImageSizeTiersForModel(model)).toEqual(['1K', '2K', '4K'])
    }
  })

  it.each(['gpt-image-2.5-flare-4k', 'gpt-image-2.5-sunburst-4k'])('%s 恢复模型和价格入口，旧配置保留原渠道与参数能力', model => {
    expect(FIXED_IMAGE_MODEL_OPTIONS.map(option => option.value)).toContain(model)
    expect(buildFixedModelPriceRows('wenyun-site')).toContainEqual({ model, upstreamModel: undefined, priceText: 'HUHN --', resolutionText: '1K、2K、4K' })
    expect(normalizeFixedImageModel(model)).toBe(model)
    expect(normalizeFixedImageModel(model.toUpperCase())).toBe(model)
    expect(getFixedImageRequestModel(model)).toBe(model)
    expect(getImageSizeTiersForModel(model)).toEqual(['1K', '2K', '4K'])
    expect(supportsExtendedImageQuality(model)).toBe(false)
    expect(supportsTransparentImageBackground(model)).toBe(false)
    expect(normalizeImageSizeForProfile('3840x2160', 'wenyun-site', model)).toBe('3840x2160')
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: DEFAULT_SETTINGS.profiles.map(profile => ({ ...profile, model })) })
    expect(settings.profiles.every(profile => profile.model === model)).toBe(true)
  })

})
