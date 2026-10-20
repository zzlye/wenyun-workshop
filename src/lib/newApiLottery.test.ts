// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './apiProfiles'
import {
  clearLotteryRequest,
  drawNewApiLottery,
  ensureLotteryRequest,
  fetchLotteryActivities,
  fetchLotteryDraws,
  fetchLotteryWinners,
  formatLotteryQuota,
  lotteryParticipation,
  lotteryRequestKey,
  readLotteryRequest,
  type LotteryActivity,
} from './newApiLottery'
import { isNewApiBusinessRejection } from './newApiAccount'

const profile = DEFAULT_SETTINGS.profiles[0]
const session = {
  siteProfileId: profile.id,
  username: 'test-user',
  userId: 8,
  accessToken: 'account-access',
  boundApiKey: 'never-use-image-key',
}
const response = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('NewAPI 抽奖协议', () => {
  it('所有用户接口使用账号会话，路径、分页与服务端结构保持一致', async () => {
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => response({ items: [], total: 0 }))
    await fetchLotteryActivities(profile, session, 2)
    await fetchLotteryDraws(profile, session, 12, 3)
    mock.mockImplementation(async () => response([]))
    await fetchLotteryWinners(profile, session, 12)
    mock.mockImplementation(async () => response({ id: 2, activity_id: 12, quota: 100, user_id: 8 }))
    await drawNewApiLottery(profile, session, 12, 'same-request-id')
    expect(mock.mock.calls.map(([url]) => url)).toEqual([
      '/newapi-proxy/wenyun/api/user/lottery?p=2&page_size=10',
      '/newapi-proxy/wenyun/api/user/lottery/12/draws?p=3&page_size=20',
      '/newapi-proxy/wenyun/api/user/lottery/12/winners',
      '/newapi-proxy/wenyun/api/user/lottery/12/draw',
    ])
    for (const [, init] of mock.mock.calls)
      expect(init).toMatchObject({
        credentials: 'include',
        cache: 'no-store',
        headers: { Authorization: 'Bearer account-access', 'New-Api-User': '8' },
      })
    expect(JSON.parse(String(mock.mock.calls[3][1]?.body))).toEqual({ request_id: 'same-request-id' })
  })

  it('登录续期只重放相同抽奖编号，不用图片 Key 降级抽奖', async () => {
    const updated = vi.fn()
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'AUTH_TOKEN_EXPIRED' }), { status: 401 }))
      .mockResolvedValueOnce(
        response({ access_token: 'new-access', id: 8, username: 'test-user', session_id: 'sid' }),
      )
      .mockResolvedValueOnce(response({ id: 1, activity_id: 12, quota: 20 }))
    await drawNewApiLottery(profile, { ...session, authSessionId: 'sid' }, 12, 'replay-protected', updated)
    expect(mock.mock.calls[0][1]?.body).toBe(mock.mock.calls[2][1]?.body)
    expect(mock.mock.calls[2][1]?.headers).toMatchObject({ Authorization: 'Bearer new-access' })
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'new-access' }))
  })

  it('响应丢失保留请求编号，成功或明确拒绝后可清理，并按账号隔离', async () => {
    const key = lotteryRequestKey(8, 12)
    const request = ensureLotteryRequest(key)
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(drawNewApiLottery(profile, session, 12, request)).rejects.toThrow()
    expect(ensureLotteryRequest(key)).toBe(request)
    expect(ensureLotteryRequest(lotteryRequestKey(9, 12))).not.toBe(request)
    clearLotteryRequest(key)
    expect(readLotteryRequest(key)).toBeNull()
  })

  it('区分服务端明确拒绝与可能丢失结果的超时，禁止自动重试抽奖', async () => {
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ success: false, message: '未达到门槛' })))
    const error = await drawNewApiLottery(profile, session, 12, 'business-rejection').catch((error) => error)
    expect(isNewApiBusinessRejection(error)).toBe(true)
    expect(mock).toHaveBeenCalledTimes(1)
    expect(isNewApiBusinessRejection(new TypeError('Failed to fetch'))).toBe(false)
  })

  it('机会和充值资格以每个活动的服务端统计为准，暂停与领完都不能发起新抽奖', () => {
    const activity = {
      status: 'active',
      per_user_limit: 3,
      used_draws: 1,
      eligible_topup_quota: 100,
      min_topup_quota: 50,
      remaining_quota: 10,
    } as LotteryActivity
    expect(lotteryParticipation(activity)).toEqual({ remaining: 2, qualified: true, canDraw: true })
    expect(lotteryParticipation({ ...activity, eligible_topup_quota: 49 }).canDraw).toBe(false)
    expect(lotteryParticipation({ ...activity, used_draws: 3 }).canDraw).toBe(false)
    expect(lotteryParticipation({ ...activity, status: 'paused' }).canDraw).toBe(false)
    expect(lotteryParticipation({ ...activity, remaining_quota: 0 }).canDraw).toBe(false)
  })

  it('额度展示跟随 NewAPI 的单位、币种和汇率，不进行支付金额换算', () => {
    const status = {
      quota_per_unit: 500000,
      quota_display_type: 'CUSTOM',
      custom_currency_symbol: 'HUHN',
      custom_currency_exchange_rate: 2,
    }
    expect(formatLotteryQuota(250000, status)).toBe('HUHN 1')
    expect(formatLotteryQuota(250000, { ...status, quota_display_type: 'USD' })).toBe('$ 0.5')
    expect(formatLotteryQuota(250000, { ...status, quota_display_type: 'CNY', usd_exchange_rate: 7 })).toBe(
      '¥ 3.5',
    )
    expect(formatLotteryQuota(250000, { ...status, quota_display_type: 'TOKENS' })).toBe('250,000 额度')
  })
})
