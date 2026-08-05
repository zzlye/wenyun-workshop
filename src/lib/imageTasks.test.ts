import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createImageTaskIdempotencyKey,
  fetchImageTask,
  shouldUseImageTasks,
  type ImageTaskReference,
} from './imageTasks'

describe('image task client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'disabled')
  })

  it('只对文运站内置地址启用异步任务', () => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
    expect(shouldUseImageTasks('https://api.zzlye.xyz/v1')).toBe(true)
    expect(shouldUseImageTasks('https://1520635.xyz:3901/v1')).toBe(false)
    expect(shouldUseImageTasks('https://custom.example.com/v1')).toBe(false)
  })

  it('创建任务后轮询并还原上游响应', async () => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        taskId: 'task-1',
        accessToken: 'token-1',
        status: 'running',
      }), { status: 202, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 'task-1', status: 'succeeded' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('{"data":[{"b64_json":"ZmluYWw="}]}', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Wenyun-Upstream-Status': '201',
          'X-Wenyun-Upstream-Status-Text': 'Created',
        },
      }))

    const created = vi.fn()
    const response = await fetchImageTask('images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer key', 'Content-Type': 'application/json' },
      body: '{}',
    }, {
      timeoutMs: 900_000,
      reference: { taskId: '', accessToken: '', idempotencyKey: 'home-task-1' },
      onCreated: created,
    })

    expect(fetchMock.mock.calls[0][0]).toBe('/image-tasks?endpoint=%2Fimages%2Fgenerations')
    const createHeaders = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers)
    expect(createHeaders.get('x-wenyun-idempotency-key')).toBe('home-task-1')
    expect(createHeaders.get('x-wenyun-task-client-version')).toBe('2')
    expect(created).toHaveBeenCalledWith({ taskId: 'task-1', accessToken: 'token-1', idempotencyKey: 'home-task-1' })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ data: [{ b64_json: 'ZmluYWw=' }] })
  })

  it('已有任务凭据时不重复创建任务', async () => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
    const reference: ImageTaskReference = {
      taskId: 'existing-task',
      accessToken: 'existing-token',
      idempotencyKey: 'existing-key',
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: reference.taskId, status: 'succeeded' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('{"data":[{"b64_json":"b2s="}]}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    await fetchImageTask('images/generations', { method: 'POST', body: '{}' }, {
      timeoutMs: 900_000,
      reference,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('/image-tasks/existing-task')
    expect(fetchMock.mock.calls[1][0]).toBe('/image-tasks/existing-task/result')
  })

  it('创建请求网络失败时不自动补发', async () => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(fetchImageTask('images/generations', { method: 'POST', body: '{}' }, {
      timeoutMs: 900_000,
      reference: { taskId: '', accessToken: '', idempotencyKey: 'single-submit-task' },
    })).rejects.toThrow('Failed to fetch')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('并发任务生成不同幂等键', () => {
    const keys = new Set(Array.from({ length: 100 }, () => createImageTaskIdempotencyKey('canvas-node')))
    expect(keys.size).toBe(100)
  })
})
