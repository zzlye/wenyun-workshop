import { describe, expect, it } from 'vitest'
import { findBananaSizePreset, getBananaSizeConfig, resolveBananaSizePreset } from './bananaImageSize'

describe('文运香蕉官方尺寸', () => {
  it('按模型区分官方比例和分辨率', () => {
    const pro = getBananaSizeConfig('Nano-Banana-Pro')!
    const flash = getBananaSizeConfig('Nano-Banana-2')!
    const banana21 = getBananaSizeConfig('nano-banana-2.1')!
    expect(getBananaSizeConfig('gemini-nano-banana-2.1')).toBe(banana21)
    expect(banana21.ratios).toEqual(flash.ratios)
    expect(banana21.tiers).toEqual(['1K', '2K', '4K'])
    expect(banana21.presets.some((preset) => preset.tier === '512px')).toBe(false)
    expect(pro.ratios).toEqual(['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4', '21:9'])
    expect(flash.ratios).toEqual([...pro.ratios, '1:4', '4:1', '1:8', '8:1'])
    expect(pro.tiers).toEqual(['1K', '2K', '4K'])
    expect(flash.tiers).toEqual(['512px', '1K', '2K', '4K'])
    expect(getBananaSizeConfig('gpt-image-2')).toBeNull()
    expect(getBananaSizeConfig('seedream-5-pro')).toBeNull()
  })

  it.each([
    ['Nano-Banana-2', '512x512', '512px', '1:1', '512x512'],
    ['nano-banana-2', '12288x1536', '4K', '8:1', '12288x1536'],
    ['gemini-3.1-flash-image-preview', '384x3072', '1K', '1:8', '384x3072'],
    ['Nano-Banana-Pro', '928x1152', '1K', '4:5', '928x1152'],
    ['gemini-3-pro-image', ' 4096 × 4096 ', '4K', '1:1', '4096x4096'],
    ['Nano-Banana-Pro', '3840x2160', '4K', '16:9', '5504x3072'],
    ['Nano-Banana-Pro', '2880x2880', '4K', '1:1', '4096x4096'],
    ['Nano-Banana-Pro', '2560x1088', '2K', '21:9', '3168x1344'],
    ['Nano-Banana-2', '1280x720', '1K', '16:9', '1376x768'],
    ['Nano-Banana-Pro', '512x512', '1K', '1:1', '1024x1024'],
    ['Nano-Banana-Pro', '12288x1536', '4K', '21:9', '6336x2688'],
    ['Nano-Banana-Pro', '1:8', '1K', '9:16', '768x1376'],
    ['Nano-Banana-2', '4:5', '1K', '4:5', '928x1152'],
    ['Nano-Banana-2', 'auto', '1K', '1:1', '1024x1024'],
  ])('将 %s 的 %s 解析为官方档位和比例', (model, input, tier, ratio, size) => {
    expect(resolveBananaSizePreset(model, input)).toEqual({ tier, ratio, size })
  })

  it('精确尺寸识别不接收另一模型独有的比例或档位', () => {
    expect(findBananaSizePreset('Nano-Banana-Pro', '512x512')).toBeNull()
    expect(findBananaSizePreset('Nano-Banana-Pro', '12288x1536')).toBeNull()
    expect(findBananaSizePreset('Nano-Banana-2', '3840x2160')).toBeNull()
    expect(resolveBananaSizePreset('gpt-image-2', '3840x2160')).toBeNull()
  })
})
