import { describe, expect, it, vi } from 'vitest'

import { getImageBlobExtension, getImageSourceBlob } from './imageTransfer'

describe('image transfer helpers', () => {
  it('converts data urls to blobs without fetching them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const blob = await getImageSourceBlob('data:image/png;base64,aGVsbG8=')

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(blob.type).toBe('image/png')
    expect(await blob.text()).toBe('hello')

    fetchSpy.mockRestore()
  })

  it('downloads locked Wenyun image urls through the same-origin proxy', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['image'], { type: 'image/png' })))

    const blob = await getImageSourceBlob('https://zzlye.xyz/uploads/final.png?token=1')

    expect(fetchSpy).toHaveBeenCalledWith('/newapi-proxy/wenyun/uploads/final.png?token=1', { cache: 'no-store' })
    expect(blob.type).toBe('image/png')

    fetchSpy.mockRestore()
  })

  it('downloads third-party image urls through the generic asset proxy', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['image'], { type: 'image/png' })))

    const blob = await getImageSourceBlob('https://bafang.me/result/final.png?token=1')

    expect(fetchSpy).toHaveBeenCalledWith('/asset-proxy?url=https%3A%2F%2Fbafang.me%2Fresult%2Ffinal.png%3Ftoken%3D1', { cache: 'no-store' })
    expect(blob.type).toBe('image/png')

    fetchSpy.mockRestore()
  })

  it('keeps a useful file extension when servers omit the content type', () => {
    const blob = new Blob(['image'])

    expect(getImageBlobExtension(blob, 'https://example.com/final.webp')).toBe('webp')
  })
})
