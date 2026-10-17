// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReceiptPaymentDialog from './ReceiptPaymentDialog'
import { DEFAULT_SETTINGS } from '../lib/apiProfiles'
import { requestNewApiReceiptOrder, type NewApiReceiptOrder } from '../lib/newApiAccount'

vi.mock('../lib/newApiAccount', () => ({ requestNewApiReceiptOrder: vi.fn() }))
// 只替换绘图组件，覆盖真实订单状态与用户确认流程。
vi.mock('antd', () => ({ QRCode: ({ value }: { value: string }) => <div data-testid="payment-qr">{value}</div> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement
let root: Root
let client: QueryClient
let order: NewApiReceiptOrder
let paid = vi.fn<() => void>()
const request = vi.mocked(requestNewApiReceiptOrder)
const session = { siteProfileId: 'wenyun-site', userId: 42, username: 'fixture', accessToken: 'fixture-token' }

async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><ReceiptPaymentDialog
    profile={DEFAULT_SETTINGS.profiles[0]} session={session} initialOrder={order}
    onSessionUpdated={vi.fn()} onPaid={paid} onClose={vi.fn()}
  /></QueryClientProvider>))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
}
async function click(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === text)
  expect(button).toBeDefined()
  await act(async () => button!.click())
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
}
beforeEach(() => {
  request.mockReset()
  paid = vi.fn()
  order = { trade_no: 'AR-fixture', status: 'pending', paid_time: 0,
    receipt: { amount_cents: 1001, qr_code: '', confirmed_at: 0, expires_at: Math.floor(Date.now() / 1000) + 180 } }
  request.mockImplementation(async (_p, _s, _t, action) => {
    if (action === 'confirm') return { ...order, receipt: { ...order.receipt, confirmed_at: 1, qr_code: 'https://qr.alipay.com/fixture' } }
    if (action === 'close') return { ...order, status: 'closed' }
    return order
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div');document.body.append(host);root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount());client.clear();host.remove();vi.restoreAllMocks() })

describe('收款码付款窗口', () => {
  it('先显示服务器精确金额，用户确认后才显示二维码且不提前报到账', async () => {
    await render()
    expect(host.textContent).toContain('¥10.01')
    expect(host.querySelector('[data-testid="payment-qr"]')).toBeNull()
    await click('确认金额并显示收款码')
    expect(request).toHaveBeenCalledWith(expect.anything(), session, 'AR-fixture', 'confirm', expect.any(Function))
    expect(host.querySelector('[data-testid="payment-qr"]')?.textContent).toBe('https://qr.alipay.com/fixture')
    expect(paid).not.toHaveBeenCalled()
  })
  it('到期即使查询失败也隐藏旧二维码', async () => {
    order.receipt = { ...order.receipt, confirmed_at: 1, qr_code: 'https://qr.alipay.com/fixture', expires_at: Math.floor(Date.now() / 1000) + 2 }
    await render()
    expect(host.querySelector('[data-testid="payment-qr"]')).not.toBeNull()
    request.mockRejectedValue(new Error('网络失败'))
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3000)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(host.querySelector('[data-testid="payment-qr"]')).toBeNull()
    expect(host.textContent).toContain('付款时间已结束')
  })
  it('关闭订单需要再次确认，关闭窗口本身不作为关闭订单请求', async () => {
    await render()
    await click('关闭订单')
    expect(request.mock.calls.some((call) => call[3] === 'close')).toBe(false)
    await click('确认关闭订单')
    expect(host.textContent).toContain('订单已关闭')
    expect(paid).not.toHaveBeenCalled()
  })
  it('收到服务器入账成功才刷新余额，而且只触发一次', async () => {
    order.status = 'success'
    await render()
    expect(host.textContent).toContain('支付已到账')
    expect(paid).toHaveBeenCalledTimes(1)
    await click('刷新状态')
    expect(paid).toHaveBeenCalledTimes(1)
  })
  it('确认失败保留错误且不显示付款码', async () => {
    await render()
    request.mockRejectedValue(new Error('订单已到期'))
    await click('确认金额并显示收款码')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('订单已到期')
    expect(host.querySelector('[data-testid="payment-qr"]')).toBeNull()
    expect(paid).not.toHaveBeenCalled()
  })
})
