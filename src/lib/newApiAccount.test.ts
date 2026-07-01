import { describe, expect, it } from 'vitest'

import { readAccessToken } from './newApiAccount'

describe('readAccessToken', () => {
  it('reads common NewAPI login token fields from nested data', () => {
    expect(readAccessToken({ data: { access_token: 'token-a' } })).toBe('token-a')
    expect(readAccessToken({ data: { accessToken: 'token-b' } })).toBe('token-b')
    expect(readAccessToken({ data: { user: { token: 'token-c' } } })).toBe('token-c')
  })
})
