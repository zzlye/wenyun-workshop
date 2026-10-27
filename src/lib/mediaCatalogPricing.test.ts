import { describe, expect, it } from 'vitest'
import { applyMediaCatalogMetadata, buildMediaBilling, parseMediaCatalogMetadata } from './mediaCatalogPricing'
import { parseMediaModelCatalog, groupMediaModels } from './mediaModels'
import { getFixedImageRequestModel, normalizeFixedImageModel } from './modelPricing'

const status = { quota_display_type: 'CUSTOM', custom_currency_symbol: 'HUHN', custom_currency_exchange_rate: 1 }
const expression = 'tier("base", p * 5 + c * 10 + cr * 1.25 + img * 8 + img_o * 30 + img_cr * 2)'

describe('媒体分类和实际倍率报价', () => {
  it('同一模型属于多个授权组时，每个组都保留，不能只显示第一组', () => {
    const metadata = parseMediaCatalogMetadata({ groups: ['1k-image', 'adobe-image', '官key-image'], group_ratio: { '1k-image': 1, 'adobe-image': 2, '官key-image': 4.6 }, status,
      data: [{ model_name: 'gpt-image-2', quota_type: 1, model_price: .02, enable_groups: ['1k-image', 'adobe-image'] }, { model_name: '官-gpt-image-2', quota_type: 1, model_price: .1, enable_groups: ['官key-image'] }] })!
    const result = applyMediaCatalogMetadata(parseMediaModelCatalog({ data: [{ id: 'gpt-image-2' }, { id: '官-gpt-image-2' }] }), metadata)
    expect(groupMediaModels(result.images).map(group => group.label)).toEqual(['1k-image', 'adobe-image', '官key-image'])
    expect(result.images.filter(item => item.value === 'gpt-image-2')).toHaveLength(2)
    expect(result.images.find(item => item.group === 'adobe-image')?.ratio).toBe(2)
  })
  it('动态渠道模型原样保存、原样提交，不替换成默认图片模型', () => {
    for (const model of ['AZ-gpt-image-2.5-flare', '官-gpt-image-2', '官-gpt-image-2.5-sunburst']) {
      expect(normalizeFixedImageModel(model)).toBe(model)
      expect(getFixedImageRequestModel(model)).toBe(model)
      expect(parseMediaModelCatalog({ data: [{ id: model, supported_endpoint_types: ['image-generation'] }] }).images[0].value).toBe(model)
    }
  })
  it('按次计费乘分组倍率，零倍率可免费，缺倍率不能伪装免费', () => {
    const row = { quota_type: 1, model_price: 0.02 }
    expect(buildMediaBilling(row, 4, status).summary).toBe('HUHN 0.08 / 次')
    expect(buildMediaBilling(row, 0, status).summary).toBe('HUHN 0 / 次')
    expect(buildMediaBilling(row, undefined, status).summary).toBe('暂无价格')
  })
  it('AZ与官渠逐项显示含倍率的Token价，不误报固定单张价', () => {
    const row = { quota_type: 0, billing_mode: 'tiered_expr', billing_expr: expression }
    const az = buildMediaBilling(row, 3.6, status)
    expect(az.summary).toBe('按 Token 用量计费')
    expect(az.lines).toContainEqual({ label: '图片输出', text: 'HUHN 108 / 百万 Token' })
    expect(buildMediaBilling(row, 4.6, status).lines).toContainEqual({ label: '图片输出', text: 'HUHN 138 / 百万 Token' })
    expect(buildMediaBilling({ ...row, billing_expr: 'p > 100 ? tier("a", p*5) : tier("b", p*3)' }, 4.6, status)).toEqual({ summary: '按参数计费', lines: [] })
  })
  it('视频分辨率价格保留单位并乘实际分组倍率', () => {
    const row = { billing_mode: 'per_second', billing_expr: 'param("resolution") == "1080p" ? .93 : param("resolution") == "720p" ? .48 : .27' }
    expect(buildMediaBilling(row, 2, status).lines).toContainEqual({ label: '720p', text: 'HUHN 0.96 / 秒' })
  })
  it('只列Key授权组，按后台顺序分类，不展示其他账号分组', () => {
    const metadata = parseMediaCatalogMetadata({ groups: ['az-image', 'adobe-image'], group_ratio: { 'az-image': 3.6, 'adobe-image': 4 }, status,
      data: [{ model_name: 'gpt-image-2', quota_type: 1, model_price: .02, enable_groups: ['default', 'adobe-image'] },
        { model_name: 'AZ-gpt-image-2.5-flare', billing_mode: 'tiered_expr', billing_expr: expression, enable_groups: ['az-image'] }] })!
    const result = applyMediaCatalogMetadata(parseMediaModelCatalog({ data: [{ id: 'gpt-image-2' }, { id: 'AZ-gpt-image-2.5-flare' }, { id: 'gpt-image-2-4k' }] }), metadata)
    expect(groupMediaModels(result.images).map(group => [group.label, group.ratio])).toEqual([['az-image', 3.6], ['adobe-image', 4]])
    expect(result.images).toHaveLength(2)
    expect(result.images[1].billing?.summary).toBe('HUHN 0.08 / 次')
  })
  it('同模型跨组价不一致时不承诺第一组单价', () => {
    const metadata = parseMediaCatalogMetadata({ groups: ['a', 'b'], group_ratio: { a: 1, b: 2 }, status,
      data: [{ model_name: 'gpt-image-2', quota_type: 1, model_price: 1, enable_groups: ['a', 'b'] }] })!
    const result = applyMediaCatalogMetadata(parseMediaModelCatalog({ data: [{ id: 'gpt-image-2' }] }), metadata)
    expect(result.images[0].billing?.summary).toBe('按实际分组计费')
  })
})
