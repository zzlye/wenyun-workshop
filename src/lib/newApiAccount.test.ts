import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from './apiProfiles'
import {
  calculateNewApiTopupAmount,
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

  it('refreshes a stale account access token before querying account balance', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = init?.headers as Record<string, string> | undefined
      if (url.includes('/api/user/self') && headers?.Authorization === 'Bearer old-access-token') {
        return new Response(JSON.stringify({ success: false, message: 'Access token invalid' }), { status: 200 })
      }
      if (url.includes('/api/user/token')) {
        return new Response(JSON.stringify({ success: true, data: 'new-access-token' }), { status: 200 })
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
      userId: 35,
    })).resolves.toMatchObject({
      accessToken: 'new-access-token',
      balanceText: '可用 HUHN 6.84 / 已用 HUHN 3.16',
      balanceSource: 'user',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/user/token'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'New-Api-User': '35',
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
})
