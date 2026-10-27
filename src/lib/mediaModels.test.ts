import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMediaModelCatalog, groupMediaModels, parseMediaModelCatalog } from './mediaModels'

afterEach(() => vi.restoreAllMocks())

describe('媒体 Key 模型目录', () => {
  it('图片只保留当前 Key 的精确路由权限，视频不混入图片或聊天', () => {
    const catalog = parseMediaModelCatalog({ data: [
      { id: 'gpt-image-2.5-flare-官渠' }, { id: 'nano-banana-2' }, { id: 'gpt-5' },
      { id: 'sd2.5-720p' }, { id: 'custom-film', supported_endpoint_types: ['openai-video'] },
    ] })
    expect(catalog.images.map(item => item.value)).toEqual(['gpt-image-2.5-flare-官渠', 'Nano-Banana-2'])
    expect(catalog.videos.map(item => item.value)).toEqual(['custom-film', 'sd2.5-720p'])
    expect(catalog.images.some(item => item.value.endsWith('满血'))).toBe(false)
  })

  it('只按后台分组分类，未取得分组的模型不猜测品牌分类', () => {
    const groups = groupMediaModels([
      { value: 'gpt-image-2', label: 'gpt-image-2', group: '我的图片组', ratio: 4 },
      { value: 'gpt-image-2.5-flare-官渠', label: 'gpt-image-2.5-flare-官渠', group: '我的图片组', ratio: 4 },
      { value: 'nano-banana-2', label: 'Nano Banana 2', group: '自定义香蕉渠道', ratio: 2 },
      { value: 'sd-2.0-720p', label: 'sd-2.0-720p' },
    ])
    expect(groups.map(group => group.label)).toEqual(['我的图片组', '自定义香蕉渠道'])
    expect(groups[0].models[1].value).toBe('gpt-image-2.5-flare-官渠')
    expect(groupMediaModels([{ value: 'gpt-image-2', label: 'gpt-image-2' }])).toEqual([])
  })

  it('无权限的空列表不回退到全部模型', () => {
    expect(parseMediaModelCatalog({ data: [] })).toEqual({ images: [], videos: [] })
  })

  it('业务错误和格式错误不能伪装成成功的模型目录', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ success: false, message: 'denied' })))
      .mockResolvedValueOnce(new Response('{}'))
    await expect(fetchMediaModelCatalog('https://api.xn--v5z30ywuk.com/v1', 'test-key', false)).rejects.toThrow('获取模型失败')
    await expect(fetchMediaModelCatalog('https://api.xn--v5z30ywuk.com/v1', 'test-key', false)).rejects.toThrow('模型列表格式不正确')
  })
})
