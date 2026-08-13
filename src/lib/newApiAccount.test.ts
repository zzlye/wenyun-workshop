import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from './apiProfiles'
import {
  calculateNewApiTopupAmount,
  createNewApiBoundToken,
  createNewApiTopupOrder,
  fetchNewApiAccountBalance,
  fetchNewApiTopupInfo,
  loginNewApiAccount,
  normalizeNewApiAccountErrorMessage,
  readAccessToken,
  registerNewApiAccount,
} from './newApiAccount'

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
      if (url.includes('/api/user/self')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            quota: 5_000_000,
            used_quota: 0,
            aff_code: 'PC7X',
            inviter_id: 1,
            inviter_name: '邀请人账号',
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
      balanceText: '可用 HUHN 10 / 已用 HUHN 0',
      inviteCode: 'PC7X',
      inviter: '邀请人账号',
      inviterId: 1,
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
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/user/self'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer user-access-token',
          'New-Api-User': '2',
        }),
      }),
    )
  })

  it('keeps the device login token instead of resetting the account management token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = init?.headers as Record<string, string> | undefined
      if (url.includes('/api/user/login')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            access_token: 'short-lived-login-token',
            access_expires_at: 1_800_000_000,
            session: { sid: 'device-session-22' },
            user: {
              id: 22,
              username: 'new-auth-user',
            },
          },
        }), { status: 200 })
      }
      if (url.includes('/api/token/?')) {
        if (headers?.Authorization !== 'Bearer short-lived-login-token') {
          return new Response(JSON.stringify({ success: false, message: 'access token 无效' }), { status: 401 })
        }
        return new Response(JSON.stringify({
          success: true,
          data: {
            items: [{
              id: 18,
              name: 'wy-bound-existing',
              key: 'persistent-bound-api-key',
            }],
          },
        }), { status: 200 })
      }
      if (url.includes('/api/user/self')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            quota: 4_500_000,
            used_quota: 500_000,
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: false, message: 'unexpected request' }), { status: 500 })
    })

    await expect(loginNewApiAccount(DEFAULT_SETTINGS.profiles[0], {
      username: 'new-auth-user',
      password: 'secret',
    })).resolves.toMatchObject({
      accessToken: 'short-lived-login-token',
      authSessionId: 'device-session-22',
      accessTokenExpiresAt: 1_800_000_000,
      boundApiKey: 'persistent-bound-api-key',
      balanceText: '可用 HUHN 9 / 已用 HUHN 1',
    })

    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/user/token'))).toBe(false)
  })

  it('uses a short bound key name for long account names', async () => {
    let requestedName = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      requestedName = String(body.name ?? '')
      return new Response(JSON.stringify({
        success: true,
        data: {
          id: 9,
          name: requestedName,
          key: 'created-bound-key',
        },
      }), { status: 200 })
    })

    await expect(createNewApiBoundToken(DEFAULT_SETTINGS.profiles[0], {
      siteProfileId: DEFAULT_SETTINGS.profiles[0].id,
      username: '1511488406@qq.com-extra-long-account-name',
      accessToken: 'user-access-token',
      userId: 9,
    })).resolves.toMatchObject({
      key: 'created-bound-key',
      id: 9,
    })

    expect(requestedName).toMatch(/^wy-bound-/)
    expect(requestedName).not.toContain('1511488406@qq.com')
    expect(new TextEncoder().encode(requestedName).length).toBeLessThanOrEqual(50)
  })

  it('refreshes a stale device session before querying account balance', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = init?.headers as Record<string, string> | undefined
      if (url.includes('/api/user/self') && headers?.Authorization === 'Bearer old-access-token') {
        return new Response(JSON.stringify({ success: false, message: 'Access token invalid' }), { status: 200 })
      }
      if (url.includes('/api/user/auth/refresh')) {
        return new Response(JSON.stringify({
          success: true,
          data: { access_token: 'new-access-token', session: { sid: 'session-35' } },
        }), { status: 200 })
      }
      if (url.includes('/api/user/self') && headers?.Authorization === 'Bearer new-access-token') {
        return new Response(JSON.stringify({
          success: true,
          data: {
            quota: 3_420_000,
            used_quota: 1_580_000,
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: false, message: 'unexpected request' }), { status: 500 })
    })

    await expect(fetchNewApiAccountBalance(DEFAULT_SETTINGS.profiles[0], {
      siteProfileId: DEFAULT_SETTINGS.profiles[0].id,
      username: '1',
      accessToken: 'old-access-token',
      authSessionId: 'session-35',
      userId: 35,
    })).resolves.toMatchObject({
      accessToken: 'new-access-token',
      balanceText: '可用 HUHN 6.84 / 已用 HUHN 3.16',
      balanceSource: 'user',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/user/auth/refresh'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Auth-Session': 'session-35',
        }),
      }),
    )
  })

  it('refreshes an expired stored login JWT before querying balance', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = init?.headers as Record<string, string> | undefined
      if (url.includes('/api/user/auth/refresh')) {
        return new Response(JSON.stringify({
          success: true,
          data: { access_token: 'refreshed-jwt-token', session: { sid: 'jwt-session' } },
        }), { status: 200 })
      }
      if (url.includes('/api/user/self')) {
        if (headers?.Authorization === 'Bearer header.payload.signature') {
          return new Response(JSON.stringify({ success: false, message: 'access token 无效' }), { status: 401 })
        }
        return new Response(JSON.stringify({
          success: true,
          data: {
            quota: 2_500_000,
            used_quota: 500_000,
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: false, message: 'unexpected request' }), { status: 500 })
    })

    await expect(fetchNewApiAccountBalance(DEFAULT_SETTINGS.profiles[0], {
      siteProfileId: DEFAULT_SETTINGS.profiles[0].id,
      username: 'jwt-user',
      accessToken: 'header.payload.signature',
      authSessionId: 'jwt-session',
      userId: 36,
    })).resolves.toMatchObject({
      accessToken: 'refreshed-jwt-token',
      balanceText: '可用 HUHN 5 / 已用 HUHN 1',
    })

    const selfRequest = fetchMock.mock.calls.find(([input, init]) =>
      String(input).includes('/api/user/self')
      && (init?.headers as Record<string, string> | undefined)?.Authorization === 'Bearer refreshed-jwt-token')
    expect(selfRequest?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer refreshed-jwt-token',
      }),
    }))
  })

  it('自动迁移属于同一账号的历史登录记录', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = init?.headers as Record<string, string> | undefined
      if (url.includes('/api/user/self') && headers?.Authorization === 'Bearer legacy-token') {
        return new Response(JSON.stringify({ success: false, message: 'access token 无效' }), { status: 401 })
      }
      if (url.includes('/api/user/auth/refresh')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            access_token: 'migrated-token',
            session: { sid: 'migrated-session' },
            user: { id: 37, username: 'legacy-user', display_name: '历史用户' },
          },
        }), { status: 200 })
      }
      if (url.includes('/api/user/self') && headers?.Authorization === 'Bearer migrated-token') {
        return new Response(JSON.stringify({
          success: true,
          data: { quota: 2_500_000, used_quota: 500_000 },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: false, message: 'unexpected request' }), { status: 500 })
    })

    await expect(fetchNewApiAccountBalance(DEFAULT_SETTINGS.profiles[0], {
      siteProfileId: DEFAULT_SETTINGS.profiles[0].id,
      username: 'legacy-user',
      accessToken: 'legacy-token',
      userId: 37,
    })).resolves.toMatchObject({
      accessToken: 'migrated-token',
      authSessionId: 'migrated-session',
      displayName: '历史用户',
      balanceText: '可用 HUHN 5 / 已用 HUHN 1',
    })

    const refreshRequest = fetchMock.mock.calls.find(([input]) => String(input).includes('/api/user/auth/refresh'))
    expect(refreshRequest?.[1]).toEqual(expect.objectContaining({ headers: {} }))
  })

  it('拒绝使用属于其他账号的刷新 Cookie', async () => {
    let topupRequests = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/user/topup/info')) {
        topupRequests += 1
        return new Response(JSON.stringify({ success: false, message: 'access token 无效' }), { status: 401 })
      }
      if (url.includes('/api/user/auth/refresh')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            access_token: 'other-account-token',
            session: { sid: 'other-account-session' },
            user: { id: 99, username: 'other-user' },
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: false, message: 'unexpected request' }), { status: 500 })
    })

    await expect(fetchNewApiTopupInfo(DEFAULT_SETTINGS.profiles[0], {
      siteProfileId: DEFAULT_SETTINGS.profiles[0].id,
      username: 'legacy-user',
      accessToken: 'legacy-token',
      userId: 37,
    })).rejects.toThrow('登录状态已过期，请退出账号后重新登录')

    expect(topupRequests).toBe(1)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/user/auth/refresh'))).toHaveLength(1)
  })

  it('uses the bound API key when the stored account token can no longer be refreshed', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/user/self')) {
        return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), { status: 401 })
      }
      if (url.includes('/api/user/auth/refresh')) {
        return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), { status: 401 })
      }
      if (url.includes('/api/usage/token/')) {
        return new Response(JSON.stringify({
          code: true,
          message: 'ok',
          data: {
            unlimited_quota: true,
            account: {
              quota: 3_420_000,
              used_quota: 1_580_000,
            },
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: false, message: 'unexpected request' }), { status: 500 })
    })

    await expect(fetchNewApiAccountBalance(DEFAULT_SETTINGS.profiles[0], {
      siteProfileId: DEFAULT_SETTINGS.profiles[0].id,
      username: 'expired-user',
      accessToken: 'expired-account-token',
      userId: 37,
      boundApiKey: 'still-valid-bound-key',
    })).resolves.toMatchObject({
      accessToken: 'expired-account-token',
      balanceText: '可用 HUHN 6.84 / 已用 HUHN 3.16',
      balanceSource: 'user',
    })

    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/user/self'))).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/user/auth/refresh'))).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/usage/token/'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer still-valid-bound-key',
        }),
      }),
    )
  })

  it('turns NewAPI validation messages into clear register errors', () => {
    expect(normalizeNewApiAccountErrorMessage("Key: 'User.Password' Error:Field validation for 'Password' failed on the 'min' tag")).toBe('密码至少 8 位')
    expect(normalizeNewApiAccountErrorMessage("Key: 'User.Username' Error:Field validation for 'Username' failed on the 'max' tag")).toBe('账号太长，请换短一点的账号')
  })

  it('rejects registration when NewAPI reports an invalid invite code without deleting the user', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/user/register')) {
        return new Response(JSON.stringify({ success: false, message: '邀请码无效' }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: false, message: 'unexpected request' }), { status: 500 })
    })

    await expect(registerNewApiAccount(DEFAULT_SETTINGS.profiles[0], {
      username: 'bad-invite-user',
      password: 'password123',
      inviteCode: 'RANDOM',
    })).rejects.toThrow('邀请码无效')

    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/user/login'), expect.anything())
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/user/self'), expect.objectContaining({ method: 'DELETE' }))
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/token/'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('rejects registration when NewAPI accepts an invite code but returns no inviter', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/user/register')) {
        return new Response(JSON.stringify({ success: true, data: true }), { status: 200 })
      }
      if (url.includes('/api/user/login')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            id: 12,
            username: 'bad-invite-user',
          },
        }), { status: 200 })
      }
      if (url.includes('/api/user/token')) {
        return new Response(JSON.stringify({ success: true, data: 'user-access-token' }), { status: 200 })
      }
      if (url.includes('/api/user/self')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            quota: 0,
            used_quota: 0,
            aff_code: 'SELF',
            inviter_id: 0,
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: false, message: 'unexpected request' }), { status: 500 })
    })

    await expect(registerNewApiAccount(DEFAULT_SETTINGS.profiles[0], {
      username: 'bad-invite-user',
      password: 'password123',
      inviteCode: 'RANDOM',
    })).rejects.toThrow('邀请码无效')

    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/user/self'), expect.objectContaining({ method: 'DELETE' }))
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/token/'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('keeps the registration invite code separate from the account invite code', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/user/register')) {
        return new Response(JSON.stringify({ success: true, data: true }), { status: 200 })
      }
      if (url.includes('/api/user/login')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            id: 26,
            username: 'wafaaf',
          },
        }), { status: 200 })
      }
      if (url.includes('/api/user/token')) {
        return new Response(JSON.stringify({ success: true, data: 'user-access-token' }), { status: 200 })
      }
      if (url.includes('/api/user/self')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            quota: 0,
            used_quota: 0,
            aff_code: 'oDIu',
            inviter_id: 26,
          },
        }), { status: 200 })
      }
      if (url.includes('/api/token/?')) {
        return new Response(JSON.stringify({ success: true, data: { items: [] } }), { status: 200 })
      }
      if (url.includes('/api/token/')) {
        const body = init?.body ? JSON.parse(String(init.body)) : {}
        return new Response(JSON.stringify({
          success: true,
          data: {
            id: 88,
            name: body.name,
            key: 'created-bound-key',
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: false, message: 'unexpected request' }), { status: 500 })
    })

    await expect(registerNewApiAccount(DEFAULT_SETTINGS.profiles[0], {
      username: 'wafaaf',
      password: 'password123',
      inviteCode: 'USED-CODE',
    })).resolves.toMatchObject({
      inviteCode: 'oDIu',
      registrationInviteCode: 'USED-CODE',
      inviterId: 26,
      boundApiKey: 'created-bound-key',
    })
  })
})

describe('NewAPI 在线支付', () => {
  const session = {
    siteProfileId: DEFAULT_SETTINGS.profiles[0].id,
    username: 'payment-user',
    accessToken: 'payment-access-token',
    userId: 42,
  }

  it('读取后台启用的支付方式和充值金额', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        enable_online_topup: true,
        min_topup: 10,
        amount_options: '[10,20,50]',
        pay_methods: JSON.stringify([
          { name: '支付宝', type: 'alipay', min_topup: '10' },
          { name: '微信支付', type: 'wxpay', min_topup: '20' },
        ]),
      },
    }), { status: 200 }))

    await expect(fetchNewApiTopupInfo(DEFAULT_SETTINGS.profiles[0], session)).resolves.toEqual({
      enabled: true,
      minTopup: 10,
      amountOptions: [10, 20, 50],
      paymentMethods: [
        { name: '支付宝', type: 'alipay', minTopup: 10 },
        { name: '微信支付', type: 'wxpay', minTopup: 20 },
      ],
    })
  })

  it('试算失败时显示 NewAPI 返回的具体原因', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      message: 'error',
      data: '充值数量不能小于 10',
    }), { status: 200 }))

    await expect(calculateNewApiTopupAmount(
      DEFAULT_SETTINGS.profiles[0],
      session,
      5,
      'alipay',
    )).rejects.toThrow('充值数量不能小于 10')
  })

  it('保留易支付订单外层地址和表单参数', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      message: 'success',
      url: 'https://pay.example.com/submit.php',
      data: {
        pid: '1001',
        money: '10.00',
        type: 'alipay',
      },
    }), { status: 200 }))

    await expect(createNewApiTopupOrder(
      DEFAULT_SETTINGS.profiles[0],
      session,
      10,
      'alipay',
    )).resolves.toEqual({
      kind: 'form',
      url: 'https://pay.example.com/submit.php',
      fields: {
        pid: '1001',
        money: '10.00',
        type: 'alipay',
      },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/user/pay'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer payment-access-token',
          'New-Api-User': '42',
        }),
      }),
    )
  })

  it('充值配置令牌过期时刷新会话后只重试一次', async () => {
    const refreshedSessions: string[] = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = init?.headers as Record<string, string> | undefined
      if (url.includes('/api/user/topup/info')) {
        if (headers?.Authorization !== 'Bearer refreshed-session-token') {
          return new Response(JSON.stringify({ success: false, message: 'access token 无效' }), { status: 401 })
        }
        return new Response(JSON.stringify({
          success: true,
          data: {
            enable_online_topup: true,
            min_topup: 10,
            pay_methods: JSON.stringify([{ name: '支付宝', type: 'alipay', min_topup: 10 }]),
          },
        }), { status: 200 })
      }
      if (url.includes('/api/user/auth/refresh')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            access_token: 'refreshed-session-token',
            access_expires_at: 1_800_000_000,
            session: { sid: 'session-42' },
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: false, message: 'unexpected request' }), { status: 500 })
    })

    await expect(fetchNewApiTopupInfo(
      DEFAULT_SETTINGS.profiles[0],
      { ...session, accessToken: 'expired-session-token', authSessionId: 'session-42' },
      (nextSession) => refreshedSessions.push(nextSession.accessToken),
    )).resolves.toMatchObject({ enabled: true, minTopup: 10 })

    expect(refreshedSessions).toEqual(['refreshed-session-token'])
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/user/topup/info'))).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/user/auth/refresh'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Auth-Session': 'session-42' }),
      }),
    )
  })

  it('创建订单仅在明确鉴权失败时刷新并重放一次', async () => {
    let orderRequests = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = init?.headers as Record<string, string> | undefined
      if (url.includes('/api/user/pay')) {
        orderRequests += 1
        if (headers?.Authorization !== 'Bearer refreshed-order-token') {
          return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), { status: 401 })
        }
        return new Response(JSON.stringify({
          message: 'success',
          url: 'https://pay.example.com/submit.php',
          data: { money: '10.00' },
        }), { status: 200 })
      }
      if (url.includes('/api/user/auth/refresh')) {
        return new Response(JSON.stringify({
          success: true,
          data: { access_token: 'refreshed-order-token', session: { sid: 'session-42' } },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: false, message: 'unexpected request' }), { status: 500 })
    })

    await expect(createNewApiTopupOrder(
      DEFAULT_SETTINGS.profiles[0],
      { ...session, accessToken: 'expired-order-token', authSessionId: 'session-42' },
      10,
      'alipay',
    )).resolves.toMatchObject({ kind: 'form', url: 'https://pay.example.com/submit.php' })

    expect(orderRequests).toBe(2)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/user/auth/refresh'))).toHaveLength(1)
  })
})
