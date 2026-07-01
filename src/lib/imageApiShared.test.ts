import { afterEach, describe, expect, it, vi } from 'vitest'

import { FAST_HAND_ERROR_MESSAGE, fetchImageUrlAsDataUrl, GENERIC_QUOTA_ERROR_MESSAGE, getApiErrorMessage, getImageRequestTimeoutSeconds, getSafeImageDisplayUrl, isLongImageRequest, sanitizeApiErrorMessage } from './imageApiShared'

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

  it.each([
    'status_code=429, 服务器繁忙，请求过于频繁，请稍后重试 (rate limited)（上游原因：Resource has been exhausted (e.g. check quota).）',
    'status_code=400, 请求参数有误，请检查请求内容 (invalid argument)（上游原因：Request contains an invalid argument.）',
    'status_code=502, 认证失败，recaptcha 验证未通过，请稍后再试 (auth failed)（上游原因：Could not fetch recaptcha token.）',
  ])('uses a friendly retry message for transient upstream errors: %s', (message) => {
    expect(sanitizeApiErrorMessage(message)).toBe(FAST_HAND_ERROR_MESSAGE)
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

  it('keeps plain text server errors instead of replacing them with JSON parse errors', async () => {
    const response = new Response('upstream engine error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    })

    await expect(getApiErrorMessage(response)).resolves.toBe('upstream engine error')
  })

  it('sanitizes transient upstream errors from JSON error responses', async () => {
    const response = new Response(JSON.stringify({
      error: {
        message: 'status_code=502, 认证失败，recaptcha 验证未通过，请稍后再试 (auth failed)（上游原因：Could not fetch recaptcha token.）',
      },
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })

    await expect(getApiErrorMessage(response)).resolves.toBe(FAST_HAND_ERROR_MESSAGE)
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
