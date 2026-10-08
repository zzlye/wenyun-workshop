import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fetchImageTask } from './imageTasks'
import { fetchImageUrlAsDataUrl } from './imageApiShared'
import { fetchResultResponse, ResultReadTimeoutError } from './resultRequest'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { DEFAULT_PARAMS } from '../types'
import { Buffer } from 'node:buffer'

const reference = { taskId: 'existing', accessToken: 'token', idempotencyKey: 'key' }
const result = () => new Response(JSON.stringify({ data: [{ b64_json: 'b2s=' }] }))
const completed = () => new Response(JSON.stringify({ status: 'succeeded' }))
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })

it('图片状态请求不返回时自动取消并续查，生图工坊与画布共用任务不重建', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(() => undefined))
    .mockResolvedValueOnce(completed()).mockResolvedValueOnce(result())
  let output: unknown
  const pending = fetchImageTask('images/generations', { method: 'POST' }, { timeoutMs: 10, reference }).then(r => r.json()).then(r => { output = r })
  await vi.advanceTimersByTimeAsync(34000)
  expect(output).toEqual({ data: [{ b64_json: 'b2s=' }] })
  await pending
  expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
})

it('任务结果响应体中途停滞后重新读取原结果，保留原字节', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(completed())
    .mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')) } })))
    .mockResolvedValueOnce(result())
  let output: unknown
  const pending = fetchImageTask('images/generations', { method: 'POST' }, { timeoutMs: 10, reference }).then(r => r.json()).then(r => { output = r })
  await vi.advanceTimersByTimeAsync(64000)
  expect(output).toEqual({ data: [{ b64_json: 'b2s=' }] })
  await pending
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/image-tasks/existing', '/image-tasks/existing/result', '/image-tasks/existing/result'])
})

it('图片链接下载卡住时只重新下载，不要求重新生成', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(() => undefined))
    .mockResolvedValueOnce(new Response(new Blob(['original-image'], { type: 'image/png' })))
  let output = ''
  const pending = fetchImageUrlAsDataUrl('https://cdn.example/result.png', 'image/png').then(r => { output = r })
  await vi.advanceTimersByTimeAsync(64000)
  expect(output).toBe('data:image/png;base64,' + btoa('original-image'))
  await pending
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('图片下载持续有字节进展时允许超过一分钟，内容不压缩', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('first'))
      setTimeout(() => c.enqueue(new TextEncoder().encode('second')), 45000)
      setTimeout(() => { c.enqueue(new TextEncoder().encode('third')); c.close() }, 90000)
    },
  }), { headers: { 'Content-Type': 'image/png' } }))
  const pending = fetchImageUrlAsDataUrl('https://cdn.example/result.png', 'image/png')
  await vi.advanceTimersByTimeAsync(91000)
  expect(await pending).toBe('data:image/png;base64,' + btoa('firstsecondthird'))
})

const profile = { ...DEFAULT_SETTINGS.profiles[0], model: 'test-image-model', timeout: 10, apiMode: 'images' as const, apiKey: 'test-key' }
const options = { settings: DEFAULT_SETTINGS, params: { ...DEFAULT_PARAMS, n: 1 }, prompt: 'test', inputImageDataUrls: [] }
function openStream(events: unknown[]) {
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`))
    },
    cancel,
  })
  return { response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }), cancel }
}

it('流式两张图片全部完成即返回，不等上游关闭长连接', async () => {
  vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'disabled')
  const stream = openStream([
    { type: 'image_generation.completed', b64_json: 'b25l' },
    { type: 'image_generation.completed', b64_json: 'dHdv' },
  ])
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(stream.response)
  let output: string[] | undefined
  const pending = callOpenAICompatibleImageApi({ ...options, params: { ...options.params, n: 2 } }, profile).then(r => { output = r.images })
  await vi.advanceTimersByTimeAsync(0)
  expect(output).toEqual(['data:image/png;base64,b25l', 'data:image/png;base64,dHdv'])
  await pending
  expect(stream.cancel).toHaveBeenCalledOnce()
  expect(fetchMock).toHaveBeenCalledOnce()
})

it('流式 DONE 标记结束读取，服务端少返回图片时保留已完成结果', async () => {
  vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'disabled')
  const stream = openStream([{ type: 'image_generation.completed', b64_json: 'b25l' }, '[DONE]'])
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(stream.response)
  let output: string[] | undefined
  const pending = callOpenAICompatibleImageApi({ ...options, params: { ...options.params, n: 2 } }, profile).then(r => { output = r.images })
  await vi.advanceTimersByTimeAsync(0)
  expect(output).toEqual(['data:image/png;base64,b25l'])
  await pending
})

it('Responses 等整次响应完成，不在单个输出结束时截断多图', async () => {
  const first = { type: 'image_generation_call', result: 'b25l' }
  const second = { type: 'image_generation_call', result: 'dHdv' }
  const stream = openStream([
    { type: 'response.output_item.done', item: first },
    { type: 'response.output_item.done', item: second },
    { type: 'response.completed', response: { output: [first, second] } },
  ])
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(stream.response)
  let output: string[] | undefined
  const pending = callOpenAICompatibleImageApi(options, { ...profile, apiMode: 'responses' }).then(r => { output = r.images })
  await vi.advanceTimersByTimeAsync(0)
  expect(output).toEqual(['data:image/png;base64,b25l', 'data:image/png;base64,dHdv'])
  await pending
  expect(stream.cancel).toHaveBeenCalledOnce()
})

it('流式响应头已返回但没有完成时仍保留生成超时，不重复提交', async () => {
  vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'disabled')
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => new Response(new ReadableStream({
    start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true }) },
  }), { headers: { 'Content-Type': 'text/event-stream' } }))
  const pending = callOpenAICompatibleImageApi(options, profile).catch(error => error)
  await vi.advanceTimersByTimeAsync(11000)
  expect(await pending).toMatchObject({ name: 'AbortError' })
  expect(fetchMock).toHaveBeenCalledOnce()
})

it('生成响应在超时前返回时，慢速原图下载使用独立预算', async () => {
  vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'disabled')
  const received = vi.fn()
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/final.png' }] }))), 9000)))
    .mockImplementationOnce((_url, init) => new Promise((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      setTimeout(() => resolve(new Response(new Blob(['original'], { type: 'image/png' }))), 5000)
    }))
  const pending = callOpenAICompatibleImageApi({ ...options, onResultReceived: received }, profile)
  await vi.advanceTimersByTimeAsync(9100)
  expect(received).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(6000)
  expect((await pending).images).toEqual(['data:image/png;base64,' + btoa('original')])
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it.each([401, 403])('结果链接 HTTP %i 不做无效重试', async status => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('denied', { status }))
  await expect(fetchImageUrlAsDataUrl('https://cdn.example/final.png', 'image/png')).rejects.toThrow(`HTTP ${status}`)
  expect(fetchMock).toHaveBeenCalledOnce()
})

it('主动取消下载时取消底层读取，不重试', async () => {
  const controller = new AbortController()
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => undefined))
  const pending = fetchImageUrlAsDataUrl('https://cdn.example/final.png', 'image/png', controller.signal).catch(error => error)
  controller.abort()
  expect(await pending).toMatchObject({ name: 'AbortError' })
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('持续有数据的结果读取也受总预算限制，超时后清理计时器', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])) } })))
  const pending = fetchResultResponse('https://cdn.example/final.png', {}, { timeoutMs: 500, idleTimeoutMs: 1000 }).catch(error => error)
  await vi.advanceTimersByTimeAsync(600)
  expect(await pending).toBeInstanceOf(ResultReadTimeoutError)
  expect(vi.getTimerCount()).toBe(0)
})

it('带偏移的共享缓冲区仅保存当前响应字节，避免混入其他数据', async () => {
  const buffer = Buffer.from('prefix-original-suffix')
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
    start(c) { c.enqueue(buffer.subarray(7, 15)); c.close() },
  })))
  expect(await (await fetchResultResponse('https://cdn.example/final.png')).text()).toBe('original')
})
