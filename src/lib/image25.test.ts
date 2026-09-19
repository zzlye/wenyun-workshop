import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskParams } from '../types'
import { DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { callImageApi } from './api'
import { normalizeParamsForSettings } from './paramCompatibility'
import { FIXED_IMAGE_MODEL_OPTIONS, getFixedImageRequestModel, normalizeFixedImageModel, supportsExtendedImageQuality, supportsTransparentImageBackground } from './modelPricing'

const models = ['gpt-image-2.5-flare-满血', 'gpt-image-2.5-sunburst-满血']
const otherModels = ['gpt-image-2', 'gpt-image-2-4k', 'gpt-image-2.5-flare-4k', 'gpt-image-2.5-sunburst-4k', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'Nano-Banana-Pro', 'seedream-5-pro']
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const settingsFor = (model: string) => normalizeSettings({ ...DEFAULT_SETTINGS, profiles: DEFAULT_SETTINGS.profiles.map(profile => ({ ...profile, model, apiKey: 'test-only' })) })
const originalFetch = globalThis.fetch
const mockImages = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => String(input).startsWith('data:') ? originalFetch(input, init) : new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }], background: 'transparent' }), { headers: { 'Content-Type': 'application/json' } }))

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('GPT Image 2.5 满血渠道官方参数', () => {
  it.each(models)('%s 出现在模型列表中，原样路由并开放背景和扩展品质', model => {
    expect(FIXED_IMAGE_MODEL_OPTIONS.some(option => option.value === model)).toBe(true)
    expect(normalizeFixedImageModel(model)).toBe(model)
    expect(getFixedImageRequestModel(model)).toBe(model)
    expect(supportsTransparentImageBackground(model)).toBe(true)
    expect(supportsExtendedImageQuality(model)).toBe(true)
  })

  it.each(models.flatMap(model => ['auto', 'opaque', 'transparent'].map(background => [model, background])) )('%s 文生图发送背景 %s 和官方字段', async (model, background) => {
    const mock = mockImages()
    const result = await callImageApi({ settings: settingsFor(model), prompt: '透明贴纸', params: { ...DEFAULT_PARAMS, quality: 'max', size: '3840x2160', background: background as TaskParams['background'] }, inputImageDataUrls: [] })
    const [url, init] = mock.mock.calls[0]
    expect(String(url)).toContain('/images/generations')
    expect(JSON.parse(String(init?.body))).toEqual({ model, prompt: '透明贴纸', size: '3840x2160', quality: 'max', background, output_format: 'png', moderation: 'auto' })
    expect(result.images[0]).toMatch(/^data:image\/png;base64,/)
    expect(result.actualParams?.background).toBe('transparent')
  })

  it.each(models)('%s 图生图保留背景、极高品质和 PNG，省略旧 response_format', async model => {
    const mock = mockImages()
    await callImageApi({ settings: settingsFor(model), prompt: '去除背景', params: { ...DEFAULT_PARAMS, quality: 'xhigh', background: 'transparent' }, inputImageDataUrls: [png] })
    const [url, init] = mock.mock.calls.find(([url]) => String(url).includes('/images/edits'))!
    expect(String(url)).toContain('/images/edits')
    const form = init?.body as FormData
    expect(form.get('model')).toBe(model)
    expect(form.get('background')).toBe('transparent')
    expect(form.get('output_format')).toBe('png')
    expect(form.get('quality')).toBe('xhigh')
    expect(form.get('response_format')).toBeNull()
    expect(form.get('image')).toBeInstanceOf(Blob)
  })

  it.each(['jpeg', 'webp'] as const)('透明背景输出 %s 按透明通道能力处理', async format => {
    const mock = mockImages()
    await callImageApi({ settings: settingsFor(models[0]), prompt: '贴纸', params: { ...DEFAULT_PARAMS, background: 'transparent', output_format: format, output_compression: 80 }, inputImageDataUrls: [] })
    const body = JSON.parse(String(mock.mock.calls[0][1]?.body))
    expect(body.output_format).toBe(format === 'jpeg' ? 'png' : 'webp')
    expect(body.output_compression).toBe(format === 'jpeg' ? undefined : 80)
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

  it('异步任务封装保持满血渠道名和透明背景字段', async () => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
    const mock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 'test-task', accessToken: 'test-token', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 'test-task', status: 'succeeded' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), { headers: { 'Content-Type': 'application/json' } }))
    await callImageApi({ settings: settingsFor(models[0]), prompt: '贴纸', params: { ...DEFAULT_PARAMS, background: 'transparent' }, inputImageDataUrls: [], imageTask: { taskId: '', accessToken: '', idempotencyKey: 'test-idempotency' } })
    expect(mock.mock.calls[0][0]).toBe('/image-tasks?endpoint=%2Fimages%2Fgenerations')
    expect(JSON.parse(String(mock.mock.calls[0][1]?.body))).toMatchObject({ model: models[0], background: 'transparent', output_format: 'png' })
    expect(mock).toHaveBeenCalledTimes(3)
  })
})
