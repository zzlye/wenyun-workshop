import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { AppProviders } from './infiniteCanvasSource/components/layout/app-providers'
import { useThemeStore } from './infiniteCanvasSource/stores/use-theme-store'
import { getActiveApiProfile, LOCKED_WENYUN_BASE_URL, normalizeSettings, setApiPriceSnapshot } from './lib/apiProfiles'
import { getEffectiveImageApiProfile } from './lib/accountApiKey'
import { flushSync } from 'react-dom'
import { initStore } from './store'
import { useStore } from './store'
import { clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { fetchNewApiNotice, queryNewApiPriceTable, type NewApiNoticeItem } from './lib/newApi'
import { requestPersistentStorage } from './lib/persistentStorage'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import AnnouncementModal from './components/AnnouncementModal'
import HomeLanding from './components/HomeLanding'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import { syncInfiniteCanvasConfigFromSettings } from './lib/syncInfiniteCanvasConfig'
import { AccountVideoKeySync } from './hooks/useAccountVideoKey'
import type { CanvasRoute } from './infiniteCanvasCompat/nextNavigation'

const CanvasWorkshop = lazy(() => import('./components/CanvasWorkshop'))
const WenyunWorkshop = lazy(() => import('./components/WenyunWorkshop'))
const SettingsModal = lazy(() => import('./components/SettingsModal'))
const Lightbox = lazy(() => import('./components/Lightbox'))
const MaskEditorModal = lazy(() => import('./components/MaskEditorModal'))
const DataSyncManager = lazy(() => import('./components/DataSyncManager'))


function getAnnouncementHash(content: string) {
  let hash = 0
  for (let index = 0; index < content.length; index += 1) {
    hash = ((hash << 5) - hash + content.charCodeAt(index)) | 0
  }
  return String(hash)
}

function getInitialLocation() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  if (pathname === '/wenyun') return { showHome: false, workspaceMode: 'gallery' as const }
  if (pathname === '/canvas' || pathname.startsWith('/canvas/')) return { showHome: false, workspaceMode: 'canvas' as const }
  return { showHome: true, workspaceMode: 'gallery' as const }
}

function getInitialCanvasRoute(): CanvasRoute {
  const match = window.location.pathname.match(/^\/canvas\/([^/]+)$/)
  return match ? { pathname: '/canvas/' + match[1], params: { id: match[1] } } : { pathname: '/canvas', params: {} }
}

export default function App() {
  const setSettings = useStore((s) => s.setSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const settings = useStore((s) => s.settings)
  const showSettings = useStore((s) => s.showSettings)
  const lightboxImageId = useStore((s) => s.lightboxImageId)
  const maskEditorImageId = useStore((s) => s.maskEditorImageId)
  const appearanceBackgroundImageUrl = useStore((s) => s.settings.appearanceBackgroundImageUrl)
  const appearanceBackgroundOpacity = useStore((s) => s.settings.appearanceBackgroundOpacity)
  const appearanceBackgroundBlur = useStore((s) => s.settings.appearanceBackgroundBlur)
  const appearanceNightMode = useStore((s) => s.settings.appearanceNightMode)
  const hasRunningGeneration = useStore((s) => s.tasks.some((task) => task.status === 'running'))
  const initialLocation = getInitialLocation()
  const [workspaceMode, setWorkspaceMode] = useState<'gallery' | 'canvas'>(initialLocation.workspaceMode)
  const [showHome, setShowHome] = useState(initialLocation.showHome)
  const storeInitStartedRef = useRef(false)
  const [storeReady, setStoreReady] = useState(false)
  const [storeError, setStoreError] = useState(false)
  const [storeRetry, setStoreRetry] = useState(0)

  useEffect(() => {
    if ((showHome && !showSettings) || storeInitStartedRef.current) return
    // 首次进入工坊或设置时才恢复历史；恢复完成前禁止编辑，避免覆盖本地记录。
    storeInitStartedRef.current = true
    setStoreError(false)
    void initStore().then(() => setStoreReady(true)).catch((error) => {
      console.error('本地创作记录加载失败:', error)
      setStoreError(true)
    })
  }, [showHome, showSettings, storeRetry])


  useEffect(() => {
    const handlePopState = () => {
      const location = getInitialLocation()
      setWorkspaceMode(location.workspaceMode)
      setShowHome(location.showHome)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (workspaceMode !== 'gallery') return
    const normalizedSettings = normalizeSettings(settings)
    const appearanceTheme: 'light' | 'dark' = normalizedSettings.appearanceNightMode ? 'dark' : 'light'

    useThemeStore.getState().setTheme(appearanceTheme)
    syncInfiniteCanvasConfigFromSettings(normalizedSettings)
  }, [settings, workspaceMode])
  const [announcementOpen, setAnnouncementOpen] = useState(false)
  const [announcementContent, setAnnouncementContent] = useState('')
  const [announcementPublishedAt, setAnnouncementPublishedAt] = useState<string | undefined>(undefined)
  const [announcementItems, setAnnouncementItems] = useState<NewApiNoticeItem[]>([])
  const [announcementLoading, setAnnouncementLoading] = useState(false)
  const announcementAutoOpenAttemptedRef = useRef(false)
  const automaticPriceSyncAttemptedRef = useRef(new Set<string>())
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()

  useEffect(() => {
    void requestPersistentStorage().then((result) => {
      if (result.supported && !result.persisted) {
        console.info('Persistent storage was not granted by the browser.')
      }
    })
  }, [])

  useEffect(() => {
    if (showHome && !showSettings) return
    const normalizedSettings = normalizeSettings(settings)
    const configuredProfile = getActiveApiProfile(normalizedSettings)
    const activeProfile = getEffectiveImageApiProfile(normalizedSettings, configuredProfile)
    const authState = activeProfile.apiKey.trim() ? 'authenticated' : 'public'
    const syncKey = `${activeProfile.id}:${activeProfile.baseUrl.trim().replace(/\/+$/, '').toLowerCase()}:${authState}`
    if (automaticPriceSyncAttemptedRef.current.has(syncKey)) return
    automaticPriceSyncAttemptedRef.current.add(syncKey)

    // 进入工坊或设置后再同步价格，主页不提前请求工坊数据。
    void queryNewApiPriceTable(activeProfile).then((priceTable) => {
      if (!priceTable.found) return
      const state = useStore.getState()
      state.setSettings(setApiPriceSnapshot(state.settings, activeProfile.id, {
        items: priceTable.items,
        updatedAt: priceTable.updatedAt,
        found: priceTable.found,
      }))
    })
  }, [settings, showHome, showSettings])

  const loadAnnouncement = useCallback(async (autoOpen = false) => {
    setAnnouncementLoading(true)
    try {
      const notice = await fetchNewApiNotice(LOCKED_WENYUN_BASE_URL)
      setAnnouncementContent(notice.content)
      setAnnouncementPublishedAt(notice.publishedAt)
      setAnnouncementItems(notice.items)

      if (autoOpen) {
        const latestSettings = useStore.getState().settings
        const today = new Date().toISOString().slice(0, 10)
        const noticeHash = getAnnouncementHash(notice.content)
        const dismissedToday = latestSettings.announcementDismissedDate === today && latestSettings.announcementDismissedHash === noticeHash
        const shouldAutoOpen = !latestSettings.announcementDismissedForever && !dismissedToday && Boolean(notice.content.trim())
        if (shouldAutoOpen) setAnnouncementOpen(true)
      }
    } catch (error) {
      console.warn('Failed to load announcement:', error)
      // 公告刷新失败时保留上一次内容，避免用户打开公告时看到空白弹窗。
    } finally {
      setAnnouncementLoading(false)
    }
  }, [])

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    // 固定站点不再接受链接导入接口配置；清理旧链接中的密钥，保留页面路由。

    if (hasUrlSettingParams(searchParams)) {
      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }


  }, [])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  useEffect(() => {
    if (announcementAutoOpenAttemptedRef.current) return
    if (showHome || !storeReady) return
    if (hasRunningGeneration) return
    announcementAutoOpenAttemptedRef.current = true
    void loadAnnouncement(true)
  }, [hasRunningGeneration, loadAnnouncement, showHome, storeReady])

  useEffect(() => {
    if (workspaceMode !== 'gallery') return
    // 文运工坊的外置夜间按钮和设置里的夜间模式保持同一个根主题状态。
    document.documentElement.classList.toggle('dark', appearanceNightMode)
    document.documentElement.style.colorScheme = appearanceNightMode ? 'dark' : 'light'
  }, [appearanceNightMode, workspaceMode])

  const switchWorkspaceMode = useCallback((nextMode: 'gallery' | 'canvas') => {
    const nextPath = nextMode === 'canvas' ? '/canvas' : '/wenyun'
    // 主页也会保留上次工坊模式，必须同时判断可见页面与地址。
    if (!showHome && workspaceMode === nextMode && window.location.pathname === nextPath) return

    const applyMode = () => {
      setAnnouncementOpen(false)
      setWorkspaceMode(nextMode)
      setShowHome(false)
      if (window.location.pathname !== nextPath) {
        window.history.pushState({}, '', nextPath)
      }
    }
    if (typeof document.startViewTransition !== 'function') {
      applyMode()
      return
    }

    const root = document.documentElement
    root.dataset.workspaceVt = nextMode
    const cleanup = () => {
      delete root.dataset.workspaceVt
    }
    const transition = document.startViewTransition(() => {
      flushSync(applyMode)
    })
    transition.finished.finally(cleanup)
  }, [showHome, workspaceMode])

  const openHome = useCallback(() => {
    // 两个工坊共用返回入口，保证页面状态和浏览器历史同步。
    setAnnouncementOpen(false)
    setShowHome(true)
    if (window.location.pathname !== '/') {
      window.history.pushState({}, '', '/')
    }
  }, [])

  const dismissAnnouncementToday = () => {
    setSettings({
      announcementDismissedDate: new Date().toISOString().slice(0, 10),
      announcementDismissedHash: getAnnouncementHash(announcementContent),
    })
    setAnnouncementOpen(false)
  }

  const toggleAnnouncementForever = (checked: boolean) => {
    setSettings({
      announcementDismissedForever: checked,
      ...(checked ? { announcementDismissedDate: undefined, announcementDismissedHash: undefined } : {}),
    })
  }

  const openAnnouncement = () => {
    setAnnouncementOpen(true)
    if (!hasRunningGeneration) void loadAnnouncement(false)
  }

  const renderStoreLoading = () => (
    <div role="status" className="p-8 text-center">
      {storeError ? (
        <>
          <p>本地创作记录加载失败，请重试。</p>
          <button type="button" className="mt-3 rounded-lg border px-4 py-2" onClick={() => {
            storeInitStartedRef.current = false
            setStoreRetry((value) => value + 1)
          }}>重新加载</button>
        </>
      ) : '正在加载创作记录…'}
    </div>
  )

  return (
    <AppProviders>
      <>
      <AccountVideoKeySync />
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-white dark:bg-gray-950" />
      {!showHome && appearanceBackgroundImageUrl.trim() && (
        <>
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
            style={{
              backgroundImage: `url("${appearanceBackgroundImageUrl.replace(/"/g, '\\"')}")`,
              opacity: appearanceBackgroundOpacity,
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 z-0"
            style={{
              backdropFilter: `blur(${appearanceBackgroundBlur}px)`,
              WebkitBackdropFilter: `blur(${appearanceBackgroundBlur}px)`,
            }}
          />
        </>
      )}
      <div data-workspace={showHome ? 'home' : workspaceMode} className={`relative z-10 min-h-screen ${appearanceNightMode ? 'appearance-night' : ''}`}>
        {showHome ? (
          <HomeLanding
            onOpenGallery={() => switchWorkspaceMode('gallery')}
            onOpenCanvas={() => switchWorkspaceMode('canvas')}
            onOpenSettings={() => setShowSettings(true)}
          />
        ) : (
          <div key={workspaceMode} className={`workspace-mode-view workspace-mode-view-${workspaceMode}`}>
            {!storeReady ? renderStoreLoading() : (
              <Suspense fallback={<div role="status" className="p-8 text-center">正在加载工坊…</div>}>
                {workspaceMode === 'gallery' ? (
                  <WenyunWorkshop onOpenHome={openHome} onOpenCanvas={() => switchWorkspaceMode('canvas')} />
                ) : (
                  <CanvasWorkshop initialRoute={getInitialCanvasRoute()} onBack={() => switchWorkspaceMode('gallery')} onOpenHome={openHome} onOpenWenyun={() => switchWorkspaceMode('gallery')} onOpenSettings={() => setShowSettings(true)} />
                )}
              </Suspense>
            )}
          </div>
        )}
        <Suspense fallback={null}>
          {lightboxImageId && <Lightbox />}
          {maskEditorImageId && <MaskEditorModal />}
          {showSettings && (storeReady ? <SettingsModal /> : (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/95 dark:bg-gray-950/95">
              {renderStoreLoading()}
            </div>
          ))}
          {storeReady && settings.cloudSync.enabled && settings.cloudSync.autoSync && <DataSyncManager />}
        </Suspense>
        <ConfirmDialog />
        <Toast />
        {!showHome && <button
          type="button"
          data-workshop-announcement={workspaceMode === 'gallery' ? '' : undefined}
          onClick={openAnnouncement}
          className="fixed bottom-4 left-4 z-50 rounded-full border border-gray-200/70 bg-white/85 px-3 py-2 text-xs font-medium text-gray-700 shadow-lg backdrop-blur transition hover:bg-white hover:text-gray-900 dark:border-white/[0.08] dark:bg-gray-900/85 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          公告
        </button>}
        {!showHome && announcementOpen && (
          <AnnouncementModal
            content={announcementContent}
            dismissForever={settings.announcementDismissedForever}
            items={announcementItems}
            loading={announcementLoading}
            publishedAt={announcementPublishedAt}
            onClose={() => setAnnouncementOpen(false)}
            onDismissToday={dismissAnnouncementToday}
            onToggleDismissForever={toggleAnnouncementForever}
          />
        )}
      </div>
      </>
    </AppProviders>
  )
}
