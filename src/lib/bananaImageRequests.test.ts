import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type ApiFormat } from '../types'
import { callImageApi } from './api'
import { DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { normalizeParamsForSettings } from './paramCompatibility'

// 覆盖容易被像素推断混淆的档位和比例，通过实际请求构造检查完整提交链路。
const CASES = [
  ['Nano-Banana-2', '512x512', '1:1', '512'],
  ['Nano-Banana-2', '792x168', '21:9', '512'],
  ['Nano-Banana-2', '3072x384', '8:1', '1K'],
  ['Nano-Banana-2', '768x6144', '1:8', '2K'],
  ['Nano-Banana-2', '12288x1536', '8:1', '4K'],
  ['nano-banana-2.1', '1376x768', '16:9', '1K'],
  ['nano-banana-2.1', '768x6144', '1:8', '2K'],
  ['Nano-Banana-Pro', '928x1152', '4:5', '1K'],
  ['Nano-Banana-Pro', '2304x1856', '5:4', '2K'],
  ['Nano-Banana-Pro', '4096x4096', '1:1', '4K'],
  ['Nano-Banana-Pro', '6336x2688', '21:9', '4K'],
] as const

describe('文运香蕉官方尺寸请求', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  describe.each(['openai', 'gemini', 'edit'] as const)('%s 协议', (protocol) => {
    it.each(CASES)('%s %s 保留尺寸并传递 %s / %s', async (model, size, aspectRatio, imageSize) => {
      vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'disabled')
      const apiFormat: ApiFormat = protocol === 'gemini' ? 'gemini' : 'openai'
      const settings = normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({ ...profile, model, apiFormat, apiKey: 'test-key' })),
      })
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        if (String(input).startsWith('data:')) return new Response(new Blob(['ref'], { type: 'image/png' }))
        return new Response(JSON.stringify(protocol === 'gemini'
          ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'ZmluYWw=' } }] } }] }
          : { data: [{ b64_json: 'ZmluYWw=' }] }), { headers: { 'Content-Type': 'application/json' } })
      })
      const params = normalizeParamsForSettings({ ...DEFAULT_PARAMS, size }, settings)
      expect(params.size).toBe(size)
      await callImageApi({
        settings, params, prompt: '测试官方尺寸',
        inputImageDataUrls: protocol === 'openai' ? [] : ['data:image/png;base64,cmVm'],
      })
      const [, request] = fetchMock.mock.calls.find(([input]) => !String(input).startsWith('data:'))!
      const body = request!.body
      if (protocol === 'edit') {
        expect(body).toBeInstanceOf(FormData)
        const form = body as FormData
        expect(form.get('size')).toBe(size)
        expect(form.get('aspectRatio')).toBe(aspectRatio)
        expect(form.get('imageSize')).toBe(imageSize)
        expect(form.getAll('image')).toHaveLength(1)
      } else {
        const json = JSON.parse(String(body))
        const config = protocol === 'gemini' ? json.generationConfig.imageConfig : json
        if (model === 'nano-banana-2.1' && protocol === 'openai') expect(json.model).toBe('nano-banana-2.1')
        expect(config).toMatchObject({ aspectRatio, imageSize })
        if (protocol === 'openai') expect(json.size).toBe(size)
      }
    })
  })
})
