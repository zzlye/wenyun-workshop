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

describe('图片任务恢复', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('查询短暂断网后继续原任务，不因创建超时参数而中止轮询', async () => {
    vi.useFakeTimers()
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ taskId: 'task-recover', accessToken: 'token', status: 'running' }, 202))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response({ status: 'running' }))
      .mockResolvedValueOnce(response({ status: 'succeeded' }))
      .mockResolvedValueOnce(response({ data: [{ b64_json: 'b2s=' }] }))
    const promise = fetchImageTask('images/generations', { method: 'POST', body: '{}' }, { timeoutMs: 10 })
    // 立即绑定断言，异步异常会作为本用例失败报告，不泄漏为未处理拒绝。
    const assertion = expect(promise.then((result) => result.json())).resolves.toEqual({ data: [{ b64_json: 'b2s=' }] })
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(fetchMock.mock.calls.slice(1).map(([url]) => url)).toEqual([
      '/image-tasks/task-recover', '/image-tasks/task-recover', '/image-tasks/task-recover', '/image-tasks/task-recover/result',
    ])
  })

  it('服务端确定失败时停止查询并保留原错误，不重新创建任务', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'failed', error: { message: '上游生成失败' } }), { status: 200 }))
    await expect(fetchImageTask('images/generations', { method: 'POST', body: '{}' }, {
      timeoutMs: 10,
      reference: { taskId: 'failed-task', accessToken: 'token', idempotencyKey: 'same-key' },
    })).rejects.toThrow('上游生成失败')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.method).not.toBe('POST')
  })
})
