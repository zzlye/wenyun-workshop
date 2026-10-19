// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountLoginModal from './AccountLoginModal'
import { DEFAULT_SETTINGS, LOCKED_WENYUN_PROFILE_ID, normalizeSettings } from '../lib/apiProfiles'
import type { AppSettings } from '../types'

const fixture = vi.hoisted(() => ({ settings: {} as AppSettings, setSettings: vi.fn(), showToast: vi.fn() }))
vi.mock('../store', () => ({ useStore: Object.assign((selector: (state: typeof fixture) => unknown) => selector(fixture), { getState: () => fixture }) }))
vi.mock('./ReceiptPaymentDialog', () => ({ default: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let host: HTMLDivElement
let required: boolean | undefined
let statusFailed: boolean
let rejectRegistration: boolean
let requests: { url: string; init?: RequestInit }[]
const response = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
const inviteInput = () => document.querySelector('input[aria-label="邀请码"]') as HTMLInputElement
const registerRequests = () => requests.filter(({ url }) => url.endsWith('/api/user/register'))
const statusRequests = () => requests.filter(({ url }) => url.includes('/api/status?'))
const render = (open = true) => act(async () => { root.render(<AccountLoginModal open={open} onClose={() => undefined} />) })
const clickRegister = () => act(async () => {
  const buttons = Array.from(document.querySelectorAll('button')).filter(item => item.textContent === '注册')
  buttons[buttons.length - 1].click()
})

async function fill(placeholder: string, value: string) {
  const input = document.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement
  await act(async () => {
    // 使用原生输入事件，覆盖表单校验、注册请求、登录及绑定 Key 的完整调用链。
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function openRegistration() {
  await render()
  await clickRegister()
  await fill('账号', 'new-user')
  await fill('密码', 'password123')
}

beforeEach(() => {
  required = false
  statusFailed = false
  rejectRegistration = false
  requests = []
  fixture.settings = normalizeSettings({ ...DEFAULT_SETTINGS, newApiAccountSessions: {} })
  fixture.setSettings.mockReset()
  fixture.showToast.mockReset()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    requests.push({ url, init })
    if (url.includes('/api/status?')) {
      if (statusFailed) throw new TypeError('offline')
      return response(required === undefined ? {} : { register_invite_code_required: required })
    }
    if (url.endsWith('/api/user/register')) return rejectRegistration
      ? new Response(JSON.stringify({ success: false, message: '邀请码无效' }))
      : response(true)
    if (url.endsWith('/api/user/login')) return response({ id: 42, username: 'new-user', access_token: 'test-access-token' })
    if (url.endsWith('/api/user/self')) return response({ quota: 0, used_quota: 0, aff_code: 'OWN-CODE', inviter_id: 0 })
    if (url.includes('/api/token/?')) return response({ items: [] })
    if (url.endsWith('/api/token/') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      return response({ id: 88, name: body.name, key: 'test-bound-key' })
    }
    throw new Error('意外请求：' + url)
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.restoreAllMocks()
})

describe('注册跟随 NewAPI 邀请码设置', () => {
  it('关闭必填后留空可完成注册、登录与绑定，不要求存在邀请人', async () => {
    await openRegistration()
    expect(inviteInput().placeholder).toBe('邀请码（选填）')
    expect(inviteInput().required).toBe(false)
    await clickRegister()
    expect(registerRequests()).toHaveLength(1)
    expect(JSON.parse(String(registerRequests()[0].init?.body))).toEqual({ username: 'new-user', password: 'password123' })
    expect(fixture.setSettings).toHaveBeenCalledWith(expect.objectContaining({
      accountApiKeyMode: 'account',
      newApiAccountSessions: expect.objectContaining({
        [LOCKED_WENYUN_PROFILE_ID]: expect.objectContaining({ username: 'new-user', boundApiKey: 'test-bound-key', inviterId: 0, registrationInviteCode: undefined }),
      }),
    }))
    expect(fixture.showToast).toHaveBeenCalledWith('注册成功', 'success')
    expect(statusRequests()).toHaveLength(2)
    expect(statusRequests().every(({ init }) => init?.cache === 'no-store')).toBe(true)
  })

  it.each([true, undefined])('必填或旧接口未提供开关时阻止空邀请码注册：%s', async value => {
    required = value
    await openRegistration()
    expect(inviteInput().required).toBe(true)
    await clickRegister()
    expect(registerRequests()).toHaveLength(0)
    expect(fixture.showToast).toHaveBeenCalledWith('请填写邀请码', 'error')
  })

  it('页面打开期间关闭必填，直接提交也能按最新设置注册', async () => {
    required = true
    await openRegistration()
    required = false
    await clickRegister()
    expect(inviteInput().required).toBe(false)
    expect(registerRequests()).toHaveLength(1)
    expect(fixture.showToast).toHaveBeenCalledWith('注册成功', 'success')
  })

  it('页面打开期间重新开启必填，不沿用旧的选填状态', async () => {
    await openRegistration()
    required = true
    await clickRegister()
    expect(inviteInput().required).toBe(true)
    expect(registerRequests()).toHaveLength(0)
    expect(fixture.showToast).toHaveBeenCalledWith('请填写邀请码', 'error')
  })

  it('关闭再打开注册窗口会重新读取设置', async () => {
    await openRegistration()
    await render(false)
    required = true
    await render()
    expect(inviteInput().required).toBe(true)
    expect(statusRequests()).toHaveLength(2)
  })

  it('读取设置失败不按旧选填状态提交，网络恢复后可以重试', async () => {
    await openRegistration()
    statusFailed = true
    await clickRegister()
    expect(registerRequests()).toHaveLength(0)
    expect(fixture.showToast).toHaveBeenCalledWith('暂时无法获取注册设置，请稍后重试', 'error')
    statusFailed = false
    await clickRegister()
    expect(registerRequests()).toHaveLength(1)
    expect(fixture.showToast).toHaveBeenCalledWith('注册成功', 'success')
  })

  it('选填也保留服务端注册拒绝结果，不继续登录或创建 Key', async () => {
    await openRegistration()
    rejectRegistration = true
    await clickRegister()
    expect(registerRequests()).toHaveLength(1)
    expect(requests.some(({ url }) => url.endsWith('/api/user/login') || url.includes('/api/token/'))).toBe(false)
    expect(fixture.showToast).toHaveBeenCalledWith('邀请码无效', 'error')
    expect(fixture.setSettings).not.toHaveBeenCalled()
  })
})
