import { afterEach, describe, expect, it, vi } from 'vitest'
import { dataUrlToBlob, maskDataUrlToPngBlob } from './canvasImage'

describe('参考图本机解码', () => {
  afterEach(() => vi.restoreAllMocks())

  it('网络读取被拒绝时仍能转换参考图和遮罩，保留原始字节', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const dataUrl = 'data:image/png;base64,AAECA/7/'
    for (const blob of [await dataUrlToBlob(dataUrl), await maskDataUrlToPngBlob(dataUrl)]) {
      expect(blob.type).toBe('image/png')
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 3, 254, 255]))
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('非 data 地址仍按原路径读取并补齐缺失的图片类型', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2, 3])))
    const blob = await dataUrlToBlob('blob:local-reference', 'image/webp')
    expect(fetchMock).toHaveBeenCalledWith('blob:local-reference')
    expect(blob.type).toBe('image/webp')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })
})
