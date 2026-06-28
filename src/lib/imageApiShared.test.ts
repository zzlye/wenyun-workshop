import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchImageUrlAsDataUrl, GENERIC_QUOTA_ERROR_MESSAGE, getApiErrorMessage, getImageRequestTimeoutSeconds, getSafeImageDisplayUrl, isLongImageRequest, sanitizeApiErrorMessage } from './imageApiShared'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sanitizeApiErrorMessage', () => {
  it('hides NewAPI pre-charge quota details', () => {
    expect(
      sanitizeApiErrorMessage('status_code=403, 预扣费额度失败, 用户剩余额度: 0.016767, 需要预扣费额度: 0.040000'),
    ).toBe(GENERIC_QUOTA_ERROR_MESSAGE)
  })

  it('keeps ordinary API errors unchanged', () => {
    expect(sanitizeApiErrorMessage('Invalid token')).toBe('Invalid token')
  })
})

describe('getApiErrorMessage', () => {
  it('sanitizes quota details from JSON error responses', async () => {
    const response = new Response(JSON.stringify({
      error: {
        message: '预扣费额度失败, 用户剩余额度: 0.016767, 需要预扣费额度: 0.040000',
      },
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })

    await expect(getApiErrorMessage(response)).resolves.toBe(GENERIC_QUOTA_ERROR_MESSAGE)
  })
})

describe('fetchImageUrlAsDataUrl', () => {
  it('downloads Wenyun root-domain image URLs through the same-origin proxy', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['image'], { type: 'image/png' }), {
      status: 200,
    }))

    await fetchImageUrlAsDataUrl('https://zzlye.xyz/files/final.png', 'image/png')

    expect(fetchMock).toHaveBeenCalledWith('/newapi-proxy/wenyun/files/final.png', expect.any(Object))
  })
})

describe('getSafeImageDisplayUrl', () => {
  it('keeps Wenyun root-domain fallback image URLs on the same-origin proxy', () => {
    expect(getSafeImageDisplayUrl('https://zzlye.xyz/files/final.png')).toBe('/newapi-proxy/wenyun/files/final.png')
  })
})

describe('isLongImageRequest', () => {
  it('treats Image-2 4K aliases as long requests', () => {
    expect(isLongImageRequest('gpt-image-2-4k', { size: '1024x1024' })).toBe(true)
    expect(isLongImageRequest('gpt-image-2-vip', { size: '1024x1024' })).toBe(true)
  })

  it('treats 4K-sized requests as long requests regardless of model', () => {
    expect(isLongImageRequest('gpt-image-2', { size: '3840x2160' })).toBe(true)
  })

  it('keeps ordinary 2K requests on the configured timeout', () => {
    expect(isLongImageRequest('gpt-image-2', { size: '2560x1440' })).toBe(false)
    expect(getImageRequestTimeoutSeconds('gpt-image-2', { size: '2560x1440' }, 120)).toBe(120)
  })

  it('extends long image requests to at least fifteen minutes', () => {
    expect(getImageRequestTimeoutSeconds('gpt-image-2-4k', { size: '3840x2160' }, 120)).toBe(900)
    expect(getImageRequestTimeoutSeconds('Nano-Banana-2', { size: '3840x2160' }, 1200)).toBe(1200)
  })
})
