import { useState } from 'react'
import { useStore } from '../store'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import { LOCKED_WENYUN_PROFILE_ID, getActiveApiProfile, getApiBalanceSnapshot, setApiBalanceSnapshot } from '../lib/apiProfiles'
import { getEffectiveImageApiProfile } from '../lib/accountApiKey'
import { queryNewApiBalance } from '../lib/newApi'
import { AnimatedThemeToggler } from '../infiniteCanvasSource/components/ui/animated-theme-toggler'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import { HelpCircleIcon, SettingsIcon, SparklesIcon } from './icons'
import PriceTableButton from './PriceTableButton'
import AccountLoginModal from './AccountLoginModal'

type HeaderProps = {
  onOpenCanvas?: () => void
}

export default function Header({ onOpenCanvas }: HeaderProps) {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setSettings = useStore((s) => s.setSettings)
  const showToast = useStore((s) => s.showToast)
  const settings = useStore((s) => s.settings)
  const appearanceNightMode = settings.appearanceNightMode
  const activeProfile = getActiveApiProfile(settings)
  const effectiveActiveProfile = getEffectiveImageApiProfile(settings, activeProfile)
  const isWenyunProfile = activeProfile.id === LOCKED_WENYUN_PROFILE_ID
  const accountSession = settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID] ?? null
  const apiBalanceText = getApiBalanceSnapshot(settings, activeProfile.id)?.text ?? ''
  const [isQueryingBalance, setIsQueryingBalance] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showAccountLogin, setShowAccountLogin] = useState(false)
  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()

  const queryActiveProfileBalance = async () => {
    setIsQueryingBalance(true)
    try {
      const balance = await queryNewApiBalance(effectiveActiveProfile)
      setSettings(setApiBalanceSnapshot(useStore.getState().settings, activeProfile.id, balance))
      showToast('余额已更新', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '余额查询失败', 'error')
    } finally {
      setIsQueryingBalance(false)
    }
  }

  const switchKeyMode = (mode: 'manual' | 'account') => {
    if (mode === 'account' && !accountSession?.boundApiKey) {
      setShowAccountLogin(true)
      showToast('请先登录文运站账号', 'error')
      return
    }
    setSettings({ accountApiKeyMode: mode })
  }

  return (
    <>
      <header data-no-drag-select className="safe-area-top fixed top-0 left-0 right-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200 dark:border-white/[0.08] transition-transform duration-300 ease-in-out">
        <div className="safe-area-x safe-header-inner max-w-7xl mx-auto flex items-center justify-between relative">
          <div className="flex-1 min-w-0 pr-2 flex items-center gap-2">
            <h1 className="inline-flex items-start relative mr-2">
              <span className="text-[17px] sm:text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100 transition-colors">
                文运工坊
              </span>
            </h1>
            <button
              type="button"
              onClick={onOpenCanvas}
              className="canvas-launch-button"
            >
              <SparklesIcon className="h-4 w-4" />
              <span>画布工坊</span>
            </button>
          </div>
          <div className="absolute left-1/2 top-1/2 hidden max-w-[48vw] -translate-x-1/2 -translate-y-1/2 sm:block">
            <div className="flex items-center gap-2 rounded-full border border-gray-200/70 bg-white/75 py-1 pl-3 pr-1 text-xs font-medium text-gray-600 shadow-none backdrop-blur dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-gray-300">
              <span className="min-w-0 truncate">
                {activeProfile.name}：{apiBalanceText || '未查询'}
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
                <div className="ml-1 flex overflow-hidden rounded-full border border-gray-200/70 bg-white/70 p-0.5 dark:border-white/[0.08] dark:bg-white/[0.04]">
                  <button
                    type="button"
                    onClick={() => switchKeyMode('manual')}
                    className={`rounded-full px-2 py-0.5 text-[11px] transition ${settings.accountApiKeyMode !== 'account' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                  >
                    手动Key
                  </button>
                  <button
                    type="button"
                    onClick={() => switchKeyMode('account')}
                    className={`rounded-full px-2 py-0.5 text-[11px] transition ${settings.accountApiKeyMode === 'account' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                  >
                    账号Key
                  </button>
                </div>
              )}
              {isWenyunProfile && (
                <button
                  type="button"
                  onClick={() => setShowAccountLogin(true)}
                  className="shrink-0 rounded-full bg-gray-900/80 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-gray-900 dark:bg-white/[0.12] dark:text-gray-100 dark:hover:bg-white/[0.18]"
                >
                  充值
                </button>
              )}
              <PriceTableButton activeProfile={activeProfile} />
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowAccountLogin(true)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 shadow-none transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-900 dark:hover:text-gray-100"
            >
              {accountSession ? accountSession.username : '登录'}
            </button>
            <div
              className="relative"
              {...helpTooltip.handlers}
            >
              <button
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="p-2 rounded-lg shadow-none hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="操作指南"
              >
                <HelpCircleIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                操作指南
              </ViewportTooltip>
            </div>
            <AnimatedThemeToggler
              theme={appearanceNightMode ? 'dark' : 'light'}
              onThemeChange={(theme) => setSettings({ appearanceNightMode: theme === 'dark' })}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-600 shadow-none transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100 [&_svg]:h-5 [&_svg]:w-5"
              aria-label={appearanceNightMode ? '切换到白天模式' : '切换到夜间模式'}
              title={appearanceNightMode ? '切换到白天模式' : '切换到夜间模式'}
            />
            <div
              className="relative"
              {...settingsTooltip.handlers}
            >
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-lg shadow-none hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="设置"
              >
                <SettingsIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">
                设置
              </ViewportTooltip>
            </div>
          </div>
        </div>
      </header>

      <div className="safe-area-top invisible pointer-events-none transition-all duration-300 ease-in-out max-h-[500px] opacity-100" aria-hidden="true">
        <div className="safe-header-inner" />
      </div>
      {showHelp && <HelpModal appMode="gallery" onClose={() => setShowHelp(false)} />}
      <AccountLoginModal open={showAccountLogin} onClose={() => setShowAccountLogin(false)} />
    </>
  )
}
