import { getFixedImageRequestModel } from './modelPricing'
import { calculateImageSize, parseRatio, type SizeTier } from './size'

export type BananaSizeTier = '512px' | SizeTier
export type BananaSizePreset = { tier: BananaSizeTier; ratio: string; size: string }

// 官方尺寸表：https://ai.google.dev/gemini-api/docs/image-generation#aspect_ratios_and_image_size
// 香蕉的像素档位独立于 OpenAI，不能经过通用的边长、总像素或 3:1 限制。
const PRO_SIZES: Record<string, readonly [string, string, string]> = {
  '1:1': ['1024x1024', '2048x2048', '4096x4096'],
  '3:2': ['1264x848', '2528x1696', '5056x3392'],
  '2:3': ['848x1264', '1696x2528', '3392x5056'],
  '16:9': ['1376x768', '2752x1536', '5504x3072'],
  '9:16': ['768x1376', '1536x2752', '3072x5504'],
  '4:3': ['1200x896', '2400x1792', '4800x3584'],
  '3:4': ['896x1200', '1792x2400', '3584x4800'],
  '4:5': ['928x1152', '1856x2304', '3712x4608'],
  '5:4': ['1152x928', '2304x1856', '4608x3712'],
  '21:9': ['1584x672', '3168x1344', '6336x2688'],
}

// 512px 按官方表逐项保留，不从高档位等比推算。
const FLASH_SMALL_SIZES: Record<string, string> = {
  '1:1': '512x512', '3:2': '632x424', '2:3': '424x632',
  '16:9': '688x384', '9:16': '384x688', '4:3': '600x448',
  '3:4': '448x600', '4:5': '464x576', '5:4': '576x464',
  '21:9': '792x168', '1:4': '256x1024', '4:1': '1024x256',
  '1:8': '192x1536', '8:1': '1536x192',
}
const FLASH_SIZES = {
  ...PRO_SIZES,
  '1:4': ['512x2048', '1024x4096', '2048x8192'],
  '4:1': ['2048x512', '4096x1024', '8192x2048'],
  '1:8': ['384x3072', '768x6144', '1536x12288'],
  '8:1': ['3072x384', '6144x768', '12288x1536'],
} satisfies Record<string, readonly [string, string, string]>

function createPresets(sizes: typeof PRO_SIZES, smallSizes?: Record<string, string>): BananaSizePreset[] {
  return Object.entries(sizes).flatMap(([ratio, values]) => [
    ...(smallSizes ? [{ tier: '512px' as const, ratio, size: smallSizes[ratio] }] : []),
    ...(['1K', '2K', '4K'] as const).map((tier, index) => ({ tier, ratio, size: values[index] })),
  ])
}

const PRO_CONFIG = {
  tiers: ['1K', '2K', '4K'] as BananaSizeTier[],
  ratios: Object.keys(PRO_SIZES),
  presets: createPresets(PRO_SIZES),
}
const FLASH_CONFIG = {
  tiers: ['512px', '1K', '2K', '4K'] as BananaSizeTier[],
  ratios: Object.keys(FLASH_SIZES),
  presets: createPresets(FLASH_SIZES, FLASH_SMALL_SIZES),
}

export function getBananaSizeConfig(model: string) {
  const normalized = getFixedImageRequestModel(model).toLowerCase()
  if (normalized === 'nano-banana-2' || /^gemini-3\.1-flash-image(?:-preview)?$/.test(normalized)) return FLASH_CONFIG
  if (normalized === 'nano-banana-pro' || /^gemini-3-pro-image(?:-preview)?$/.test(normalized)) return PRO_CONFIG
  return null
}

function canonicalSize(size: string) {
  const parsed = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/.exec(size)
  return parsed ? `${Number(parsed[1])}x${Number(parsed[2])}` : size.trim()
}

export function findBananaSizePreset(model: string, size: string): BananaSizePreset | null {
  return getBananaSizeConfig(model)?.presets.find((preset) => preset.size === canonicalSize(size)) ?? null
}

// 文运切换模型和读取旧任务时保留原档位、选择最接近的合法比例；精确匹配优先于像素推断。
export function resolveBananaSizePreset(model: string, size: string): BananaSizePreset | null {
  const config = getBananaSizeConfig(model)
  if (!config) return null
  const normalized = canonicalSize(size)
  const exact = config.presets.find((preset) => preset.size === normalized)
  if (exact) return exact

  const previous = FLASH_CONFIG.presets.find((preset) => preset.size === normalized)
  const parsed = parseRatio(previous?.ratio ?? normalized)
  if (!parsed) return config.presets.find((preset) => preset.tier === '1K' && preset.ratio === '1:1')!

  let tier: BananaSizeTier = previous?.tier ?? '1K'
  if (!previous && /^\d+x\d+$/.test(normalized)) {
    // 旧文运使用通用尺寸表；先识别档位，避免 2880 方图或超宽 1K 被误判。
    const legacy = (['1K', '2K', '4K'] as const).find((item) =>
      config.ratios.some((ratio) => calculateImageSize(item, ratio) === normalized),
    )
    const pixels = parsed.width * parsed.height
    tier = legacy ?? (pixels < 600_000 ? '512px' : pixels > 4_500_000 ? '4K' : pixels > 1_800_000 ? '2K' : '1K')
  }
  if (!config.tiers.includes(tier)) tier = '1K'
  const targetRatio = parsed.width / parsed.height
  const ratio = [...config.ratios].sort((left, right) => {
    const ratioDistance = (value: string) => {
      const [width, height] = value.split(':').map(Number)
      return Math.abs(Math.log((width / height) / targetRatio))
    }
    return ratioDistance(left) - ratioDistance(right)
  })[0]
  return config.presets.find((preset) => preset.tier === tier && preset.ratio === ratio)!
}
