import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { callImageApi } from './api'
import { DEFAULT_SETTINGS, normalizeSettings, isBananaImageModel } from './apiProfiles'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'

const reference = 'data:image/png;base64,cmVm'
const imageUrl = 'https://api.xn--v5z30ywuk.com/task-media/async_fixture/media/0?expires=9999999999&signature=fixture'
const imageBytes = new Uint8Array([137, 80, 78, 71, 0, 255, 128, 42])
const models = ['gpt-image-2', 'gpt-image-2-4k', 'gpt-image-2.5-flare-4k', 'gpt-image-2.5-sunburst-4k', 'gpt-image-2.5-sunburst-满血', 'AZ-gpt-image-2.5-flare', '官-gpt-image-2.5-sunburst', '官-gpt-image-2', 'Nano-Banana-2', 'Nano-Banana-Pro']
const settingsFor = (model: string) => normalizeSettings({ ...DEFAULT_SETTINGS, profiles: DEFAULT_SETTINGS.profiles.map(p => ({ ...p, model, apiKey: 'fixture-key' })) })

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('西米露 URL 结果传输', () => {
  it.each(['gpt-image-2.5-sunburst-满血', 'AZ-gpt-image-2.5-flare', '官-gpt-image-2', 'Nano-Banana-Pro'])('%s 自定义直连接口不注入网关扩展参数', async model => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'disabled')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [{ b64_json: 'cmVm' }] }))
    const profile = { ...DEFAULT_SETTINGS.profiles[0], model, baseUrl: 'https://direct.example/v1', apiProxy: false }
    await callOpenAICompatibleImageApi({ settings: DEFAULT_SETTINGS, prompt: '兼容直连', params: DEFAULT_PARAMS, inputImageDataUrls: [] }, profile)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    if (!isBananaImageModel(model)) expect(body.model).toBe(model)
    // 自定义直连遵循官方协议，不因渠道前缀注入本站的 URL 扩展。
    expect(body).not.toHaveProperty('response_format')
  })

  it.each(models.flatMap(model => [false, true].map(edit => ({ model, edit }))))('$model edit=$edit 仅提交一次，下载原始二进制并保留可保存的图片', async ({ model, edit }) => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
    const gemini = isBananaImageModel(model)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/image-tasks?')) {
        const body = edit && !gemini ? Object.fromEntries((init?.body as FormData).entries()) : JSON.parse(String(init?.body))
        expect(body.response_format).toBe(/^(AZ-|官-)/.test(model) ? undefined : 'url')
        if (gemini) {
          expect(body.generationConfig.imageConfig).toMatchObject({ imageSize: '4K', aspectRatio: '1:1' })
          if (edit) expect(body.contents[0].parts[1].inlineData.data).toBe('cmVm')
        } else {
          expect(body.model).toBe(model)
          expect(body.quality).toBe('high')
          if (edit) expect(body.image).toBeInstanceOf(Blob)
        }
        return Response.json({ taskId: 'url-fixture', accessToken: 'fixture-token', status: 'pending' }, { status: 202 })
      }
      if (url === '/image-tasks/url-fixture') return Response.json({ status: 'succeeded' })
      if (url.endsWith('/url-fixture/result')) return Response.json(gemini
        ? { candidates: [{ content: { parts: [{ fileData: { mimeType: 'image/png', fileUri: imageUrl } }] } }] }
        : { data: [{ url: imageUrl }], quality: 'high' })
      if (url.includes('/task-media/')) {
        // 签名图片链接无需携带客户令牌，网络传输保持原图字节。
        expect(new Headers(init?.headers).has('authorization')).toBe(false)
        return new Response(imageBytes, { headers: { 'Content-Type': 'image/png' } })
      }
      throw Error('未声明的测试请求：' + url)
    })
    const result = await callImageApi({ settings: settingsFor(model), prompt: '测试原图保存', params: { ...DEFAULT_PARAMS, quality: 'high', size: '4096x4096' }, inputImageDataUrls: edit ? [reference] : [] })
    expect(result.images).toEqual(['data:image/png;base64,' + btoa(String.fromCharCode(...imageBytes))])
    expect(result.rawImageUrls).toEqual([imageUrl])
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/task-media/'))).toHaveLength(1)
  })

  it.each(['官-gpt-image-2.5-sunburst', 'AZ-gpt-image-2.5-flare', 'provider/gpt-image-2.5-sunburst', 'gpt-image-3'].flatMap(model =>
    [false, true].flatMap(asyncTask => [false, true].map(edit => ({ model, asyncTask, edit }))),
  ))('$model 官方协议 async=$asyncTask edit=$edit 不带旧参数且只生成一次', async ({ model, asyncTask, edit }) => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', asyncTask ? 'enabled' : 'disabled')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (init?.method === 'POST') {
        const body = edit ? Object.fromEntries((init.body as FormData).entries()) : JSON.parse(String(init.body))
        // 模拟线上官渠：任何 response_format 值都会被拒绝，不能通过换成 b64_json 规避。
        if ('response_format' in body) return Response.json({ error: { message: "Unknown parameter: 'response_format'." } }, { status: 400 })
        expect(body).toMatchObject({ model, quality: 'high', background: 'transparent', output_format: 'webp', moderation: 'low' })
        if (edit) expect(body.image).toBeInstanceOf(Blob)
        return asyncTask
          ? Response.json({ taskId: 'official-fixture', accessToken: 'fixture-token', status: 'pending' }, { status: 202 })
          : Response.json({ data: [{ b64_json: 'cmVm' }], output_format: 'webp' })
      }
      if (String(input) === '/image-tasks/official-fixture') return Response.json({ status: 'succeeded' })
      if (String(input).endsWith('/official-fixture/result')) return Response.json({ data: [{ b64_json: 'cmVm' }], output_format: 'webp' })
      throw Error('未声明的测试请求：' + String(input))
    })
    const result = await callImageApi({ settings: settingsFor(model), prompt: '官方参数', params: { ...DEFAULT_PARAMS, quality: 'high', background: 'transparent', output_format: 'webp', moderation: 'low' }, inputImageDataUrls: edit ? [reference] : [] })
    expect(result.images).toEqual(['data:image/webp;base64,cmVm'])
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('香蕉多图保留每张图的原始链接', async () => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'disabled')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => init?.method === 'POST'
      ? Response.json({ candidates: [{ content: { parts: [{ fileData: { fileUri: imageUrl } }] } }] })
      : new Response(imageBytes, { headers: { 'Content-Type': 'image/png' } }))
    const result = await callImageApi({ settings: settingsFor('Nano-Banana-Pro'), prompt: '两张图', params: { ...DEFAULT_PARAMS, n: 2 }, inputImageDataUrls: [] })
    expect(result.images).toHaveLength(2)
    expect(result.rawImageUrls).toEqual([imageUrl, imageUrl])
  })
})
