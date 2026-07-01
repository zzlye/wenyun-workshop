import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from './apiProfiles'
import { loginNewApiAccount, readAccessToken } from './newApiAccount'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readAccessToken', () => {
  it('reads common NewAPI login token fields from nested data', () => {
    expect(readAccessToken({ data: { access_token: 'token-a' } })).toBe('token-a')
    expect(readAccessToken({ data: { accessToken: 'token-b' } })).toBe('token-b')
    expect(readAccessToken({ data: { user: { token: 'token-c' } } })).toBe('token-c')
  })

  it('creates a bound key through NewAPI user token management after login', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/user/login')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            id: 2,
            username: '1',
            display_name: '1',
          },
        }), { status: 200 })
      }
      if (url.includes('/api/user/token')) {
        return new Response(JSON.stringify({
          success: true,
          data: 'user-access-token',
        }), { status: 200 })
      }
      if (url.includes('/api/token/?')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            items: [
              {
                id: 8,
                name: '文运工坊绑定 Key-1-1782934992',
                key: 'abcd**********wxyz',
              },
            ],
          },
        }), { status: 200 })
      }
      if (url.includes('/api/token/8/key')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            key: 'abcd-full-token-wxyz',
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: false, message: 'unexpected request' }), { status: 500 })
    })

    await expect(loginNewApiAccount(DEFAULT_SETTINGS.profiles[0], {
      username: '1',
      password: 'secret',
    })).resolves.toMatchObject({
      username: '1',
      accessToken: 'user-access-token',
      displayName: '1',
      boundApiKey: 'abcd-full-token-wxyz',
      boundApiKeyId: 8,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/user/token'),
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({
          'New-Api-User': '2',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/token/?p=1&size=100'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer user-access-token',
          'New-Api-User': '2',
        }),
      }),
    )
  })
})
