import { useEffect, useRef, useState } from 'react'
import { Home, MoreHorizontal, WandSparkles } from 'lucide-react'
import { useStore } from '../store'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import { LOCKED_WENYUN_PROFILE_ID, getActiveApiProfile } from '../lib/apiProfiles'
import { AnimatedThemeToggler } from '../infiniteCanvasSource/components/ui/animated-theme-toggler'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import { HelpCircleIcon, SettingsIcon } from './icons'
import AccountLoginModal from './AccountLoginModal'
import AccountBalanceBar from './AccountBalanceBar'

type HeaderProps = {
  onOpenCanvas?: () => void
  onOpenHome?: () => void
}

export default function Header({ onOpenCanvas, onOpenHome }: HeaderProps) {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setSettings = useStore((s) => s.setSettings)
  const settings = useStore((s) => s.settings)
  const appearanceNightMode = settings.appearanceNightMode
  const activeProfile = getActiveApiProfile(settings)
  const isWenyunProfile = activeProfile.id === LOCKED_WENYUN_PROFILE_ID
  const accountSession = settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID] ?? null
  const [showHelp, setShowHelp] = useState(false)
  const [showAccountLogin, setShowAccountLogin] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()

  useEffect(() => {
    if (!showMobileMenu) return
    const closeOutside = (event: PointerEvent) => {
      if (!mobileMenuRef.current?.contains(event.target as Node)) setShowMobileMenu(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowMobileMenu(false) }
    const closeOnResize = () => { if (window.innerWidth >= 1280) setShowMobileMenu(false) }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnResize)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnResize)
    }
  }, [showMobileMenu])

  return (
    <>
      <header data-no-drag-select className="workshop-header safe-area-top fixed top-0 left-0 right-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200 dark:border-white/[0.08] transition-transform duration-300 ease-in-out">
        <div className="safe-area-x safe-header-inner max-w-7xl mx-auto flex items-center justify-between relative">
          <div className="flex-1 min-w-0 pr-2 flex items-center gap-2">
            {onOpenHome && (
              <button
                type="button"
                onClick={onOpenHome}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-600 shadow-none transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100"
                aria-label="返回主页"
                title="返回主页"
              >
                <Home className="h-5 w-5" />
              </button>
            )}
            {/* 标题不保留额外外边距，与相邻按钮共用同一条垂直中心线。 */}
            <h1 className="!m-0 inline-flex shrink-0 items-center whitespace-nowrap">
              <span className="text-[17px] sm:text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100 transition-colors">
                西米露
              </span>
            </h1>
            <button
              type="button"
              onClick={onOpenCanvas}
              className="canvas-launch-button workshop-desktop-action"
            >
              <WandSparkles className="h-4 w-4" />
              <span>画布工坊</span>
            </button>
          </div>
          <div className="absolute left-1/2 top-1/2 hidden max-w-[36vw] -translate-x-1/2 -translate-y-1/2 xl:block">
            <AccountBalanceBar activeProfile={activeProfile} />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isWenyunProfile && (
              <button
                type="button"
                onClick={() => setShowAccountLogin(true)}
                className="home-landing-icon-button workshop-account-button"
                aria-label={accountSession ? '账号' : '登录'}
                title={accountSession?.username || '登录'}
              >
                <span className="truncate">{accountSession ? accountSession.username : '登录'}</span>
              </button>
            )}
            <div
              className="relative workshop-desktop-action"
              {...helpTooltip.handlers}
            >
              <button
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="home-landing-icon-button !h-9 !w-9 !justify-center !p-0"
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
              className="workshop-desktop-action home-landing-icon-button !h-9 !w-9 !justify-center !p-0 [&_svg]:h-5 [&_svg]:w-5"
              aria-label={appearanceNightMode ? '切换到白天模式' : '切换到夜间模式'}
              title={appearanceNightMode ? '切换到白天模式' : '切换到夜间模式'}
            />
            {/* 小屏把次要入口放进菜单，标题、账号和设置保持一行且可触达。 */}
            <div ref={mobileMenuRef} className="relative xl:hidden">
              <button type="button" className="home-landing-icon-button !h-11 !w-11 !justify-center !p-0" aria-label="更多功能" aria-expanded={showMobileMenu} aria-controls="workshop-mobile-menu" onClick={() => setShowMobileMenu((value) => !value)}><MoreHorizontal className="size-5" /></button>
              {showMobileMenu && (
                <nav id="workshop-mobile-menu" aria-label="工坊更多功能" className="absolute right-0 top-full mt-2 w-[min(280px,calc(100vw-2rem))] rounded-2xl border border-gray-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-gray-900">
                  <div className="sm:hidden">
                    <button type="button" className="workshop-menu-item" onClick={() => { setShowMobileMenu(false); onOpenCanvas?.() }}>画布工坊</button>
                    <button type="button" className="workshop-menu-item" onClick={() => { setShowMobileMenu(false); setShowHelp(true) }}>操作指南</button>
                    <button type="button" className="workshop-menu-item" onClick={() => { setSettings({ appearanceNightMode: !appearanceNightMode }); setShowMobileMenu(false) }}>{appearanceNightMode ? '切换到白天模式' : '切换到夜间模式'}</button>
                  </div>
                  <div className="mt-1 border-t border-gray-100 pt-2 dark:border-white/10 sm:mt-0 sm:border-0 sm:pt-0">
                    <AccountBalanceBar activeProfile={activeProfile} className="flex flex-wrap items-center gap-2 p-1 text-xs" />
                  </div>
                </nav>
              )}
            </div>
            <div
              className="relative"
              {...settingsTooltip.handlers}
            >
              <button
                onClick={() => setShowSettings(true)}
                className="home-landing-icon-button !h-9 !w-9 !justify-center !p-0"
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
