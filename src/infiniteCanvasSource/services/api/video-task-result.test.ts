import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../../stores/use-config-store'
import { requestVideoGeneration, VideoTaskPendingError } from './video'

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    isAxiosError: (error: { isAxiosError?: boolean }) => Boolean(error?.isAxiosError),
  },
}))

// 保留线上任务的响应结构，不携带客户信息、签名或真实令牌。
const taskId = 'async_completed_video'
const taskPath = `/tasks/${taskId}`
const videoBlob = new Blob(['video'], { type: 'video/mp4' })
const config = { ...defaultConfig, videoApiKey: 'video-test-key', videoModel: 'wan-3.0' }

function completedTask(url?: unknown) {
  const media = [{ kind: 'video', content_type: 'video/mp4', url }]
  return {
    id: taskId,
    task_id: taskId,
    status: 'succeeded',
    result_expired: false,
    response_status_code: 200,
    content_type: 'video/mp4',
    media,
    result: { media },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('已完成视频任务结果与终态', () => {
  it.each(
    [true, false].flatMap((videoApiProxy) =>
      [
        `https://api.xn--v5z30ywuk.com/v1${taskPath}/media/0`,
        `https://previous-api.example/v1${taskPath}/media/0`,
        `/v1${taskPath}/media/0`,
        `${taskPath}/media/0`,
      ].map((url) => ({ videoApiProxy, url })),
    ),
  )('代理开关 $videoApiProxy 兼容完成地址 $url，只读取原任务', async ({ videoApiProxy, url }) => {
    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: completedTask(url) })
      .mockResolvedValueOnce({ data: videoBlob })
    const onTaskCreated = vi.fn()
    const request = requestVideoGeneration(
      { ...config, videoApiProxy },
      '',
      [],
      [],
      [],
      { taskId },
      onTaskCreated,
    ).catch((error) => error)

    await vi.advanceTimersByTimeAsync(10)

    expect(await request).toBe(videoBlob)
    expect(axios.get).toHaveBeenCalledTimes(2)
    expect(axios.get).toHaveBeenNthCalledWith(1, `/api-proxy/wenyun${taskPath}`, expect.any(Object))
    // 即使返回的是旧域名，也只重建受控代理路径，不把令牌发给响应指定的主机。
    expect(axios.get).toHaveBeenLastCalledWith(
      `/api-proxy/wenyun${taskPath}/media/0`,
      expect.objectContaining({
        responseType: 'blob',
        headers: { Authorization: 'Bearer video-test-key' },
      }),
    )
    expect(onTaskCreated.mock.calls).toEqual([
      [{ taskId, phase: 'downloading' }],
      [{ taskId, phase: 'saving' }],
    ])
    expect(axios.post).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    undefined,
    '',
    42,
    'https://untrusted.example/video.mp4',
    'https://untrusted.example/v1/tasks/async_other/media/0',
    `https://name:password@untrusted.example/v1${taskPath}/media/0`,
    `/v1${taskPath}/media/0?redirect=https://untrusted.example`,
    `/v1${taskPath}/media/0#fragment`,
    `/v1${taskPath}/media/not-an-index`,
    `/v1${taskPath}/media/0/extra`,
    `//untrusted.example/v1${taskPath}/media/0`,
    `ftp://untrusted.example/v1${taskPath}/media/0`,
  ])('完成但地址无效时明确结束，不伪装成仍在生成：%s', async (url) => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: completedTask(url) })
    const request = requestVideoGeneration(config, '', [], [], [], { taskId }).catch((error) => error)
    await vi.advanceTimersByTimeAsync(10)
    const error = await request

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(VideoTaskPendingError)
    expect(error.message).toBe('任务已完成，但没有返回可读取的视频文件')
    expect(axios.get).toHaveBeenCalledTimes(1)
    expect(axios.post).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['failed', 'FAIL', 'FAILURE', 'cancelled', 'canceled', 'error'])(
    '后台终态 %s 立即显示原错误，不继续轮询或下载',
    async (status) => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          id: taskId,
          status,
          error: { message: '上游视频生成失败' },
        },
      })
      const request = requestVideoGeneration(config, '', [], [], [], { taskId }).catch((error) => error)
      await vi.advanceTimersByTimeAsync(10)
      const error = await request

      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(VideoTaskPendingError)
      expect(error.message).toBe('上游视频生成失败')
      expect(axios.get).toHaveBeenCalledTimes(1)
      expect(axios.post).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('查询暂时503后继续读取同一任务，最终下载绝对地址对应的视频', async () => {
    vi.mocked(axios.get)
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } })
      .mockResolvedValueOnce({ data: completedTask(`https://api.xn--v5z30ywuk.com/v1${taskPath}/media/0`) })
      .mockResolvedValueOnce({ data: videoBlob })
    const request = requestVideoGeneration(config, '', [], [], [], { taskId }).catch((error) => error)
    await vi.advanceTimersByTimeAsync(10)

    expect(await request).toBe(videoBlob)
    expect(axios.get).toHaveBeenCalledTimes(3)
    expect(
      vi
        .mocked(axios.get)
        .mock.calls.slice(0, 2)
        .map((call) => call[0]),
    ).toEqual([`/api-proxy/wenyun${taskPath}`, `/api-proxy/wenyun${taskPath}`])
    expect(axios.post).not.toHaveBeenCalled()
  })
})
