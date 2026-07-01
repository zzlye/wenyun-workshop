import { useState, type CSSProperties } from 'react'
import { useStore } from '../store'
import { LOCKED_WENYUN_PROFILE_ID, getActiveApiProfile, getApiBalanceSnapshot, setApiBalanceSnapshot } from '../lib/apiProfiles'
import { getEffectiveImageApiProfile } from '../lib/accountApiKey'
import { queryNewApiBalance } from '../lib/newApi'
import { fetchNewApiAccountBalance } from '../lib/newApiAccount'
import type { ApiProfile } from '../types'
import AccountLoginModal from './AccountLoginModal'
import PriceTableButton from './PriceTableButton'

type AccountBalanceBarProps = {
  activeProfile?: ApiProfile
  showLoginButton?: boolean
  className?: string
  style?: CSSProperties
  actionButtonClassName?: string
  actionButtonStyle?: CSSProperties
  priceButtonClassName?: string
  priceButtonStyle?: CSSProperties
  loginButtonClassName?: string
  loginButtonStyle?: CSSProperties
}

const defaultBarClassName = 'flex items-center gap-2 rounded-full border border-gray-200/70 bg-white/75 py-1 pl-3 pr-1 text-xs font-medium text-gray-600 shadow-none backdrop-blur dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-gray-300'
const defaultActionButtonClassName = 'shrink-0 rounded-full border border-gray-200/70 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-gray-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:border-blue-400/30 dark:hover:bg-blue-500/15 dark:hover:text-blue-200'

export default function AccountBalanceBar({
  activeProfile: providedActiveProfile,
  showLoginButton = false,
  className,
  style,
  actionButtonClassName,
  actionButtonStyle,
  priceButtonClassName,
  priceButtonStyle,
  loginButtonClassName,
  loginButtonStyle,
}: AccountBalanceBarProps) {
  const settings = useStore((state) => state.settings)
  const setSettings = useStore((state) => state.setSettings)
  const showToast = useStore((state) => state.showToast)
  const activeProfile = providedActiveProfile ?? getActiveApiProfile(settings)
  const effectiveActiveProfile = getEffectiveImageApiProfile(settings, activeProfile)
  const isWenyunProfile = activeProfile.id === LOCKED_WENYUN_PROFILE_ID
  const accountSession = settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID] ?? null
  const useAccountKey = isWenyunProfile && settings.accountApiKeyMode === 'account' && Boolean(accountSession?.boundApiKey)
  const apiBalanceText = useAccountKey
    ? accountSession?.balanceSource === 'user' ? accountSession.balanceText ?? '' : ''
    : getApiBalanceSnapshot(settings, activeProfile.id)?.text ?? ''
  const [isQueryingBalance, setIsQueryingBalance] = useState(false)
  const [showAccountLogin, setShowAccountLogin] = useState(false)
  const actionClassName = actionButtonClassName || defaultActionButtonClassName

  const queryActiveProfileBalance = async () => {
    setIsQueryingBalance(true)
    try {
      if (useAccountKey && accountSession) {
        const session = await fetchNewApiAccountBalance(activeProfile, accountSession)
        const current = useStore.getState().settings
        setSettings({
          ...setApiBalanceSnapshot(current, activeProfile.id, {
            text: session.balanceText ?? '',
            currency: '',
            updatedAt: session.balanceUpdatedAt ?? Date.now(),
          }),
          newApiAccountSessions: {
            ...current.newApiAccountSessions,
            [LOCKED_WENYUN_PROFILE_ID]: session,
          },
        })
        showToast('账号余额已更新', 'success')
        return
      }

      const balance = await queryNewApiBalance(effectiveActiveProfile)
      setSettings(setApiBalanceSnapshot(useStore.getState().settings, activeProfile.id, balance))
      showToast('余额已更新', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '余额查询失败', 'error')
    } finally {
      setIsQueryingBalance(false)
    }
  }

  const switchKeyMode = () => {
    const nextMode = settings.accountApiKeyMode === 'account' ? 'manual' : 'account'
    if (nextMode === 'account' && !accountSession?.boundApiKey) {
      setShowAccountLogin(true)
      showToast('请先登录文运站账号', 'error')
      return
    }
    setSettings({ accountApiKeyMode: nextMode })
  }

  return (
    <>
      <div
        data-no-drag-select
        data-canvas-no-zoom
        className={className || defaultBarClassName}
        style={style}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="min-w-0 truncate">
          {activeProfile.name}{useAccountKey ? '账号' : ''}：{apiBalanceText || '未查询'}
        </span>
        <button
          type="button"
          onClick={queryActiveProfileBalance}
          disabled={isQueryingBalance}
          className="shrink-0 rounded-full bg-blue-500 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isQueryingBalance ? '查询中' : '查询'}
        </button>
        {isWenyunProfile && (
          <button
            type="button"
            onClick={switchKeyMode}
            className={actionClassName}
            style={actionButtonStyle}
          >
            {settings.accountApiKeyMode === 'account' ? '账号Key' : '自定义Key'}
          </button>
        )}
        <PriceTableButton
          activeProfile={activeProfile}
          buttonClassName={priceButtonClassName || actionClassName}
          buttonStyle={priceButtonStyle || actionButtonStyle}
        />
        {showLoginButton && isWenyunProfile && (
          <button
            type="button"
            onClick={() => setShowAccountLogin(true)}
            className={loginButtonClassName || actionClassName}
            style={loginButtonStyle || actionButtonStyle}
          >
            {accountSession ? accountSession.username : '登录'}
          </button>
        )}
      </div>
      <AccountLoginModal open={showAccountLogin} onClose={() => setShowAccountLogin(false)} />
    </>
  )
}
