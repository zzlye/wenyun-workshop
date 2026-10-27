import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchVideoModelList } from './videoModelList'

afterEach(() => vi.unstubAllGlobals())

describe('视频 API 模型列表', () => {
  it('使用视频生成的同源代理和密钥，保留接口新模型并去重', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [
      { id: 'api-video-model-v3', supported_endpoint_types: ['openai-video'] }, { id: 'sd-2.0-933-720p' }, { id: 'api-video-model-v3', supported_endpoint_types: ['openai-video'] },
    ] }) })
    vi.stubGlobal('fetch', request)
    const controller = new AbortController()
    expect(await fetchVideoModelList(' video-key ', false, controller.signal)).toEqual(['api-video-model-v3', 'sd-2.0-933-720p'])
    expect(request).toHaveBeenCalledExactlyOnceWith('/api-proxy/wenyun/models', {
      headers: { Authorization: 'Bearer video-key' }, cache: 'no-store', signal: expect.any(AbortSignal),
    })
    controller.abort()
    expect(request.mock.calls[0][1].signal.aborted).toBe(true)
  })

  it('再次获取重新请求接口，不继续返回旧的固定选项', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ models: ['sora-first'] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ models: ['sora-next'] }) })
    vi.stubGlobal('fetch', request)
    expect(await fetchVideoModelList('key', true)).toEqual(['sora-first'])
    expect(await fetchVideoModelList('key', true)).toEqual(['sora-next'])
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('缺少视频密钥时不发送匿名请求', async () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    await expect(fetchVideoModelList(' ', false)).rejects.toThrow('视频 Key 尚未就绪，请在设置中查看或登录账号')
    expect(request).not.toHaveBeenCalled()
  })

  it('鉴权失败明确报错，空列表不回退到无权限的固定模型', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    await expect(fetchVideoModelList('bad-key', false)).rejects.toThrow('获取模型失败（401）')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }))
    await expect(fetchVideoModelList('key', false)).resolves.toEqual([])
  })
})
