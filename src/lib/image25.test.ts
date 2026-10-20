import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskParams } from '../types'
import { DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { callImageApi } from './api'
import { normalizeParamsForSettings } from './paramCompatibility'
import * as canvasImage from './canvasImage'
import { FIXED_IMAGE_MODEL_OPTIONS, getFixedImageRequestModel, getImageSizeTiersForModel, normalizeFixedImageModel, supportsExtendedImageQuality, supportsTransparentImageBackground } from './modelPricing'

const models = ['gpt-image-2-4k', 'gpt-image-2.5-flare-满血', 'gpt-image-2.5-sunburst-满血', 'gpt-image-2.5-flare-官渠', 'gpt-image-2.5-sunburst-官渠']
const modelQuality = (model: string, extended: 'max' | 'xhigh' = 'max') => model === 'gpt-image-2-4k' ? 'high' as const : extended
const otherModels = ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'Nano-Banana-Pro', 'seedream-5-pro']
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const settingsFor = (model: string) => normalizeSettings({ ...DEFAULT_SETTINGS, profiles: DEFAULT_SETTINGS.profiles.map(profile => ({ ...profile, model, apiKey: 'test-only' })) })
const originalFetch = globalThis.fetch
const mockImages = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => String(input).startsWith('data:') ? originalFetch(input, init) : new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }], background: 'transparent' }), { headers: { 'Content-Type': 'application/json' } }))

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('GPT Image 全参数渠道', () => {
  it.each(models)('%s 原样路由，背景与品质能力独立匹配所属版本', model => {
    expect(FIXED_IMAGE_MODEL_OPTIONS.some(option => option.value === model)).toBe(true)
    expect(normalizeFixedImageModel(model)).toBe(model)
    expect(getFixedImageRequestModel(model)).toBe(model)
    expect(supportsTransparentImageBackground(model)).toBe(true)
    expect(supportsExtendedImageQuality(model)).toBe(model !== 'gpt-image-2-4k')
    expect(getImageSizeTiersForModel(model)).toEqual(['1K', '2K', '4K'])
    expect(normalizeFixedImageModel(model.toUpperCase())).toBe(model)
  })

  it.each(models.flatMap(model => ['auto', 'opaque', 'transparent'].map(background => [model, background])) )('%s 文生图发送背景 %s 和官方字段', async (model, background) => {
    const mock = mockImages()
    const quality = modelQuality(model)
    const result = await callImageApi({ settings: settingsFor(model), prompt: '透明贴纸', params: { ...DEFAULT_PARAMS, quality, size: '3840x2160', background: background as TaskParams['background'] }, inputImageDataUrls: [] })
    const [url, init] = mock.mock.calls[0]
    expect(String(url)).toContain('/images/generations')
    expect(JSON.parse(String(init?.body))).toEqual({ model, prompt: '透明贴纸', size: '3840x2160', quality, background, output_format: 'png', moderation: 'auto', response_format: 'url' })
    expect(result.images[0]).toMatch(/^data:image\/png;base64,/)
    expect(result.actualParams?.background).toBe('transparent')
  })

  it.each(models)('%s 图生图保留背景、支持的品质和 PNG，使用 URL 返回', async model => {
    const mock = mockImages()
    const quality = modelQuality(model, 'xhigh')
    await callImageApi({ settings: settingsFor(model), prompt: '去除背景', params: { ...DEFAULT_PARAMS, quality, background: 'transparent' }, inputImageDataUrls: [png] })
    const [url, init] = mock.mock.calls.find(([url]) => String(url).includes('/images/edits'))!
    expect(String(url)).toContain('/images/edits')
    const form = init?.body as FormData
    expect(form.get('model')).toBe(model)
    expect(form.get('background')).toBe('transparent')
    expect(form.get('output_format')).toBe('png')
    expect(form.get('quality')).toBe(quality)
    expect(form.get('response_format')).toBe('url')
    expect(form.get('image')).toBeInstanceOf(Blob)
  })

  it.each(models.flatMap(model => (['jpeg', 'webp'] as const).map(format => ({ model, format }))))('$model 透明背景输出 $format 按透明通道能力处理', async ({ model, format }) => {
    const mock = mockImages()
    await callImageApi({ settings: settingsFor(model), prompt: '贴纸', params: { ...DEFAULT_PARAMS, background: 'transparent', output_format: format, output_compression: 80 }, inputImageDataUrls: [] })
    const body = JSON.parse(String(mock.mock.calls[0][1]?.body))
    expect(body.output_format).toBe(format === 'jpeg' ? 'png' : 'webp')
    expect(body.output_compression).toBe(format === 'jpeg' ? undefined : 80)
  })

  it.each(['gpt-image-2-4k', 'gpt-image-2-vip', 'gpt-image-2-超分'])('%s 遮罩编辑保留全部字段并按四K路由发送', async model => {
    const mock = mockImages()
    // 这里只替代浏览器像素转换，参数归一、遮罩解码和请求组装均走真实调用链。
    const primaryImage = await canvasImage.dataUrlToBlob(png)
    const convert = vi.spyOn(canvasImage, 'imageDataUrlToPngBlob').mockResolvedValue(primaryImage)
    expect(supportsTransparentImageBackground(model)).toBe(true)
    expect(supportsExtendedImageQuality(model)).toBe(false)
    await callImageApi({
      settings: settingsFor(model), prompt: '仅修改遮罩区域',
      params: { ...DEFAULT_PARAMS, background: 'transparent', quality: 'high', moderation: 'low', size: '2560x1440' },
      inputImageDataUrls: [png], maskDataUrl: png,
    })
    const form = mock.mock.calls.find(([url]) => String(url).includes('/images/edits'))![1]?.body as FormData
    expect(Object.fromEntries(form.entries())).toMatchObject({
      model: 'gpt-image-2-4k', background: 'transparent', quality: 'high', moderation: 'low',
      size: '2560x1440', output_format: 'png', response_format: 'url',
    })
    expect(convert).toHaveBeenCalledWith(png)
    expect(form.get('image')).toBeInstanceOf(Blob)
    const mask = form.get('mask') as Blob
    expect(mask.type).toBe('image/png')
    expect(await mask.arrayBuffer()).toEqual(await primaryImage.arrayBuffer())
  })

  it.each(otherModels)('%s 隐藏背景选项，残留透明参数不会发送', async model => {
    const mock = mockImages()
    expect(supportsTransparentImageBackground(model)).toBe(false)
    const settings = settingsFor(model)
    const params = normalizeParamsForSettings({ ...DEFAULT_PARAMS, background: 'transparent' }, settings)
    expect(params.background).toBeUndefined()
    await callImageApi({ settings, prompt: '测试', params: { ...DEFAULT_PARAMS, background: 'transparent' }, inputImageDataUrls: [] })
    const body = JSON.parse(String(mock.mock.calls[0][1]?.body))
    expect(body).not.toHaveProperty('background')
  })

  it.each(models)('异步任务封装保持 %s 渠道名和透明背景字段', async model => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
    const mock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 'test-task', accessToken: 'test-token', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 'test-task', status: 'succeeded' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), { headers: { 'Content-Type': 'application/json' } }))
    await callImageApi({ settings: settingsFor(model), prompt: '贴纸', params: { ...DEFAULT_PARAMS, quality: 'max', background: 'transparent' }, inputImageDataUrls: [], imageTask: { taskId: '', accessToken: '', idempotencyKey: 'test-idempotency' } })
    expect(mock.mock.calls[0][0]).toBe('/image-tasks?endpoint=%2Fimages%2Fgenerations')
    expect(JSON.parse(String(mock.mock.calls[0][1]?.body))).toMatchObject({ model, quality: model === 'gpt-image-2-4k' ? 'auto' : 'max', background: 'transparent', output_format: 'png', response_format: 'url' })
    expect(mock).toHaveBeenCalledTimes(3)
  })

  it.each(models.flatMap(model =>
    ['1280x720', '2560x1440', '3840x2160'].flatMap(size => [false, true].map(edit => ({ model, size, edit }))),
  ))('$model $size edit=$edit 保留清晰度、品质、审核与多图数量', async ({ model, size, edit }) => {
    const mock = mockImages()
    const settings = settingsFor(model)
    const quality = modelQuality(model)
    const params = normalizeParamsForSettings({ ...DEFAULT_PARAMS, size, quality, moderation: 'low', background: 'transparent', n: 2 }, settings, { hasInputImages: edit })
    expect(params).toMatchObject({ size, quality, moderation: 'low', background: 'transparent', n: 2 })
    await callImageApi({ settings, prompt: '保留全部参数', params, inputImageDataUrls: edit ? [png, png] : [] })
    const [, init] = mock.mock.calls.find(([url]) => String(url).includes('/images/'))!
    const body = edit ? Object.fromEntries((init?.body as FormData).entries()) : JSON.parse(String(init?.body))
    expect(body).toMatchObject({ model, size, quality, moderation: 'low', background: 'transparent', output_format: 'png', response_format: 'url', n: edit ? '2' : 2 })
    if (edit) expect((init?.body as FormData).getAll('image[]')).toHaveLength(2)
  })

  it.each(['gpt-image-2-4k', 'gpt-image-2-vip', 'gpt-image-2-超分'].flatMap(model =>
    (['xhigh', 'max'] as const).flatMap(quality => [false, true].map(edit => ({ model, quality, edit }))),
  ))('$model edit=$edit 清理旧配置和请求入口的非法品质 $quality', async ({ model, quality, edit }) => {
    const mock = mockImages()
    const settings = settingsFor(model)
    const params = { ...DEFAULT_PARAMS, quality, background: 'transparent' as const }
    expect(normalizeParamsForSettings(params, settings).quality).toBe('auto')
    // 故意绕过界面归一，验证历史记录重试和直接请求也无法发送非法品质。
    await callImageApi({ settings, prompt: '透明贴纸', params, inputImageDataUrls: edit ? [png] : [] })
    const [, init] = mock.mock.calls.find(([url]) => String(url).includes('/images/'))!
    const body = edit ? Object.fromEntries((init?.body as FormData).entries()) : JSON.parse(String(init?.body))
    expect(body).toMatchObject({ model: 'gpt-image-2-4k', quality: 'auto', background: 'transparent' })
  })

  it.each((['auto', 'low', 'medium', 'high'] as const).flatMap(quality => [false, true].map(edit => ({ quality, edit }))))('图片二四K保留官方品质 $quality edit=$edit', async ({ quality, edit }) => {
    const mock = mockImages()
    await callImageApi({ settings: settingsFor('gpt-image-2-4k'), prompt: '透明贴纸', params: { ...DEFAULT_PARAMS, quality, background: 'transparent' }, inputImageDataUrls: edit ? [png] : [] })
    const [, init] = mock.mock.calls.find(([url]) => String(url).includes('/images/'))!
    const body = edit ? Object.fromEntries((init?.body as FormData).entries()) : JSON.parse(String(init?.body))
    expect(body).toMatchObject({ quality, background: 'transparent' })
  })
})
