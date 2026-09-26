import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_IMAGES_MODEL, DEFAULT_SETTINGS, FIXED_IMAGE_MODEL_OPTIONS, GPT_IMAGE_2_VIP_MODEL, GPT_IMAGE_2_SUPER_MODEL, allowsCustomImageRatioForProfile, createDefaultOpenAIProfile, getActiveApiProfile, getApiBalanceSnapshot, getApiModelUnitCostText, getBananaPricedImageModel, getFixedImageRequestModel, getFixedImageModelUnitCostText, getImageSizeTiersForProfile, LOCKED_PUBLIC_PROFILE_ID, LOCKED_WENYUN_PROFILE_ID, mergeImportedSettings, normalizeImageSizeForProfile, normalizeImageModelForProfile, normalizeApiFormat, normalizeSettings, resolveImageApiFormat, setApiBalanceSnapshot, setApiPriceSnapshot } from './apiProfiles'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('主页主播模式', () => {
  it('旧配置默认关闭，只接受明确的布尔开启值', () => {
    expect(DEFAULT_SETTINGS.homeStreamerMode).toBe(false)
    for (const homeStreamerMode of [undefined, null, 'true', 'false', 1, false]) {
      expect(normalizeSettings({ homeStreamerMode }).homeStreamerMode).toBe(false)
    }
    expect(normalizeSettings({ homeStreamerMode: true }).homeStreamerMode).toBe(true)
  })

  it('开关及配置序列化不改变工坊背景', () => {
    const background = 'https://images.example/workshop.jpg'
    const enabled = normalizeSettings({ homeStreamerMode: true, appearanceBackgroundImageUrl: background, appearanceBackgroundOpacity: 0.5, appearanceBackgroundBlur: 10 })
    const restored = normalizeSettings(JSON.parse(JSON.stringify(enabled)))
    expect(restored.homeStreamerMode).toBe(true)
    for (const settings of [restored, normalizeSettings({ ...restored, homeStreamerMode: false })]) {
      expect(settings.appearanceBackgroundImageUrl).toBe(background)
      expect(settings.appearanceBackgroundOpacity).toBe(0.5)
      expect(settings.appearanceBackgroundBlur).toBe(10)
    }
  })
})

describe('画布习惯设置', () => {
  it('旧配置默认显示对齐辅助线，并支持持久化关闭', () => {
    expect(DEFAULT_SETTINGS.showCanvasAlignmentGuides).toBe(true)
    expect(normalizeSettings({}).showCanvasAlignmentGuides).toBe(true)
    expect(normalizeSettings({ showCanvasAlignmentGuides: false }).showCanvasAlignmentGuides).toBe(false)
    expect(normalizeSettings({ showCanvasAlignmentGuides: true }).showCanvasAlignmentGuides).toBe(true)
  })
})

describe('image API format', () => {
  it('defaults old profiles to automatic OpenAI-compatible detection', () => {
    expect(normalizeApiFormat(undefined)).toBe('auto')
    expect(createDefaultOpenAIProfile().apiFormat).toBe('auto')
    expect(resolveImageApiFormat({ baseUrl: 'https://api.example.com/v1', model: 'Nano-Banana-Pro' })).toBe('openai')
  })

  it('detects native Gemini endpoints and keeps explicit selection authoritative', () => {
    expect(resolveImageApiFormat({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'Nano-Banana-Pro' })).toBe('gemini')
    expect(resolveImageApiFormat({ baseUrl: 'https://api.example.com/v1', model: 'Nano-Banana-Pro', apiFormat: 'gemini' })).toBe('gemini')
    expect(resolveImageApiFormat({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'Nano-Banana-Pro', apiFormat: 'openai' })).toBe('openai')
  })
})

describe('固定站点配置', () => {
  it('disables image streaming by default and migrates saved streaming flags off', () => {
    expect(createDefaultOpenAIProfile().streamImages).toBe(false)
    expect(createDefaultOpenAIProfile().streamPartialImages).toBe(1)
    expect(DEFAULT_SETTINGS.streamImages).toBe(false)
    expect(DEFAULT_SETTINGS.streamPartialImages).toBe(1)
    expect(DEFAULT_SETTINGS.profiles[0].streamImages).toBe(false)
    expect(DEFAULT_SETTINGS.profiles[0].streamPartialImages).toBe(1)

    const normalized = normalizeSettings({
      profiles: [
        {
          ...createDefaultOpenAIProfile({ streamPartialImages: 3 }),
          streamImages: true,
        },
      ],
    })

    expect(normalized.streamImages).toBe(false)
    expect(normalized.streamPartialImages).toBe(3)
    expect(normalized.profiles[0].streamImages).toBe(false)
    expect(normalized.profiles[0].streamPartialImages).toBe(3)

    const clamped = normalizeSettings({
      profiles: [
        createDefaultOpenAIProfile({ streamPartialImages: 8 }),
      ],
    })

    expect(clamped.profiles[0].streamPartialImages).toBe(3)
  })

  it('enables Agent submit auto scroll by default', () => {
    expect(DEFAULT_SETTINGS.agentScrollToBottomAfterSubmit).toBe(true)
    expect(normalizeSettings({}).agentScrollToBottomAfterSubmit).toBe(true)
    expect(normalizeSettings({ agentScrollToBottomAfterSubmit: false }).agentScrollToBottomAfterSubmit).toBe(false)
  })

  it('keeps queried balances cached per locked profile', () => {
    const withWenyun = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...setApiBalanceSnapshot(DEFAULT_SETTINGS, LOCKED_WENYUN_PROFILE_ID, {
        text: 'HUHN 12.00',
        currency: 'HUHN',
        updatedAt: 1000,
      }),
    })
    const withBoth = normalizeSettings({
      ...withWenyun,
      ...setApiBalanceSnapshot(withWenyun, LOCKED_PUBLIC_PROFILE_ID, {
        text: 'HUHN 3.50',
        currency: 'HUHN',
        updatedAt: 2000,
      }),
    })

    expect(getApiBalanceSnapshot(withBoth, LOCKED_WENYUN_PROFILE_ID)).toMatchObject({ text: 'HUHN 12.00' })
    expect(getApiBalanceSnapshot(withBoth, LOCKED_PUBLIC_PROFILE_ID)).toMatchObject({ text: 'HUHN 3.50' })
  })

  it('reads synced price snapshots before falling back to fixed prices', () => {
    const withPrices = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...setApiPriceSnapshot(DEFAULT_SETTINGS, LOCKED_WENYUN_PROFILE_ID, {
        items: [
          { model: 'gpt-image-2-4k', rawPrice: 0.11, text: 'HUHN 0.11' },
        ],
        updatedAt: 1000,
        found: true,
      }),
    })

    expect(getApiModelUnitCostText(withPrices, LOCKED_WENYUN_PROFILE_ID, 'gpt-image-2-4k')).toBe('HUHN 0.11')
    expect(getApiModelUnitCostText(withPrices, LOCKED_WENYUN_PROFILE_ID, 'gpt-image-2-vip')).toBe('HUHN 0.11')
  })

  it('keeps Codex CLI compatibility disabled for locked profiles', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      codexCli: true,
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        codexCli: true,
        providerDrafts: {
          openai: { codexCli: true },
        },
      })),
    })

    expect(settings.codexCli).toBe(false)
    expect(settings.profiles.every((profile) => profile.codexCli === false)).toBe(true)
  })

  it('preserves API proxy settings for locked profiles', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      apiProxy: true,
      profiles: DEFAULT_SETTINGS.profiles.map((profile, index) => ({
        ...profile,
        apiProxy: index === 0,
      })),
    })

    expect(settings.profiles[0].apiProxy).toBe(true)
    expect(getActiveApiProfile(settings).apiProxy).toBe(true)
  })

  it('keeps the same fixed image models on Wenyun and public site', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [
        { ...DEFAULT_SETTINGS.profiles[0], model: GPT_IMAGE_2_SUPER_MODEL },
        { ...DEFAULT_SETTINGS.profiles[1], model: 'gpt-image-2-4k' },
      ],
    })

    expect(FIXED_IMAGE_MODEL_OPTIONS.map((option) => String(option.value))).toContain(GPT_IMAGE_2_SUPER_MODEL)
    expect(FIXED_IMAGE_MODEL_OPTIONS.map((option) => String(option.value))).toContain('gpt-image-2-4k')
    expect(FIXED_IMAGE_MODEL_OPTIONS.map((option) => String(option.value))).not.toContain('gpt-image-2-vip')
    expect(settings.profiles[0].model).toBe(GPT_IMAGE_2_SUPER_MODEL)
    expect(settings.profiles[1].model).toBe('gpt-image-2-4k')
  })

  it('uses the same image size options on public site and Wenyun', () => {
    expect(getImageSizeTiersForProfile(LOCKED_PUBLIC_PROFILE_ID)).toEqual(['1K', '2K', '4K'])
    expect(getImageSizeTiersForProfile(LOCKED_WENYUN_PROFILE_ID)).toEqual(['1K', '2K', '4K'])
    expect(allowsCustomImageRatioForProfile(LOCKED_PUBLIC_PROFILE_ID)).toBe(true)
    expect(allowsCustomImageRatioForProfile(LOCKED_WENYUN_PROFILE_ID)).toBe(true)
    expect(normalizeImageSizeForProfile('3840x2160', LOCKED_PUBLIC_PROFILE_ID)).toBe('3840x2160')
    expect(normalizeImageSizeForProfile('1280x1024', LOCKED_PUBLIC_PROFILE_ID)).toBe('1280x1024')
    expect(normalizeImageSizeForProfile('3840x2160', LOCKED_WENYUN_PROFILE_ID)).toBe('3840x2160')
    expect(getImageSizeTiersForProfile(LOCKED_WENYUN_PROFILE_ID, 'seedream-5-pro')).toEqual(['1K', '2K'])
    expect(normalizeImageSizeForProfile('3840x2160', LOCKED_WENYUN_PROFILE_ID, 'seedream-5-pro')).toBe('2560x1440')
    expect(normalizeImageSizeForProfile('2048x2048', LOCKED_WENYUN_PROFILE_ID, 'seedream-5-pro')).toBe('2048x2048')
  })

  it('uses fixed display prices for built-in image models', () => {
    expect(getFixedImageModelUnitCostText(DEFAULT_IMAGES_MODEL)).toBe('HUHN 0.06')
    expect(getFixedImageModelUnitCostText(GPT_IMAGE_2_VIP_MODEL)).toBe('HUHN 0.09')
    expect(getFixedImageModelUnitCostText('gpt-image-2-vip')).toBe('HUHN 0.09')
    expect(getFixedImageModelUnitCostText('gpt-image-2-4k')).toBe('HUHN 0.09')
    expect(getFixedImageModelUnitCostText('Nano-Banana-2')).toBe('HUHN 0.09')
    expect(getFixedImageModelUnitCostText('Nano-Banana-Pro')).toBe('HUHN 0.15')
    expect(getFixedImageRequestModel(GPT_IMAGE_2_VIP_MODEL)).toBe('gpt-image-2-4k')
    expect(getFixedImageRequestModel('gpt-image-2-vip')).toBe('gpt-image-2-4k')
    expect(getFixedImageRequestModel('gpt-image-2-4k')).toBe('gpt-image-2-4k')
    expect(getBananaPricedImageModel('nano-banana-pro')).toBe('nano-banana-pro')
    expect(normalizeImageModelForProfile('nano-banana-pro', LOCKED_WENYUN_PROFILE_ID)).toBe('Nano-Banana-Pro')
    expect(normalizeImageModelForProfile('NANO-BANANA-2', LOCKED_WENYUN_PROFILE_ID)).toBe('Nano-Banana-2')
  })

})

// 固定站点仍需检查密钥隔离和备份兼容，移除的只是任意服务商配置能力。
describe('固定站点约束', () => {
  it('配置归一后只保留文运站和公益站', () => {
    const settings = normalizeSettings({ profiles: [{ id: 'custom', provider: 'custom', baseUrl: 'https://other.example/v1' }] })
    expect(settings.profiles.map((p) => p.id)).toEqual([LOCKED_WENYUN_PROFILE_ID, LOCKED_PUBLIC_PROFILE_ID])
    expect(settings.profiles.map((p) => p.baseUrl)).toEqual(['https://api.zzlye.xyz/v1', 'https://1520635.xyz:3901/v1'])
  })

  it('两个站点分别保存密钥和模型，切换时不混用', () => {
    const settings = normalizeSettings({
      profiles: DEFAULT_SETTINGS.profiles.map((p) => ({ ...p, apiKey: p.id, model: p.id === LOCKED_PUBLIC_PROFILE_ID ? 'Nano-Banana-Pro' : 'gpt-image-2' })),
      activeProfileId: LOCKED_PUBLIC_PROFILE_ID,
    })
    expect(getActiveApiProfile(settings)).toMatchObject({ id: LOCKED_PUBLIC_PROFILE_ID, apiKey: LOCKED_PUBLIC_PROFILE_ID, model: 'Nano-Banana-Pro' })
    expect(settings.profiles[0].apiKey).toBe(LOCKED_WENYUN_PROFILE_ID)
  })

  it('首次导入旧备份仍能恢复固定站点密钥', () => {
    const restored = mergeImportedSettings(DEFAULT_SETTINGS, {
      profiles: DEFAULT_SETTINGS.profiles.map((p) => ({ ...p, apiKey: p.id + '-backup' })),
    })
    expect(restored.profiles.map((p) => p.apiKey)).toEqual(['wenyun-site-backup', 'public-site-backup'])
  })
})
