import { describe, expect, it } from 'vitest'

import { buildFixedModelPriceRows, GPT_IMAGE_2_VIP_MODEL, getFixedImageRequestModel } from './modelPricing'

describe('fixed image model pricing', () => {
  it('separates the super-resolution model from the real 4K model', () => {
    expect(getFixedImageRequestModel(GPT_IMAGE_2_VIP_MODEL)).toBe('gpt-image-2-vip')
    expect(getFixedImageRequestModel('gpt-image-2-4k')).toBe('gpt-image-2-4k')
  })

  it('includes supported resolutions for the model list', () => {
    const rows = buildFixedModelPriceRows('wenyun-site')

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'gpt-image-2', resolutionText: '1K', priceText: 'HUHN 0.06' }),
      expect.objectContaining({ model: GPT_IMAGE_2_VIP_MODEL, upstreamModel: undefined, resolutionText: '1K、2K、4K', priceText: 'HUHN 0.09' }),
      expect.objectContaining({ model: 'gpt-image-2-4k', resolutionText: '1K、2K、4K', priceText: 'HUHN 0.15' }),
      expect.objectContaining({ model: 'Nano-Banana-2', resolutionText: '1K、2K、4K' }),
      expect.objectContaining({ model: 'Nano-Banana-Pro', resolutionText: '1K、2K、4K' }),
    ]))
  })
})
