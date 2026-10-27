import type { MediaModelCatalog, ModelOption } from './mediaModels'
import { readResolutionPrices } from './videoModelCatalog'

export type MediaBilling = { summary: string; lines: { label: string; text: string }[] }
export type MediaCatalogMetadata = { groups: string[]; group_ratio: Record<string, number>; data: Record<string, unknown>[]; status: Record<string, unknown> }
export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

export function parseMediaCatalogMetadata(value: unknown): MediaCatalogMetadata | undefined {
  const source = record(value)
  if (!Array.isArray(source.groups) || !Array.isArray(source.data)) return undefined
  const ratios: Record<string, number> = {}
  for (const [key, value] of Object.entries(record(source.group_ratio))) {
    const ratio = number(value)
    if (ratio !== undefined) ratios[key] = ratio
  }
  return { groups: [...new Set(source.groups.filter((item): item is string => typeof item === 'string' && Boolean(item)))],
    group_ratio: ratios, data: source.data.map(record), status: record(source.status) }
}

function money(value: number, status: Record<string, unknown>): string | undefined {
  const mode = status.quota_display_type
  const symbol = mode === 'CUSTOM' ? status.custom_currency_symbol : mode === 'CNY' ? '¥' : mode === 'USD' ? 'USD' : undefined
  const exchange = mode === 'CUSTOM' ? number(status.custom_currency_exchange_rate) : mode === 'CNY' ? number(status.usd_exchange_rate) : mode === 'USD' ? 1 : undefined
  if (typeof symbol !== 'string' || !symbol || exchange === undefined || exchange <= 0 || !Number.isFinite(value * exchange)) return undefined
  return `${symbol} ${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 8 }).format(value * exchange)}`
}

const TOKEN_LABELS: Record<string, string> = { p: '文本输入', c: '文本输出', cr: '文本缓存读取', cc: '缓存写入', cc1h: '一小时缓存写入', img: '图片输入', img_o: '图片输出', img_cr: '图片缓存读取', ai: '音频输入', ao: '音频输出' }

export function buildMediaBilling(row: Record<string, unknown>, ratio: number | undefined, status: Record<string, unknown>): MediaBilling {
  if (ratio === undefined) return { summary: '暂无价格', lines: [] }
  const mode = row.billing_mode
  const expression = typeof row.billing_expr === 'string' ? row.billing_expr.trim() : ''
  if (Array.isArray(row.billing_plugin_variants) && row.billing_plugin_variants.length) return { summary: '按参数计费', lines: [] }
  if (mode === 'tiered_expr') {
    // 只读取可完整识别的线性单档 Token 单价，不执行后台表达式，也不猜测条件分支。
    const matched = expression.length < 8192 && expression.match(/^tier\(\s*"[^"\\]*"\s*,\s*([^()]+)\)$/)
    if (!matched) return { summary: '按参数计费', lines: [] }
    const lines: MediaBilling['lines'] = []
    const seen = new Set<string>()
    for (const part of matched[1].split('+')) {
      const term = part.trim().match(/^([a-z][a-z0-9_]*)\s*\*\s*(\d+(?:\.\d+)?|\.\d+)$/)
      if (!term || !TOKEN_LABELS[term[1]] || seen.has(term[1])) return { summary: '按参数计费', lines: [] }
      const amount = money(Number(term[2]) * ratio, status)
      if (!amount) return { summary: '暂无价格', lines: [] }
      seen.add(term[1])
      lines.push({ label: TOKEN_LABELS[term[1]], text: `${amount} / 百万 Token` })
    }
    return { summary: '按 Token 用量计费', lines }
  }
  if (expression) {
    const tiers = mode === 'per_second' || mode === 'per_request' ? readResolutionPrices(expression) : null
    if (!tiers) return { summary: '按参数计费', lines: [] }
    const lines = tiers.map(tier => ({ label: tier.label, text: money(tier.price * ratio, status) }))
    if (lines.some(line => !line.text)) return { summary: '暂无价格', lines: [] }
    return { summary: '按分辨率计费', lines: lines.map(line => ({ label: line.label, text: `${line.text} / ${mode === 'per_second' ? '秒' : '次'}` })) }
  }
  if (mode && !['ratio', 'per_request', 'per_second'].includes(String(mode))) return { summary: '按参数计费', lines: [] }
  if (row.quota_type === 0) {
    const input = number(row.model_ratio)
    const completion = number(row.completion_ratio)
    const lines: MediaBilling['lines'] = []
    if (input !== undefined) {
      const amount = money(input * 2 * ratio, status)
      if (amount) lines.push({ label: '输入', text: `${amount} / 百万 Token` })
      if (completion !== undefined) {
        const output = money(input * 2 * completion * ratio, status)
        if (output) lines.push({ label: '输出', text: `${output} / 百万 Token` })
      }
    }
    return { summary: '按 Token 用量计费', lines }
  }
  const price = number(row.model_price)
  if (row.quota_type !== 1 || price === undefined) return { summary: '暂无价格', lines: [] }
  const amount = money(price * ratio, status)
  return { summary: amount ? `${amount} / ${mode === 'per_second' ? '秒' : '次'}` : '暂无价格', lines: [] }
}

export function applyMediaCatalogMetadata(catalog: MediaModelCatalog, metadata: MediaCatalogMetadata): MediaModelCatalog {
  const pricing = new Map(metadata.data.map(row => [String(row.model_name).toLowerCase(), row]))
  const decorate = (options: ModelOption[]) => options.flatMap(option => {
    const row = pricing.get(option.value.toLowerCase())
    const enabled = row?.enable_groups
    if (!row || !Array.isArray(enabled)) return []
    const groups = metadata.groups.filter(group => enabled.includes(group) || enabled.includes('all'))
    if (!groups.length) return []
    const group = groups[0]
    const ratio = metadata.group_ratio[group]
    let billing = buildMediaBilling(row, ratio, metadata.status)
    // 同模型可跨组重试时不能把第一组价格承诺为最终扣费价格。
    if (groups.some(item => metadata.group_ratio[item] !== ratio)) {
      billing = { summary: '按实际分组计费', lines: groups.map(item => ({ label: item, text: buildMediaBilling(row, metadata.group_ratio[item], metadata.status).summary })) }
    }
    return [{ ...option, group, ratio, billing, description: typeof row.description === 'string' ? row.description : undefined }]
  })
  const sorted = (options: ModelOption[]) => decorate(options).sort((a, b) => metadata.groups.indexOf(a.group) - metadata.groups.indexOf(b.group))
  return { ...catalog, images: sorted(catalog.images), videos: sorted(catalog.videos), metadata }
}
