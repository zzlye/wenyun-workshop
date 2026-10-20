// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import LotteryModal, { LotteryButton } from './LotteryModal'
import { DEFAULT_SETTINGS, LOCKED_WENYUN_PROFILE_ID } from '../lib/apiProfiles'
import { useStore } from '../store'
import { fetchNewApiAccountBalance } from '../lib/newApiAccount'
import {
  clearLotteryRequest,
  drawNewApiLottery,
  fetchLotteryActivities,
  fetchLotteryDraws,
  fetchLotteryWinners,
  lotteryRequestKey,
  lotterySeenKey,
  type LotteryActivity,
} from '../lib/newApiLottery'

vi.mock('../lib/newApiAccount', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/newApiAccount')>()),
  fetchNewApiAccountBalance: vi.fn(),
  fetchNewApiSiteStatus: vi.fn(async () => ({
    quota_per_unit: 500000,
    quota_display_type: 'CUSTOM',
    custom_currency_symbol: 'HUHN',
    custom_currency_exchange_rate: 1,
  })),
}))
vi.mock('../lib/newApiLottery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/newApiLottery')>()),
  fetchLotteryActivities: vi.fn(),
  fetchLotteryDraws: vi.fn(),
  fetchLotteryWinners: vi.fn(),
  drawNewApiLottery: vi.fn(),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const session = {
  siteProfileId: LOCKED_WENYUN_PROFILE_ID,
  userId: 9001,
  username: 'fixture',
  accessToken: 'fixture-token',
  boundVideoApiKey: 'keep-video-key',
}
const initialSettings = useStore.getState().settings
let root: Root, host: HTMLDivElement, client: QueryClient
let activities: LotteryActivity[]
const reward = { id: 5, activity_id: 12, user_id: 9001, quota: 250000, created_at: 1792494000 }
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25))
  })
}
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <LotteryModal profile={DEFAULT_SETTINGS.profiles[0]} session={session} onClose={() => {}} />
      </QueryClientProvider>,
    ),
  )
  await settle()
}
function button(text: string) {
  const found = Array.from(document.querySelectorAll('button')).find((node) =>
    node.textContent?.includes(text),
  )
  expect(found).toBeDefined()
  return found!
}
async function click(text: string) {
  await act(async () => button(text).click())
  await settle()
}
beforeEach(() => {
  vi.clearAllMocks()
  clearLotteryRequest(lotteryRequestKey(session.userId, 12))
  localStorage.setItem(lotterySeenKey(DEFAULT_SETTINGS.profiles[0].baseUrl, session.userId), '[]')
  localStorage.setItem(lotterySeenKey(DEFAULT_SETTINGS.profiles[0].baseUrl, 9002), '[]')
  activities = [
    {
      id: 12,
      name: '灵感好运礼',
      status: 'active',
      mode: 'random_shares',
      total_quota: 50000000,
      remaining_quota: 30000000,
      min_topup_quota: 5000000,
      eligible_topup_quota: 10000000,
      per_user_limit: 3,
      used_draws: 1,
      remaining_shares: 20,
    } as LotteryActivity,
  ]
  vi.mocked(fetchLotteryActivities).mockImplementation(async () => ({
    items: activities,
    total: activities.length,
    paid_topup_quota: 10000000,
  }))
  vi.mocked(fetchLotteryWinners).mockResolvedValue([{ id: 1, username: '客***人', quota: 250000 }])
  vi.mocked(fetchLotteryDraws).mockResolvedValue({ items: [reward], total: 1 })
  vi.mocked(drawNewApiLottery).mockResolvedValue(reward)
  vi.mocked(fetchNewApiAccountBalance).mockResolvedValue({
    ...session,
    balanceText: '余额 20',
    balanceSource: 'user',
    balanceUpdatedAt: 123,
  })
  useStore.setState({
    settings: { ...DEFAULT_SETTINGS, newApiAccountSessions: { [LOCKED_WENYUN_PROFILE_ID]: session } },
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  host.remove()
  useStore.setState({ settings: initialSettings })
  clearLotteryRequest(lotteryRequestKey(session.userId, 12))
})

it('展示服务端参与资格、脱敏中奖名单和本人记录，成功后刷新赠金余额但保留视频凭据', async () => {
  await render()
  expect(document.body.textContent).toContain('HUHN 60')
  expect(document.body.textContent).toContain('客***人')
  expect(button('立即抽奖').disabled).toBe(false)
  await click('抽奖记录')
  expect(fetchLotteryDraws).toHaveBeenCalledWith(
    expect.anything(),
    session,
    12,
    1,
    expect.anything(),
    expect.any(Function),
  )
  await click('立即抽奖')
  expect(document.body.textContent).toContain('恭喜获得 HUHN 0.5')
  expect(useStore.getState().settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]).toMatchObject({
    balanceText: '余额 20',
    boundVideoApiKey: 'keep-video-key',
  })
})

it('充值不足不能抽奖，未上线的接口给出可重试状态而不伪造活动', async () => {
  activities[0].eligible_topup_quota = 0
  await render()
  expect(button('立即抽奖').disabled).toBe(true)
  expect(drawNewApiLottery).not.toHaveBeenCalled()
  vi.mocked(fetchLotteryActivities).mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['wenyun-lottery'] })
  })
  await settle()
  expect(document.body.textContent).toContain('抽奖活动暂未开放')
})

it('循环中奖栏保留超过六条的完整名单，后台更新不打断手动暂停，复制项不重复读屏', async () => {
  const winners = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    username: `客***${index + 1}`,
    quota: 250000,
  }))
  vi.mocked(fetchLotteryWinners).mockResolvedValue(winners)
  await render()
  const lists = document.querySelectorAll('.wenyun-lottery-ticker-list')
  expect(lists).toHaveLength(2)
  expect(lists[0].children).toHaveLength(8)
  expect(lists[0].textContent).toContain('客***8')
  expect(lists[0].getAttribute('aria-hidden')).toBeNull()
  expect(lists[1].getAttribute('aria-hidden')).toBe('true')
  const pause = document.querySelector<HTMLButtonElement>('[aria-label="暂停滚动"]')!
  await act(async () => pause.click())
  expect(document.querySelector('.wenyun-lottery-ticker')?.getAttribute('data-paused')).toBe('true')
  expect(pause.getAttribute('aria-pressed')).toBe('true')
  vi.mocked(fetchLotteryWinners).mockResolvedValue([
    ...winners,
    { id: 9, username: '新***客', quota: 500000 },
  ])
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['wenyun-lottery'] })
  })
  await settle()
  expect(document.querySelector('.wenyun-lottery-ticker-list')?.children).toHaveLength(9)
  expect(document.querySelector('.wenyun-lottery-ticker')?.getAttribute('data-paused')).toBe('true')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="继续滚动"]')!.click())
  expect(document.querySelector('.wenyun-lottery-ticker')?.getAttribute('data-paused')).toBe('false')
})

it('响应丢失后的重试沿用同一编号，没有自动再次抽奖', async () => {
  vi.mocked(drawNewApiLottery).mockRejectedValueOnce(new TypeError('网络中断')).mockResolvedValueOnce(reward)
  await render()
  await click('立即抽奖')
  expect(drawNewApiLottery).toHaveBeenCalledTimes(1)
  await click('取回抽奖结果')
  const calls = vi.mocked(drawNewApiLottery).mock.calls
  expect(calls[0][3]).toBe(calls[1][3])
  expect(document.body.textContent).toContain('奖励已存入账号赠金余额')
})

it('连续点击只提交一次，在途不能切活动，余额慢请求不阻塞已确认的开奖结果', async () => {
  activities.push({ ...activities[0], id: 13, name: '另一个活动' })
  let finish!: (value: typeof reward) => void
  vi.mocked(drawNewApiLottery).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  vi.mocked(fetchNewApiAccountBalance).mockImplementationOnce(() => new Promise(() => {}))
  await render()
  const start = button('立即抽奖')
  await act(async () => {
    start.click()
    start.click()
  })
  await settle()
  expect(drawNewApiLottery).toHaveBeenCalledTimes(1)
  expect(document.querySelector('select')?.disabled).toBe(true)
  await act(async () => finish(reward))
  await settle()
  expect(document.body.textContent).toContain('恭喜获得 HUHN 0.5')
  expect(button('立即抽奖').disabled).toBe(false)
})

it('当前活动抽完后被重新排序，仍展示该活动的真实开奖结果', async () => {
  activities.push({ ...activities[0], id: 13, name: '另一场活动' })
  vi.mocked(drawNewApiLottery).mockImplementationOnce(async () => {
    activities = [activities[1], { ...activities[0], status: 'exhausted', remaining_quota: 0 }]
    return reward
  })
  await render()
  await click('立即抽奖')
  expect(document.querySelector('select')?.value).toBe('12')
  expect(document.body.textContent).toContain('恭喜获得 HUHN 0.5')
  expect(button('立即抽奖').disabled).toBe(true)
})

it('旧账号的开奖余额响应不能覆盖切换后的账号', async () => {
  let finish!: (value: typeof session & { balanceText: string }) => void
  vi.mocked(fetchNewApiAccountBalance).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await render()
  await click('立即抽奖')
  useStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      newApiAccountSessions: {
        [LOCKED_WENYUN_PROFILE_ID]: { ...session, userId: 9002, balanceText: '新账号余额' },
      },
    },
  })
  await act(async () => finish({ ...session, balanceText: '旧账号余额' }))
  await settle()
  expect(useStore.getState().settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID].balanceText).toBe(
    '新账号余额',
  )
})

it('新活动亮红点，查看后所有入口同步消失，新发布与切换账号再次提醒', async () => {
  const renderButtons = async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <LotteryButton />
          <LotteryButton />
        </QueryClientProvider>,
      ),
    )
    await settle()
  }
  const dots = () => document.querySelectorAll('[aria-label="有新抽奖活动"]')
  await renderButtons()
  expect(dots()).toHaveLength(2)
  // 两个入口共用查询，避免为同一个用户重复检查活动。
  expect(fetchLotteryActivities).toHaveBeenCalledTimes(1)
  await click('幸运抽奖')
  expect(dots()).toHaveLength(0)
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭抽奖"]')!.click())
  await act(async () => root.render(<div />))
  await renderButtons()
  expect(dots()).toHaveLength(0)
  activities = [{ ...activities[0], id: 14, name: '新上线活动' }, ...activities]
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['wenyun-lottery'] })
  })
  await settle()
  expect(dots()).toHaveLength(2)
  await click('幸运抽奖')
  expect(dots()).toHaveLength(0)
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭抽奖"]')!.click())
  await act(async () =>
    useStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        newApiAccountSessions: { [LOCKED_WENYUN_PROFILE_ID]: { ...session, userId: 9002 } },
      },
    }),
  )
  await settle()
  expect(dots()).toHaveLength(2)
})

it('没有进行中活动或尚未登录时不显示红点，未登录不请求私人活动接口', async () => {
  activities[0].status = 'paused'
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <LotteryButton />
      </QueryClientProvider>,
    ),
  )
  await settle()
  expect(document.querySelector('[aria-label="有新抽奖活动"]')).toBeNull()
  vi.mocked(fetchLotteryActivities).mockClear()
  await act(async () => useStore.setState({ settings: { ...DEFAULT_SETTINGS, newApiAccountSessions: {} } }))
  await settle()
  expect(fetchLotteryActivities).not.toHaveBeenCalled()
  expect(document.querySelector('[aria-label="有新抽奖活动"]')).toBeNull()
})
