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

  it('accepts NewAPI login responses that only return user data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        id: 2,
        username: '1',
        display_name: '1',
      },
    }), { status: 200 }))

    await expect(loginNewApiAccount(DEFAULT_SETTINGS.profiles[0], {
      username: '1',
      password: 'secret',
    })).resolves.toMatchObject({
      username: '1',
      accessToken: '',
      displayName: '1',
    })
  })
})
