import { useCallback, useEffect, useRef, useState } from 'react'
import { AppProviders } from './infiniteCanvasSource/components/layout/app-providers'
import { useThemeStore } from './infiniteCanvasSource/stores/use-theme-store'
import { getActiveApiProfile, LOCKED_WENYUN_BASE_URL, mergeImportedSettings, normalizeSettings, setApiPriceSnapshot } from './lib/apiProfiles'
import { getEffectiveImageApiProfile } from './lib/accountApiKey'
import { flushSync } from 'react-dom'
import { initStore } from './store'
import { useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { getCustomProviderConfigUrl, loadCustomProviderSettingsFromUrl } from './lib/customProviderConfigUrl'
import { fetchNewApiNotice, queryNewApiPriceTable, type NewApiNoticeItem } from './lib/newApi'
import { requestPersistentStorage } from './lib/persistentStorage'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import SupportPromptModal from './components/SupportPromptModal'
import AnnouncementModal from './components/AnnouncementModal'
import CanvasWorkshop from './components/CanvasWorkshop'
import DataSyncManager from './components/DataSyncManager'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import { syncInfiniteCanvasConfigFromSettings } from './lib/syncInfiniteCanvasConfig'

let customProviderConfigUrlImportStarted = false

function getAnnouncementHash(content: string) {
  let hash = 0
  for (let index = 0; index < content.length; index += 1) {
    hash = ((hash << 5) - hash + content.charCodeAt(index)) | 0
  }
  return String(hash)
}

export default function App() {
  const setSettings = useStore((s) => s.setSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const settings = useStore((s) => s.settings)
  const appearanceBackgroundImageUrl = useStore((s) => s.settings.appearanceBackgroundImageUrl)
  const appearanceBackgroundOpacity = useStore((s) => s.settings.appearanceBackgroundOpacity)
  const appearanceBackgroundBlur = useStore((s) => s.settings.appearanceBackgroundBlur)
  const appearanceNightMode = useStore((s) => s.settings.appearanceNightMode)
  const hasRunningGeneration = useStore((s) => s.tasks.some((task) => task.status === 'running'))
  const [workspaceMode, setWorkspaceMode] = useState<'gallery' | 'canvas'>('gallery')

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
    const normalizedSettings = normalizeSettings(settings)
    const configuredProfile = getActiveApiProfile(normalizedSettings)
    const activeProfile = getEffectiveImageApiProfile(normalizedSettings, configuredProfile)
    const authState = activeProfile.apiKey.trim() ? 'authenticated' : 'public'
    const syncKey = `${activeProfile.id}:${activeProfile.baseUrl.trim().replace(/\/+$/, '').toLowerCase()}:${authState}`
    if (automaticPriceSyncAttemptedRef.current.has(syncKey)) return
    automaticPriceSyncAttemptedRef.current.add(syncKey)

    // 首次进入页面即同步当前站点价格，避免用户必须先打开模型列表。
    void queryNewApiPriceTable(activeProfile).then((priceTable) => {
      if (!priceTable.found) return
      const state = useStore.getState()
      state.setSettings(setApiPriceSnapshot(state.settings, activeProfile.id, {
        items: priceTable.items,
        updatedAt: priceTable.updatedAt,
        found: priceTable.found,
      }))
    })
  }, [settings])

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
    const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)

    setSettings(nextSettings)

    if (hasUrlSettingParams(searchParams)) {
      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    const customProviderConfigUrl = getCustomProviderConfigUrl()
    if (customProviderConfigUrl && !customProviderConfigUrlImportStarted) {
      customProviderConfigUrlImportStarted = true
      void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
        .then((importedSettings) => {
          if (!importedSettings) return
          const state = useStore.getState()
          state.setSettings(mergeImportedSettings(state.settings, importedSettings))
        })
        .catch((error) => {
          console.warn('Failed to import custom provider config URL:', error)
        })
    }

    initStore()
  }, [setSettings])

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
    if (hasRunningGeneration) return
    announcementAutoOpenAttemptedRef.current = true
    void loadAnnouncement(true)
  }, [hasRunningGeneration, loadAnnouncement])

  useEffect(() => {
    if (workspaceMode !== 'gallery') return
    // 文运工坊的外置夜间按钮和设置里的夜间模式保持同一个根主题状态。
    document.documentElement.classList.toggle('dark', appearanceNightMode)
    document.documentElement.style.colorScheme = appearanceNightMode ? 'dark' : 'light'
  }, [appearanceNightMode, workspaceMode])

  const switchWorkspaceMode = useCallback((nextMode: 'gallery' | 'canvas') => {
    if (workspaceMode === nextMode) return

    const applyMode = () => setWorkspaceMode(nextMode)
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
  }, [workspaceMode])

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

  return (
    <AppProviders>
      <>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-white dark:bg-gray-950" />
      {appearanceBackgroundImageUrl.trim() && (
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
      <div className={`relative z-10 min-h-screen ${appearanceNightMode ? 'appearance-night' : ''}`}>
        <div key={workspaceMode} className={`workspace-mode-view workspace-mode-view-${workspaceMode}`}>
          {workspaceMode === 'gallery' ? (
            <>
              <Header onOpenCanvas={() => {
                setAnnouncementOpen(false)
                switchWorkspaceMode('canvas')
              }} />
              <main data-home-main data-drag-select-surface className="pb-48">
                <div className="safe-area-x max-w-7xl mx-auto">
                  <SearchBar />
                  <TaskGrid />
                </div>
              </main>
              <InputBar />
              <DetailModal />
              <ImageContextMenu />
            </>
          ) : (
            <CanvasWorkshop onBack={() => switchWorkspaceMode('gallery')} onOpenSettings={() => setShowSettings(true)} />
          )}
        </div>
        <Lightbox />
        <MaskEditorModal />
        <SupportPromptModal />
        <SettingsModal />
        <DataSyncManager />
        <ConfirmDialog />
        <Toast />
        <button
          type="button"
          onClick={openAnnouncement}
          className="fixed bottom-4 left-4 z-50 rounded-full border border-gray-200/70 bg-white/85 px-3 py-2 text-xs font-medium text-gray-700 shadow-lg backdrop-blur transition hover:bg-white hover:text-gray-900 dark:border-white/[0.08] dark:bg-gray-900/85 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          公告
        </button>
        {announcementOpen && (
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
