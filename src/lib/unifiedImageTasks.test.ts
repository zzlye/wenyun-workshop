import { afterEach, expect, it, vi } from 'vitest'
import { callImageApi } from './api'
import { DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { DEFAULT_PARAMS } from '../types'
import { requestEdit, requestGeneration } from '../infiniteCanvasSource/services/api/image'
import { defaultConfig } from '../infiniteCanvasSource/stores/use-config-store'
import { useStore } from '../store'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

it.each(['nano-banana-2.1', 'gpt-image-2.5-sunburst', 'mj-v8.2'])('%s 统一提交异步任务，不保持浏览器生成长连接', async (model) => {
  vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: DEFAULT_SETTINGS.profiles.map(p => ({ ...p, model, apiKey: 'fixture-key' })) })
  const result = model.startsWith('nano')
    ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'b2s=' } }] } }] }
    : model.startsWith('mj') ? { status: 'completed', data: { image_urls: ['https://example.com/image.png'] } } : { data: [{ b64_json: 'b2s=' }] }
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).startsWith('/image-tasks?')) return Response.json({ taskId: 'saved-task', accessToken: 'saved-token', status: 'running' }, { status: 202 })
    if (String(url).endsWith('/result')) return Response.json(result)
    if (String(url) === '/image-tasks/saved-task') return Response.json({ status: 'succeeded' })
    throw new Error(`不允许绕过异步任务：${init?.method} ${url}`)
  })
  const onCreated = vi.fn()
  await callImageApi({ settings, prompt: '纸杯里的小黄鸭', params: DEFAULT_PARAMS, inputImageDataUrls: [], imageTask: { taskId: '', accessToken: '', idempotencyKey: 'one-submit' }, onImageTaskCreated: onCreated })
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'saved-task' }))
})

it.each(['nano-banana-2.1', 'gpt-image-2-4k', 'seedream-5-pro', 'mj-v8.2'].flatMap(model => [false, true].map(edit => ({ model, edit }))))('画布 $model edit=$edit 创建和刷新恢复复用同一任务', async ({ model, edit }) => {
  vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
  const originalSettings = useStore.getState().settings
  const realFetch = globalThis.fetch
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: DEFAULT_SETTINGS.profiles.map(p => ({ ...p, model, apiKey: 'fixture-key' })) })
  useStore.setState({ settings })
  const result = model.startsWith('nano') ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'b2s=' } }] } }] }
    : model.startsWith('mj') ? { status: 'completed', data: { image_urls: ['https://example.com/image.png'] } } : { data: [{ b64_json: 'b2s=' }] }
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).startsWith('data:')) return realFetch(url, init)
    if (String(url).startsWith('/image-tasks?') || url === '/image-tasks/recover') return Response.json({ taskId: 'canvas-task', accessToken: 'canvas-token', status: 'running' }, { status: 202 })
    if (String(url).endsWith('/result')) return Response.json(result)
    if (String(url) === '/image-tasks/canvas-task') return Response.json({ status: 'succeeded' })
    throw new Error(`未走统一任务接口：${url}`)
  })
  const config = { ...defaultConfig, model, imageModel: model, count: '1', quality: 'high' }
  const created = vi.fn()
  try {
    if (edit) await requestEdit(config, '纸杯里的小黄鸭', [{ id: 'ref', name: '参考', type: 'image/png', dataUrl: 'data:image/png;base64,b2s=' }], 'canvas-node', undefined, created)
    else await requestGeneration(config, '纸杯里的小黄鸭', 'canvas-node', undefined, created)
    const placeholder = created.mock.calls[0][0]
    const reference = created.mock.calls.at(-1)![0]
    expect(reference.taskId).toBe('canvas-task')
    // 模拟刷新丢失创建响应，只保存了幂等键，原素材也已经失效。
    if (edit) await requestEdit(config, '', [{ id: 'missing', name: '已移除', type: 'image/png', dataUrl: 'blob:missing' }], 'canvas-node', placeholder, created)
    else await requestGeneration(config, '', 'canvas-node', placeholder, created)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([url]) => url === '/image-tasks/recover')).toBe(true)
  } finally { useStore.setState({ settings: originalSettings }) }
})

it('Responses 生图创建和恢复均保持原解析协议', async () => {
  vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
  const profile = { ...DEFAULT_SETTINGS.profiles[0], model: 'gpt-4.1', apiKey: 'fixture-key', apiMode: 'responses' as const }
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    if (String(url).startsWith('/image-tasks?')) return Response.json({ taskId: 'response-task', accessToken: 'token' }, { status: 202 })
    if (String(url).endsWith('/result')) return Response.json({ output: [{ type: 'image_generation_call', result: 'b2s=' }] })
    return Response.json({ status: 'succeeded' })
  })
  const opts = { settings: DEFAULT_SETTINGS, prompt: '纸杯里的小黄鸭', params: DEFAULT_PARAMS, inputImageDataUrls: [] }
  const first = await callOpenAICompatibleImageApi(opts, profile)
  const resumed = await callOpenAICompatibleImageApi({ ...opts, imageTask: { taskId: 'response-task', accessToken: 'token', idempotencyKey: 'same' } }, profile)
  expect(first.images).toEqual(['data:image/png;base64,b2s='])
  expect(resumed.images).toEqual(first.images)
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  expect(fetchMock.mock.calls[0][0]).toBe('/image-tasks?endpoint=%2Fresponses')
})

it('固定 Images 别名恢复时不受旧 Responses 设置影响', async () => {
  vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
  const profile = { ...DEFAULT_SETTINGS.profiles[0], model: 'gpt-image-2-vip', apiKey: 'fixture-key', apiMode: 'responses' as const }
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    if (String(url).startsWith('/image-tasks?')) return Response.json({ taskId: 'alias-task', accessToken: 'token' }, { status: 202 })
    if (String(url).endsWith('/result')) return Response.json({ data: [{ b64_json: 'b2s=' }] })
    return Response.json({ status: 'succeeded' })
  })
  const opts = { settings: DEFAULT_SETTINGS, prompt: '纸杯里的小黄鸭', params: DEFAULT_PARAMS, inputImageDataUrls: [] }
  const first = await callOpenAICompatibleImageApi(opts, profile)
  const resumed = await callOpenAICompatibleImageApi({ ...opts, imageTask: { taskId: 'alias-task', accessToken: 'token', idempotencyKey: 'same' } }, profile)
  expect(resumed.images).toEqual(first.images)
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})
