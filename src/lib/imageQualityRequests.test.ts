import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { callImageApi } from './api'
import { DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { FIXED_IMAGE_MODEL_OPTIONS } from './modelPricing'
import { normalizeParamsForSettings } from './paramCompatibility'

const models = FIXED_IMAGE_MODEL_OPTIONS.map(option => option.value).filter(model => model.startsWith('gpt-image-'))
const qualities = ['auto', 'low', 'medium', 'high'] as const
const originalFetch = globalThis.fetch
const reference = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const cases = models.flatMap(model => qualities.flatMap(quality =>
  DEFAULT_SETTINGS.profiles.flatMap(profile => [false, true].flatMap(edit =>
    // 异步任务仅属于西米露站点，公益站检查直接请求。
    (profile.id === 'wenyun-site' ? [false, true] : [false]).map(asyncTask => ({ model, quality, profileId: profile.id, edit, asyncTask })),
  )),
))

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('图片品质从界面参数到出站请求保持一致', () => {
  it.each(cases)('$model $quality $profileId edit=$edit task=$asyncTask', async ({ model, quality, profileId, edit, asyncTask }) => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', asyncTask ? 'enabled' : 'disabled')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith('data:')) return originalFetch(input, init)
      if (url.startsWith('/image-tasks?')) return new Response(JSON.stringify({ taskId: 'quality-task', accessToken: 'quality-token', status: 'pending' }), { status: 202 })
      if (url === '/image-tasks/quality-task') return new Response(JSON.stringify({ taskId: 'quality-task', status: 'succeeded' }))
      return new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), { headers: { 'Content-Type': 'application/json' } })
    })
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, activeProfileId: profileId,
      profiles: DEFAULT_SETTINGS.profiles.map(profile => ({ ...profile, model, apiKey: 'test-only' })) })
    const params = normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality, size: '2160x3840' }, settings, { hasInputImages: edit })
    expect(params.quality).toBe(quality)
    // 无后缀的旧路由按既有能力限制为一 K，四 K 和满血路由保留截图中的尺寸。
    const expectedSize = model === 'gpt-image-2.5-sunburst' || model === 'gpt-image-2.5-flare' ? '720x1280' : '2160x3840'
    expect(params.size).toBe(expectedSize)
    await callImageApi({ settings, prompt: '保留参考主体，生成背面全身图', params,
      inputImageDataUrls: edit ? [reference, reference, reference] : [],
      ...(asyncTask ? { imageTask: { taskId: '', accessToken: '', idempotencyKey: 'quality-repro' } } : {}),
    })
    const requests = fetchMock.mock.calls.filter(([input]) => String(input).includes(asyncTask ? '/image-tasks?' : '/images/'))
    expect(requests).toHaveLength(1)
    const [url, init] = requests[0]
    expect(decodeURIComponent(String(url))).toContain(edit ? '/images/edits' : '/images/generations')
    const body = init?.body
    if (edit) {
      expect(body).toBeInstanceOf(FormData)
      const form = body as FormData
      expect(form.get('quality')).toBe(quality)
      expect(form.get('model')).toBe(model)
      expect(form.get('size')).toBe(expectedSize)
      expect(form.getAll('image[]')).toHaveLength(3)
      if (profileId === 'wenyun-site') expect(form.get('response_format')).toBe('url')
    } else {
      expect(JSON.parse(String(body))).toMatchObject({ model, quality, size: expectedSize })
      if (profileId === 'wenyun-site') expect(JSON.parse(String(body)).response_format).toBe('url')
    }
  })
})
