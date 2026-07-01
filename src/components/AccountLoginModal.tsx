import { useState } from 'react'
import { LOCKED_WENYUN_PROFILE_ID, getActiveApiProfile, normalizeSettings, setApiBalanceSnapshot } from '../lib/apiProfiles'
import {
  ACCOUNT_KEY_REFRESH_COOLDOWN_MS,
  fetchNewApiAccountBalance,
  loginNewApiAccount,
  maskApiKey,
  redeemNewApiCode,
  refreshNewApiBoundKey,
  registerNewApiAccount,
} from '../lib/newApiAccount'
import { useStore } from '../store'
import type { AppSettings, NewApiAccountSession } from '../types'
import { CloseIcon } from './icons'

interface AccountLoginModalProps {
  open: boolean
  onClose: () => void
}

function formatAccountKeyCooldown(ms: number) {
  if (ms <= 0) return ''
  return `${Math.ceil(ms / 60_000)} 分钟后可刷新`
}

export default function AccountLoginModal({ open, onClose }: AccountLoginModalProps) {
  const settings = useStore((state) => state.settings)
  const setSettings = useStore((state) => state.setSettings)
  const showToast = useStore((state) => state.showToast)
  const [accountMode, setAccountMode] = useState<'login' | 'register'>('login')
  const [accountUsername, setAccountUsername] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [accountEmail, setAccountEmail] = useState('')
  const [accountInviteCode, setAccountInviteCode] = useState('')
  const [accountRedeemCode, setAccountRedeemCode] = useState('')
  const [isAccountBusy, setIsAccountBusy] = useState(false)
  const [isRedeemingCode, setIsRedeemingCode] = useState(false)
  const [isRefreshingAccountKey, setIsRefreshingAccountKey] = useState(false)
  const [isQueryingBalance, setIsQueryingBalance] = useState(false)
  const normalizedSettings = normalizeSettings(settings)
  const wenyunProfile = normalizedSettings.profiles.find((profile) => profile.id === LOCKED_WENYUN_PROFILE_ID) ?? getActiveApiProfile(normalizedSettings)
  const accountSession = normalizedSettings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID] ?? null
  const accountKeyCooldownRemainingMs = Math.max(0, ACCOUNT_KEY_REFRESH_COOLDOWN_MS - (Date.now() - (accountSession?.lastKeyRefreshAt ?? 0)))

  if (!open) return null

  const updateAccountSession = (session: NewApiAccountSession | null, patch: Partial<AppSettings> = {}) => {
    const current = normalizeSettings(useStore.getState().settings)
    const nextSessions = { ...current.newApiAccountSessions }
    const previousSession = current.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]
    if (session) {
      nextSessions[LOCKED_WENYUN_PROFILE_ID] = {
        ...session,
        siteProfileId: LOCKED_WENYUN_PROFILE_ID,
        lastKeyRefreshAt: session.lastKeyRefreshAt ?? previousSession?.lastKeyRefreshAt,
        balanceText: session.balanceText ?? (previousSession?.balanceSource === 'user' ? previousSession.balanceText : undefined),
        balanceSource: session.balanceSource ?? (previousSession?.balanceSource === 'user' ? previousSession.balanceSource : undefined),
        balanceUpdatedAt: session.balanceUpdatedAt ?? previousSession?.balanceUpdatedAt,
      }
    }
    else delete nextSessions[LOCKED_WENYUN_PROFILE_ID]
    setSettings({
      ...patch,
      newApiAccountSessions: nextSessions,
    })
  }

  const handleAccountLogin = async () => {
    if (!accountUsername.trim() || !accountPassword) {
      showToast('请填写账号和密码', 'error')
      return
    }
    setIsAccountBusy(true)
    try {
      const session = await loginNewApiAccount(wenyunProfile, {
        username: accountUsername,
        password: accountPassword,
      })
      updateAccountSession(session, { accountApiKeyMode: session.boundApiKey && !normalizedSettings.profiles.find((profile) => profile.id === LOCKED_WENYUN_PROFILE_ID)?.apiKey.trim() ? 'account' : normalizedSettings.accountApiKeyMode })
      setAccountPassword('')
      showToast('登录成功', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '登录失败', 'error')
    } finally {
      setIsAccountBusy(false)
    }
  }

  const handleAccountRegister = async () => {
    if (!accountUsername.trim() || !accountPassword || !accountInviteCode.trim()) {
      showToast('请完整填写注册信息', 'error')
      return
    }
    setIsAccountBusy(true)
    try {
      const session = await registerNewApiAccount(wenyunProfile, {
        username: accountUsername,
        password: accountPassword,
        email: accountEmail,
        inviteCode: accountInviteCode,
      })
      updateAccountSession(session, { accountApiKeyMode: session.boundApiKey && !normalizedSettings.profiles.find((profile) => profile.id === LOCKED_WENYUN_PROFILE_ID)?.apiKey.trim() ? 'account' : normalizedSettings.accountApiKeyMode })
      setAccountPassword('')
      showToast('注册成功', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '注册失败', 'error')
    } finally {
      setIsAccountBusy(false)
    }
  }

  const handleRefreshAccountBalance = async () => {
    if (!accountSession) return
    setIsQueryingBalance(true)
    try {
      const session = await fetchNewApiAccountBalance(wenyunProfile, accountSession)
      updateAccountSession(session, {
        ...setApiBalanceSnapshot(normalizeSettings(useStore.getState().settings), LOCKED_WENYUN_PROFILE_ID, {
          text: session.balanceText ?? '',
          currency: '',
          updatedAt: session.balanceUpdatedAt ?? Date.now(),
        }),
      })
      showToast('账号余额已更新', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '账号余额查询失败', 'error')
    } finally {
      setIsQueryingBalance(false)
    }
  }

  const handleRefreshAccountKey = async () => {
    if (!accountSession) return
    setIsRefreshingAccountKey(true)
    try {
      const session = await refreshNewApiBoundKey(wenyunProfile, accountSession)
      updateAccountSession(session)
      showToast('账号 Key 已刷新', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '刷新 Key 失败', 'error')
    } finally {
      setIsRefreshingAccountKey(false)
    }
  }

  const handleRedeemCode = async () => {
    if (!accountSession) {
      showToast('请先登录账号', 'error')
      return
    }
    if (!accountRedeemCode.trim()) {
      showToast('请输入兑换码', 'error')
      return
    }
    setIsRedeemingCode(true)
    try {
      const session = await redeemNewApiCode(wenyunProfile, accountSession, accountRedeemCode)
      updateAccountSession(session)
      setAccountRedeemCode('')
      showToast('兑换成功', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '兑换失败', 'error')
    } finally {
      setIsRedeemingCode(false)
    }
  }

  const handleAccountLogout = () => {
    const manualKey = normalizedSettings.profiles.find((profile) => profile.id === LOCKED_WENYUN_PROFILE_ID)?.apiKey.trim() ?? ''
    updateAccountSession(null, { accountApiKeyMode: manualKey ? 'manual' : normalizedSettings.accountApiKeyMode })
    showToast('账号已退出', 'success')
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 px-4 py-8 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl border border-white/60 bg-white/95 p-5 shadow-2xl backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-950/95">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">文运站账号</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">登录后可使用账号绑定 Key 和兑换码。</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-gray-100" aria-label="关闭">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {accountSession ? (
          <div className="space-y-3">
            <div className="grid gap-3 rounded-xl border border-gray-200/70 bg-white/70 p-3 text-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-gray-500 dark:text-gray-400">当前账号</span>
                <span className="font-medium text-gray-800 dark:text-gray-100">{accountSession.displayName || accountSession.username}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-gray-500 dark:text-gray-400">绑定 Key</span>
                <span className="font-mono text-xs text-gray-700 dark:text-gray-200">{maskApiKey(accountSession.boundApiKey)}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-gray-500 dark:text-gray-400">账号余额</span>
                <span className="text-gray-700 dark:text-gray-200">{accountSession.balanceSource === 'user' && accountSession.balanceText ? accountSession.balanceText : '未查询'}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleRefreshAccountBalance} disabled={isQueryingBalance} className="rounded-xl border border-gray-200/70 bg-white/70 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:border-blue-400/30 dark:hover:bg-blue-500/15 dark:hover:text-blue-200">
                {isQueryingBalance ? '查询中...' : '查询账号余额'}
              </button>
              <button type="button" onClick={handleRefreshAccountKey} disabled={isRefreshingAccountKey || accountKeyCooldownRemainingMs > 0} className="rounded-xl border border-gray-200/70 bg-white/70 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:border-blue-400/30 dark:hover:bg-blue-500/15 dark:hover:text-blue-200">
                {isRefreshingAccountKey ? '刷新中...' : accountKeyCooldownRemainingMs > 0 ? formatAccountKeyCooldown(accountKeyCooldownRemainingMs) : '刷新绑定 Key'}
              </button>
              <button type="button" onClick={handleAccountLogout} className="rounded-xl border border-gray-200/70 bg-white/70 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:border-red-400/30 dark:hover:bg-red-500/15 dark:hover:text-red-200">
                退出登录
              </button>
            </div>
            <div className="flex gap-2">
              <input value={accountRedeemCode} onChange={(event) => setAccountRedeemCode(event.target.value)} placeholder="兑换码" className="min-w-0 flex-1 rounded-xl border border-gray-200/70 bg-white/70 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50" />
              <button type="button" onClick={handleRedeemCode} disabled={isRedeemingCode} className="shrink-0 rounded-xl bg-blue-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50">
                {isRedeemingCode ? '兑换中...' : '兑换'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-100/80 p-1 text-xs dark:bg-black/20">
              <button type="button" onClick={() => setAccountMode('login')} className={`rounded-lg px-3 py-2 font-medium transition ${accountMode === 'login' ? 'bg-white text-blue-600 shadow-sm dark:bg-white/[0.08] dark:text-blue-200' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}>登录</button>
              <button type="button" onClick={() => setAccountMode('register')} className={`rounded-lg px-3 py-2 font-medium transition ${accountMode === 'register' ? 'bg-white text-blue-600 shadow-sm dark:bg-white/[0.08] dark:text-blue-200' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}>注册</button>
            </div>
            <input value={accountUsername} onChange={(event) => setAccountUsername(event.target.value)} placeholder="账号" className="w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50" />
            <input value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} type="password" placeholder="密码" className="w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50" />
            {accountMode === 'register' && (
              <>
                <input value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} placeholder="邮箱（可选）" className="w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50" />
                <input value={accountInviteCode} onChange={(event) => setAccountInviteCode(event.target.value)} placeholder="邀请码" className="w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50" />
              </>
            )}
            <button type="button" onClick={accountMode === 'login' ? handleAccountLogin : handleAccountRegister} disabled={isAccountBusy} className="w-full rounded-xl bg-blue-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50">
              {isAccountBusy ? '处理中...' : accountMode === 'login' ? '登录' : '注册'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
