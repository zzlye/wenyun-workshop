import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { callImageApi } from './api'
import { callMidjourneyImageApi } from './midjourneyImageApi'
import { getSafeImageDisplayUrl } from './imageApiShared'

const profile = { ...DEFAULT_SETTINGS.profiles[0], model: 'mj-v8.2', apiKey: 'mj-test-key' }
const options = { settings: { ...DEFAULT_SETTINGS, model: profile.model, apiKey: profile.apiKey }, prompt: '原始提示', params: { ...DEFAULT_PARAMS, size: '16:9' }, inputImageDataUrls: [] as string[] }
const images = ['https://example.com/1.png', 'https://example.com/2.png', 'https://example.com/3.png', 'https://example.com/4.png']
const completed = () => new Response(JSON.stringify({ data: { task_id: 'original-task', status: 'completed', result: { data: { image_urls: images, grid_image_url: 'https://example.com/grid.png' } } } }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'disabled')
})

describe('Midjourney 提交与恢复', () => {
  it.each(['直连', '本站恢复'])('%s 读取中转签名相对地址，返回四张原图而非空结果', async mode => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'disabled')
    const relativeUrls = images.map((_, index) => `/task-media/async-real/media/${index}?expires=123&signature=test-${index}`)
    const payload = { task_id: 'async-real', status: 'succeeded', data: { task_id: 'async-real', status: 'completed', result: { data: { image_urls: relativeUrls } } }, result: { data: { image_urls: relativeUrls } } }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    if (mode === '本站恢复') fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'succeeded' })))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload)))
    const result = await callMidjourneyImageApi({ ...options, ...(mode === '本站恢复' ? { imageTask: { taskId: 'website-task', accessToken: 'token', idempotencyKey: 'once' } } : {}) }, profile)
    const absoluteUrls = relativeUrls.map(url => `https://api.zzlye.xyz${url}`)
    expect(result.rawImageUrls).toEqual(absoluteUrls)
    expect(result.images).toEqual(absoluteUrls.map(getSafeImageDisplayUrl))
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(mode === '直连' ? 1 : 0)
  })

  it('直连受理后临时 408 和断网仅续查原任务，同 Key 返回全部单图', async () => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'disabled')
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 202, headers: { 'X-NewAPI-Task-Id': 'original-task' } }))
      .mockResolvedValueOnce(new Response('timeout', { status: 408 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(completed())
    const pending = callMidjourneyImageApi(options, profile)
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await pending).rawImageUrls).toEqual(images)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    for (const [url, init] of fetchMock.mock.calls.slice(1)) {
      expect(String(url)).toBe('/api-proxy/wenyun/tasks/original-task')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer mj-test-key' })
      expect(init?.method).not.toBe('POST')
    }
  })

  it('本站已有凭据时忽略失效参考图、遮罩和提示词，只读原结果', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'succeeded' })))
      .mockResolvedValueOnce(completed())
    const reference = { taskId: 'website-task', accessToken: 'private-task-token', idempotencyKey: 'once' }
    const result = await callImageApi({ ...options, prompt: '', inputImageDataUrls: ['blob:expired'], maskDataUrl: 'expired-mask', imageTask: reference })
    expect(result.images).toEqual(images.map(getSafeImageDisplayUrl))
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/image-tasks/website-task', '/image-tasks/website-task/result'])
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })

  it('本站创建一次任务并持久化凭据，单参考图保持原样', async () => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
    const onCreated = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 'website-task', accessToken: 'private-task-token' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'succeeded' })))
      .mockResolvedValueOnce(completed())
    const result = await callMidjourneyImageApi({ ...options, inputImageDataUrls: ['https://example.com/reference.jpg'], params: { ...options.params, midjourney: { raw: false } }, onImageTaskCreated: onCreated }, profile)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ model: 'mj-v8.2', prompt: '原始提示', size: '16:9', raw: false, n: 1, image: 'https://example.com/reference.jpg' })
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'website-task', accessToken: 'private-task-token' }))
    expect(result.images).toHaveLength(4)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('上游失败保留原错误，不能把受理或失败当成空图成功', async () => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'disabled')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'failed', error_message: '上游拒绝内容' } })))
    await expect(callMidjourneyImageApi(options, profile)).rejects.toThrow('上游拒绝内容')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('超限参考图在素材读取和付费提交之前拒绝', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(callImageApi({ ...options, inputImageDataUrls: Array(6).fill('https://example.com/ref.png') })).rejects.toThrow('最多支持 5 张')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
