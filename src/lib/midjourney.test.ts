import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { buildMidjourneyRequest, MIDJOURNEY_RATIOS, normalizeMidjourneyRatio, readMidjourneyConfig, readMidjourneyResponse, readMidjourneyTask } from './midjourney'
import { FIXED_IMAGE_MODEL_OPTIONS } from './modelPricing'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { normalizeParamsForSettings } from './paramCompatibility'

describe('Midjourney 文档参数与结果', () => {
  it('完整生图参数保持数值和布尔类型，零权重不丢失且不发送后续动作', () => {
    const midjourney = { raw: false, hd: true, tile: false, quality: 0.25 as const, seed: 0, negative_prompt: '模糊，文字', stylize: 0, chaos: 0, weird: 3000, iw: 0, cref: 'https://example.com/character.png', cw: 0, sref: 'https://example.com/style.png', sw: 1000, dref: 'https://example.com/depth.png', dw: 100 }
    expect(buildMidjourneyRequest('mj-v8.2', '完整参数', { ...DEFAULT_PARAMS, midjourney }, ['https://example.com/input.png'])).toEqual({ ...midjourney, model: 'mj-v8.2', prompt: '完整参数', size: '1:1', n: 1, image: 'https://example.com/input.png' })
    expect(readMidjourneyConfig({ mjParameters: JSON.stringify(midjourney), mjRaw: 'true' })).toEqual(midjourney)
    expect(readMidjourneyConfig({ mjRaw: 'true' })).toEqual({ raw: true })
  })

  it.each([0.25, 0.5, 1, 2] as const)('MJ 数值品质 %s 不被 GPT Image 字符串品质覆盖', quality => {
    expect(buildMidjourneyRequest('mj-v8.2', '提示', { ...DEFAULT_PARAMS, quality: 'high', midjourney: { quality } }, []).quality).toBe(quality)
  })

  it('提示词按字符校验，不静默截断，未提供参考图时不发送权重', () => {
    expect(() => buildMidjourneyRequest('mj-v8.2', '😀'.repeat(1023), DEFAULT_PARAMS, [])).not.toThrow()
    expect(() => buildMidjourneyRequest('mj-v8.2', '😀'.repeat(1024), DEFAULT_PARAMS, [])).toThrow('1023')
    const body = buildMidjourneyRequest('mj-v8.2', '提示', { ...DEFAULT_PARAMS, midjourney: { iw: 1, cw: 10, sw: 50, dw: 10 } }, [])
    expect(body).not.toHaveProperty('iw')
    expect(body).not.toHaveProperty('cw')
    expect(body).not.toHaveProperty('sw')
    expect(body).not.toHaveProperty('dw')
    expect(buildMidjourneyRequest('mj-v8.2', '提示', { ...DEFAULT_PARAMS, midjourney: { cref: ' ', cw: 0 } }, [])).not.toHaveProperty('cw')
  })

  it.each([{ stylize: 1001 }, { chaos: -1 }, { weird: 3001 }, { iw: 4 }, { cw: 101 }, { sw: 1001 }, { dw: 101 }, { quality: '2' }, { seed: 1.2 }, { hd: 'true' }, { sref: 'file:///private.png' }])('拒绝站内文档范围外参数 %j', midjourney => {
    expect(() => buildMidjourneyRequest('mj-v8.2', '提示', { ...DEFAULT_PARAMS, midjourney: midjourney as never }, [])).toThrow()
  })

  it('混合包装兼容顶层任务号状态、嵌套错误和结果过期标志', () => {
    expect(readMidjourneyTask({ task_id: 'outer', status: 'succeeded', result_expired: true, data: { image_urls: ['https://example.com/1.png'] } })).toMatchObject({ taskId: 'outer', status: 'succeeded', resultExpired: true })
    expect(readMidjourneyTask({ status: 'error', data: { error: { message: '生成被拒绝' } } })).toMatchObject({ status: 'error', error: '生成被拒绝' })
  })
  it('mj-v8.2 保留本站模型名、原提示词、Raw false，并且仅提交一次', () => {
    const model = 'mj-v8.2'
    const request = buildMidjourneyRequest(model, '原提示词 --stylize 200', { ...DEFAULT_PARAMS, size: '16:9', n: 4, quality: 'high' }, [])
    expect(request).toEqual({ model, prompt: '原提示词 --stylize 200', size: '16:9', raw: false, n: 1 })
    expect(FIXED_IMAGE_MODEL_OPTIONS.some(option => option.value === model)).toBe(true)
  })

  it.each(MIDJOURNEY_RATIOS)('比例 %s 原样保留', ratio => {
    expect(normalizeMidjourneyRatio(ratio)).toBe(ratio)
    const settings = { ...DEFAULT_SETTINGS, model: 'mj-v8.2', profiles: DEFAULT_SETTINGS.profiles.map(profile => ({ ...profile, model: 'mj-v8.2' })) }
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: ratio, n: 4 }, settings)).toMatchObject({ size: ratio, n: 1 })
  })

  it('旧像素参数恢复比例，单参考图走 image，多参考图走 images 并保持顺序', () => {
    expect(normalizeMidjourneyRatio('1920x1080')).toBe('16:9')
    const references = ['https://example.com/a.jpg', 'data:image/png;base64,Yg==']
    expect(buildMidjourneyRequest('mj-v8.2', '提示', DEFAULT_PARAMS, references.slice(0, 1))).toMatchObject({ image: references[0] })
    const multiple = buildMidjourneyRequest('mj-v8.2', '提示', DEFAULT_PARAMS, references)
    expect(multiple.images).toEqual(references)
    expect(multiple).not.toHaveProperty('image')
  })

  it('已移除模型不出现在选项中，提交时也会被拒绝', () => {
    expect(FIXED_IMAGE_MODEL_OPTIONS.some(option => option.value === 'mj-niji7')).toBe(false)
    expect(() => buildMidjourneyRequest('mj-niji7', '提示', DEFAULT_PARAMS, [])).toThrow('不支持的 Midjourney 模型')
  })

  it('超限和遮罩在提交前明确拒绝，不截断素材', () => {
    expect(() => buildMidjourneyRequest('mj-v8.2', '提示', DEFAULT_PARAMS, Array(6).fill('https://example.com/ref.png'))).toThrow('最多支持 5 张')
    expect(() => buildMidjourneyRequest('mj-v8.2', '提示', DEFAULT_PARAMS, [], 'mask')).toThrow('不支持遮罩')
  })

  it.each([3, 4])('读取实际 %s 张结果，不把四宫格封面当成额外单图', count => {
    const images = Array.from({ length: count }, (_, index) => `https://example.com/${index}.png`)
    const task = readMidjourneyTask({ data: { task_id: 'task-1', status: 'completed', result: { data: { image_urls: images, grid_image_url: 'https://example.com/grid.png' } } } })
    expect(task).toMatchObject({ taskId: 'task-1', status: 'completed', images })
  })

  it('相对结果地址保留完整签名，忽略非图片协议及四宫格封面', () => {
    const signed = '/task-media/task/media/0?expires=123&signature=a%2Fb%2Bc%3D&name=image+one'
    const task = readMidjourneyTask({ status: 'succeeded', result: { data: { image_urls: [signed, 'task-media/one.png', 'https://cdn.example.com/two.png', 'data:image/png;base64,YQ==', 'javascript:alert(1)', 'file:///tmp/image.png', null, ''], grid_image_url: '/grid.png' } } }, '', 'https://api.example.com/v1')
    expect(task.images).toEqual([`https://api.example.com${signed}`, 'https://api.example.com/v1/task-media/one.png', 'https://cdn.example.com/two.png', 'data:image/png;base64,YQ=='])
    expect(readMidjourneyTask({ image_urls: [signed] }).images).toEqual([])
  })

  it('允许响应头受理 ID、读取失败终态，并拒绝非 JSON 响应', async () => {
    expect(readMidjourneyTask(await readMidjourneyResponse(new Response(null)), 'header-task').taskId).toBe('header-task')
    expect(readMidjourneyTask({ data: { status: 'failed', error_code: 408, error_message: '上游超时' } })).toMatchObject({ status: 'failed', error: '上游超时' })
    await expect(readMidjourneyResponse(new Response('<html>error</html>', { status: 502 }))).rejects.toThrow('无效响应')
  })
})
