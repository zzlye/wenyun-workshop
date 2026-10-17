// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchNewApiNotice, type NewApiNoticeResult } from '../lib/newApi'
import { useAnnouncement } from './useAnnouncement'

const preferences = vi.hoisted(() => ({
  announcementDismissedForever: false,
  announcementDismissedDate: undefined as string | undefined,
  announcementDismissedHash: undefined as string | undefined,
}))
vi.mock('../store', () => ({ useStore: { getState: () => ({
  settings: preferences,
  setSettings: (patch: object) => Object.assign(preferences, patch),
}) } }))
vi.mock('../lib/apiProfiles', () => ({ LOCKED_WENYUN_BASE_URL: 'https://example.test' }))
vi.mock('../lib/newApi', () => ({ fetchNewApiNotice: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root
let current: ReturnType<typeof useAnnouncement>
let response: NewApiNoticeResult
const fetchNotice = vi.mocked(fetchNewApiNotice)
const makeNotice = (id: number, content = `公告${id}`): NewApiNoticeResult => ({
  content, items: [{ id, content }], updatedAt: Date.now(),
})
function Probe({ enabled }: { enabled: boolean }) {
  current = useAnnouncement(enabled)
  return current.open ? <div role="dialog">{current.notice.content}</div> : null
}
const render = (enabled = true) => act(async () => root.render(<Probe enabled={enabled} />))
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
const close = () => act(async () => current.setOpen(false))

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(preferences, { announcementDismissedForever: false, announcementDismissedDate: undefined, announcementDismissedHash: undefined })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  response = makeNotice(1)
  fetchNotice.mockReset().mockImplementation(async () => response)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('公告自动提醒（网页和桌面共用）', () => {
  it('不刷新页面即可弹新公告，同一条关闭后不重复弹', async () => {
    await render()
    expect(host.textContent).toBe('公告1')
    await close()
    response = { ...response, updatedAt: Date.now() + 1000 }
    await tick()
    expect(current.open).toBe(false)
    response = makeNotice(2)
    await tick()
    expect(host.textContent).toBe('公告2')
    expect(current.loading).toBe(false)
    await close()
    await tick()
    expect(current.open).toBe(false)
  })

  it('今日免提醒不挡新公告，相同正文重新发布也会提醒', async () => {
    await render()
    await act(async () => current.dismissToday())
    await render(false)
    await render()
    expect(current.open).toBe(false)
    response = makeNotice(2, '公告1')
    await tick()
    expect(current.open).toBe(true)
  })

  it('尊重永久不提醒，但仍可手动查看最新公告', async () => {
    preferences.announcementDismissedForever = true
    await render()
    response = makeNotice(2)
    await tick()
    expect(current.open).toBe(false)
    await act(async () => current.openManually())
    expect(host.textContent).toBe('公告2')
  })

  it('接口失败后保留内容，下一次自动恢复；空公告不弹', async () => {
    await render()
    await close()
    fetchNotice.mockRejectedValueOnce(new Error('暂时断网'))
    await tick()
    expect(current.notice.content).toBe('公告1')
    expect(current.open).toBe(false)
    response = makeNotice(2)
    await tick()
    expect(host.textContent).toBe('公告2')
    await close()
    response = { content: '', items: [], updatedAt: Date.now() }
    await tick()
    expect(current.open).toBe(false)
  })

  it('页面恢复及网络重连立即补查，后台不持续请求', async () => {
    await render()
    await close()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    response = makeNotice(2)
    await tick()
    expect(fetchNotice).toHaveBeenCalledTimes(1)
    visibility.mockReturnValue('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(host.textContent).toBe('公告2')
    await close()
    response = makeNotice(3)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(host.textContent).toBe('公告3')
  })

  it('并发检查合并，手动查看中途关闭后不会被请求结果重新打开', async () => {
    let resolve!: (value: NewApiNoticeResult) => void
    fetchNotice.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await render()
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('online'))
      current.openManually()
    })
    await tick()
    expect(fetchNotice).toHaveBeenCalledTimes(1)
    await close()
    await act(async () => resolve(response))
    expect(current.open).toBe(false)
    await tick()
    expect(current.open).toBe(false)
  })

  it('离开工坊清理订阅，迟到的旧响应不覆盖重进后的新公告', async () => {
    let resolve!: (value: NewApiNoticeResult) => void
    fetchNotice.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await render()
    await render(false)
    await tick()
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(fetchNotice).toHaveBeenCalledTimes(1)
    response = makeNotice(2)
    await render()
    expect(host.textContent).toBe('公告2')
    await act(async () => resolve(makeNotice(1)))
    expect(host.textContent).toBe('公告2')
  })

  it('清理旧公告不算新发布，最新正文修改会提醒', async () => {
    response = { ...makeNotice(2), items: [makeNotice(2).items[0], makeNotice(1).items[0]] }
    await render()
    await close()
    response = makeNotice(2)
    await tick()
    expect(current.open).toBe(false)
    response = makeNotice(2, '公告修订内容')
    await tick()
    expect(host.textContent).toBe('公告修订内容')
  })
})
