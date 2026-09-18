import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchVideoModelList } from './videoModelList'

afterEach(() => vi.unstubAllGlobals())

describe('视频 API 模型列表', () => {
  it('使用视频生成的同源代理和密钥，保留接口新模型并去重', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [
      { id: 'api-video-model-v3' }, { id: 'sd-2.0-933-720p' }, { id: 'api-video-model-v3' },
    ] }) })
    vi.stubGlobal('fetch', request)
    const controller = new AbortController()
    expect(await fetchVideoModelList(' video-key ', false, controller.signal)).toEqual(['api-video-model-v3', 'sd-2.0-933-720p'])
    expect(request).toHaveBeenCalledExactlyOnceWith('/api-proxy/wenyun/models', {
      headers: { Authorization: 'Bearer video-key' }, cache: 'no-store', signal: controller.signal,
    })
  })

  it('再次获取重新请求接口，不继续返回旧的固定选项', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ models: ['first-video'] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ models: ['next-video'] }) })
    vi.stubGlobal('fetch', request)
    expect(await fetchVideoModelList('key', true)).toEqual(['first-video'])
    expect(await fetchVideoModelList('key', true)).toEqual(['next-video'])
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('缺少视频密钥时不发送匿名请求', async () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    await expect(fetchVideoModelList(' ', false)).rejects.toThrow('请先在设置里填写视频 API Key')
    expect(request).not.toHaveBeenCalled()
  })

  it('鉴权失败及空列表明确报错，不伪装成固定模型列表成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    await expect(fetchVideoModelList('bad-key', false)).rejects.toThrow('获取视频模型失败：401')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }))
    await expect(fetchVideoModelList('key', false)).rejects.toThrow('接口没有返回模型列表')
  })
})
