import { describe, expect, it } from 'vitest'

import { buildFixedModelPriceRows, FIXED_IMAGE_MODEL_OPTIONS, getFixedImageRequestModel, getImageSizeTiersForModel } from './modelPricing'

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
      expect.objectContaining({ model: 'Nano-Banana-Pro', resolutionText: '1K、2K、4K' }),
    ]))
    expect(rows.map((row) => row.model)).not.toContain('gpt-image-2-vip')
    expect(rows.map((row) => row.model)).not.toContain('sora-2')
    expect(FIXED_IMAGE_MODEL_OPTIONS.map((option) => option.value)).toContain('seedream-5-pro')
    expect(getImageSizeTiersForModel('seedream-5-pro')).toEqual(['1K', '2K'])
  })
})
