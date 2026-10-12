import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { callImageApi } from './api'
import { callAgentResponsesApi, callBatchImageSingle } from './agentApi'
import { DEFAULT_SETTINGS, createDefaultOpenAIProfile, normalizeSettings } from './apiProfiles'
import * as canvasImage from './canvasImage'
import { FIXED_IMAGE_MODEL_OPTIONS, supportsTransparentImageBackground } from './modelPricing'
import { normalizeParamsForSettings } from './paramCompatibility'

const models = FIXED_IMAGE_MODEL_OPTIONS.map(option => option.value).filter(model => model.startsWith('gpt-image-'))
const fullModels = models.filter(supportsTransparentImageBackground)
const reference = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
// 使用像素内容不同的红、绿、蓝三张图，检查顺序而非仅检查附件数量。
const orderedReferences = [
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAEAQH/cetH5QAAAABJRU5ErkJggg==',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==',
].map(base64 => `data:image/png;base64,${base64}`)
const originalFetch = globalThis.fetch
const settingsFor = (model: string, profileId = 'wenyun-site') => normalizeSettings({ ...DEFAULT_SETTINGS, activeProfileId: profileId,
  profiles: DEFAULT_SETTINGS.profiles.map(profile => ({ ...profile, model, apiKey: 'test-only' })) })

function mockImages() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.startsWith('data:')) return originalFetch(input, init)
    if (url.startsWith('/image-tasks?')) return new Response(JSON.stringify({ taskId: 'params-task', accessToken: 'params-token', status: 'pending' }), { status: 202 })
    if (url === '/image-tasks/params-task') return new Response(JSON.stringify({ taskId: 'params-task', status: 'succeeded' }))
    return new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), { headers: { 'Content-Type': 'application/json' } })
  })
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('图片完整参数链路审计', () => {
  const cases = models.flatMap(model => DEFAULT_SETTINGS.profiles.flatMap(profile => [false, true].flatMap(edit =>
    (profile.id === 'wenyun-site' ? [false, true] : [false]).map(asyncTask => ({ model, profileId: profile.id, edit, asyncTask })),
  )))

  it.each(cases)('$model $profileId edit=$edit task=$asyncTask 保留完整参数及参考图顺序', async ({ model, profileId, edit, asyncTask }) => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
    const mock = mockImages()
    const settings = settingsFor(model, profileId)
    const params = normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality: 'high', moderation: 'low', n: 2, size: '2160x3840' }, settings, { hasInputImages: edit })
    const prompt = '按图一、图二、图三的顺序组合主体'
    await callImageApi({ settings, prompt, params, inputImageDataUrls: edit ? orderedReferences : [],
      ...(asyncTask ? { imageTask: { taskId: '', accessToken: '', idempotencyKey: 'params-audit' } } : {}),
    })
    const calls = mock.mock.calls.filter(([input]) => String(input).includes(asyncTask ? '/image-tasks?' : '/images/'))
    expect(calls).toHaveLength(1)
    const body = calls[0][1]?.body
    const expected = { model, prompt, size: params.size, quality: 'high', output_format: 'png', moderation: 'low', n: 2 }
    if (edit) {
      const form = body as FormData
      for (const [field, value] of Object.entries(expected)) expect(form.get(field), field).toBe(String(value))
      const images = form.getAll('image[]') as File[]
      expect(images.map(file => file.name)).toEqual(['input-1.png', 'input-2.png', 'input-3.png'])
      for (const [index, image] of images.entries()) expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array(await (await originalFetch(orderedReferences[index])).arrayBuffer()))
    } else {
      expect(JSON.parse(String(body))).toMatchObject(expected)
    }
  })

  it.each(models.flatMap(model => [false, true].flatMap(edit => (['png', 'jpeg', 'webp'] as const).map(format => ({ model, edit, format })))))('$model edit=$edit 保留 $format 输出参数', async ({ model, edit, format }) => {
    const mock = mockImages()
    // 此处直接验证序列化器；当前产品提交前仍按既有设置固定为 PNG。
    await callImageApi({ settings: settingsFor(model), prompt: '图片', params: { ...DEFAULT_PARAMS, output_format: format, output_compression: 83 }, inputImageDataUrls: edit ? [reference] : [] })
    const body = mock.mock.calls.find(([input]) => String(input).includes('/images/'))![1]?.body
    if (edit) {
      expect((body as FormData).get('output_format')).toBe(format)
      expect((body as FormData).get('output_compression')).toBe(format === 'png' ? null : '83')
    } else {
      expect(JSON.parse(String(body))).toMatchObject({ output_format: format })
      expect(JSON.parse(String(body)).output_compression).toBe(format === 'png' ? undefined : 83)
    }
  })

  it.each(FIXED_IMAGE_MODEL_OPTIONS.map(option => option.value).filter(model => !supportsTransparentImageBackground(model)))('%s 未开放遮罩时在请求前明确报错', async model => {
    const mock = mockImages()
    await expect(callImageApi({ settings: settingsFor(model), prompt: '仅修改遮罩区域', params: DEFAULT_PARAMS, inputImageDataUrls: [reference], maskDataUrl: reference })).rejects.toThrow(/遮罩/)
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺少遮罩主图时不会退化成付费文生图', async () => {
    const mock = mockImages()
    await expect(callImageApi({ settings: settingsFor(fullModels[0]), prompt: '局部修改', params: DEFAULT_PARAMS, inputImageDataUrls: [], maskDataUrl: reference })).rejects.toThrow(/主图/)
    expect(mock).not.toHaveBeenCalled()
  })

  it.each(fullModels)('%s 已开放遮罩时保留遮罩和参考图', async model => {
    const mock = mockImages()
    // 仅替代浏览器的像素转换，实际请求构造和文件序列化仍走生产逻辑。
    vi.spyOn(canvasImage, 'imageDataUrlToPngBlob').mockResolvedValue(new Blob(['converted-main'], { type: 'image/png' }))
    await callImageApi({ settings: settingsFor(model), prompt: '局部修改', params: { ...DEFAULT_PARAMS, background: 'transparent' }, inputImageDataUrls: [reference, reference], maskDataUrl: reference })
    const form = mock.mock.calls.find(([url]) => String(url).includes('/images/edits'))![1]?.body as FormData
    expect(form.get('background')).toBe('transparent')
    expect(form.get('output_format')).toBe('png')
    expect(await (form.get('mask') as File).arrayBuffer()).toEqual(await (await originalFetch(reference)).arrayBuffer())
    expect(form.getAll('image[]')).toHaveLength(2)
    expect(await (form.getAll('image[]')[0] as File).text()).toBe('converted-main')
  })

  it.each(['agent', 'batch'].flatMap(mode => (['auto', 'opaque', 'transparent', undefined] as const).map(background => ({ mode, background }))))('$mode 保留背景参数 $background', async ({ mode, background }) => {
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'params-response', output: [{ type: 'image_generation_call', id: 'params-image', result: 'aW1hZ2U=' }] }), { headers: { 'Content-Type': 'application/json' } }))
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-only' })
    const params = { ...DEFAULT_PARAMS, background, quality: 'high' as const, moderation: 'low' as const, size: '2160x3840' }
    if (mode === 'agent') await callAgentResponsesApi({ settings: DEFAULT_SETTINGS, profile, params, input: '透明贴纸' })
    else await callBatchImageSingle({ profile, params, batchItemId: 'params-item', prompt: '透明贴纸', referenceImageDataUrls: [] })
    const tool = JSON.parse(String(mock.mock.calls[0][1]?.body)).tools[0]
    expect(tool).toMatchObject({ quality: 'high', moderation: 'low', size: '2160x3840', output_format: 'png' })
    expect(tool.background).toBe(background)
  })
})
