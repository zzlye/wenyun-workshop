import { useState } from 'react'
import { useStore } from '../store'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import { LOCKED_WENYUN_PROFILE_ID, getActiveApiProfile } from '../lib/apiProfiles'
import { AnimatedThemeToggler } from '../infiniteCanvasSource/components/ui/animated-theme-toggler'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import { HelpCircleIcon, SettingsIcon, SparklesIcon } from './icons'
import AccountLoginModal from './AccountLoginModal'
import AccountBalanceBar from './AccountBalanceBar'

type HeaderProps = {
  onOpenCanvas?: () => void
}

export default function Header({ onOpenCanvas }: HeaderProps) {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setSettings = useStore((s) => s.setSettings)
  const settings = useStore((s) => s.settings)
  const appearanceNightMode = settings.appearanceNightMode
  const activeProfile = getActiveApiProfile(settings)
  const isWenyunProfile = activeProfile.id === LOCKED_WENYUN_PROFILE_ID
  const accountSession = settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID] ?? null
  const [showHelp, setShowHelp] = useState(false)
  const [showAccountLogin, setShowAccountLogin] = useState(false)
  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()

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
            <AccountBalanceBar activeProfile={activeProfile} />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isWenyunProfile && (
              <button
                type="button"
                onClick={() => setShowAccountLogin(true)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 shadow-none transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-900 dark:hover:text-gray-100"
              >
                {accountSession ? accountSession.username : '登录'}
              </button>
            )}
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
