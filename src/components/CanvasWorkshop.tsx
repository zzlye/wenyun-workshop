import { Component, useEffect, useMemo, useState, type ErrorInfo, type MouseEvent, type ReactNode } from 'react'
import 'antd/dist/reset.css'
import UserLayout from '../infiniteCanvasSource/app/(user)/layout'
import OriginalCanvasPage from '../infiniteCanvasSource/app/(user)/canvas/page'
import OriginalCanvasClientPage from '../infiniteCanvasSource/app/(user)/canvas/[id]/canvas-client-page'
import AssetsPage from '../infiniteCanvasSource/app/(user)/assets/page'
import { AppProviders } from '../infiniteCanvasSource/components/layout/app-providers'
import { useThemeStore } from '../infiniteCanvasSource/stores/use-theme-store'
import { CanvasNavigationProvider, type CanvasRoute } from '../infiniteCanvasCompat/nextNavigation'
import { useStore } from '../store'
import { normalizeSettings } from '../lib/apiProfiles'
import { syncInfiniteCanvasConfigFromSettings } from '../lib/syncInfiniteCanvasConfig'

type CanvasWorkshopProps = {
  onBack: () => void
  onOpenSettings: () => void
}

type CanvasErrorBoundaryState = {
  error: Error | null
}

class CanvasErrorBoundary extends Component<{ children: ReactNode }, CanvasErrorBoundaryState> {
  state: CanvasErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('画布页面渲染失败:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen items-center justify-center bg-white p-6 text-stone-900">
          <div className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
            <div className="text-base font-semibold text-red-700">画布页面加载失败</div>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs text-red-900">
              {this.state.error.stack || this.state.error.message}
            </pre>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function routeFromHref(href: string): CanvasRoute {
  if (href === '/' || href === '') return { pathname: '/', params: {} }
  const match = href.match(/^\/canvas\/([^/?#]+)/)
  if (match?.[1]) return { pathname: `/canvas/${match[1]}`, params: { id: match[1] } }
  const path = href.split(/[?#]/)[0] || '/'
  return { pathname: path, params: {} }
}

function CanvasRoutePage({ route }: { route: CanvasRoute }) {
  if (route.pathname === '/canvas') return <OriginalCanvasPage />
  if (route.params.id) return <OriginalCanvasClientPage />
  if (route.pathname === '/assets') return <AssetsPage />
  return <OriginalCanvasPage />
}

export default function CanvasWorkshop({ onBack, onOpenSettings }: CanvasWorkshopProps) {
  const setSettings = useStore((s) => s.setSettings)
  const settings = useStore((s) => s.settings)
  const normalizedSettings = normalizeSettings(settings)
  const appearanceTheme: 'light' | 'dark' = normalizedSettings.appearanceNightMode ? 'dark' : 'light'
  const activeAccountBoundApiKey = normalizedSettings.newApiAccountSessions[normalizedSettings.activeProfileId]?.boundApiKey ?? ''
  const [route, setRoute] = useState<CanvasRoute>({ pathname: '/canvas', params: {} })



  useEffect(() => {
    // 画布工坊复用文运工坊设置，避免打开画布时继续拉取原项目的后端配置。
    useThemeStore.getState().setTheme(appearanceTheme)
    syncInfiniteCanvasConfigFromSettings(normalizedSettings)
  }, [
    appearanceTheme,
    normalizedSettings.activeProfileId,
    normalizedSettings.accountApiKeyMode,
    normalizedSettings.baseUrl,
    normalizedSettings.apiKey,
    activeAccountBoundApiKey,
    normalizedSettings.model,
    normalizedSettings.timeout,
    normalizedSettings.textVideoApiKey,
    normalizedSettings.textVideoApiProxy,
    normalizedSettings.textVideoBaseUrl,
    normalizedSettings.textVideoModel,
    normalizedSettings.textVideoTimeout,
    normalizedSettings.textApiKey,
    normalizedSettings.textApiProxy,
    normalizedSettings.textBaseUrl,
    normalizedSettings.textModel,
    normalizedSettings.textTimeout,
    normalizedSettings.videoApiKey,
    normalizedSettings.videoApiProxy,
    normalizedSettings.videoBaseUrl,
    normalizedSettings.videoModel,
    normalizedSettings.videoTimeout,
  ])

  const navigation = useMemo(
    () => ({
      ...route,
      navigate: (href: string) => {
        if (href === '/') {
          onBack()
          return
        }
        setRoute(routeFromHref(href))
      },
      backToHome: onBack,
      openSettings: onOpenSettings,
      appearanceTheme,
      setAppearanceTheme: (theme: 'light' | 'dark') => {
        useThemeStore.getState().setTheme(theme)
        setSettings({ appearanceNightMode: theme === 'dark' })
      },
    }),
    [appearanceTheme, onBack, onOpenSettings, route, setSettings],
  )

  const handleInternalLinkClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = (event.target as HTMLElement | null)?.closest('a[href]')
    if (!link) return
    const href = link.getAttribute('href') || ''
    if (!href.startsWith('/')) return
    event.preventDefault()
    navigation.navigate(href)
  }

  return (
    <CanvasNavigationProvider value={navigation}>
      <AppProviders>
        <div className="canvas-integrated-shell" onClickCapture={handleInternalLinkClick}>
          <UserLayout>
            <div className="h-full overflow-hidden bg-transparent text-foreground">
              <CanvasErrorBoundary>
                <CanvasRoutePage route={route} />
              </CanvasErrorBoundary>
            </div>
          </UserLayout>
        </div>
      </AppProviders>
    </CanvasNavigationProvider>
  )
}
