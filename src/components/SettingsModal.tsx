import { useVideoModels } from '../hooks/useVideoModels'
import { useAccountVideoKey } from '../hooks/useAccountVideoKey'
import { getBoundVideoApiKey } from '../lib/videoAccount'
import { useEffect, useRef, useState, useCallback } from 'react'

import { Cloud, CloudDownload, CloudUpload, HardDrive, RefreshCw } from 'lucide-react'
import { normalizeBaseUrl } from '../lib/api'
import { buildApiUrl } from '../lib/devProxy'
import { useStore, exportData, importData, clearData, type SettingsTab } from '../store'
import { DEFAULT_SETTINGS, getApiBalanceSnapshot, getActiveApiProfile, isOpenAICompatibleProvider, LOCKED_OPENAI_API_PROFILES, LOCKED_WENYUN_PROFILE_ID, normalizeSettings, setApiBalanceSnapshot } from '../lib/apiProfiles'
import { getEffectiveVideoApiKey } from '../lib/accountApiKey'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { queryNewApiBalance } from '../lib/newApi'
import { parseModelListPayload } from '../lib/modelList'
import { CLOUD_SYNC_PROVIDER_OPTIONS, getCloudSyncProviderInfo, hasCloudSyncPullScope, hasCloudSyncUploadScope, isCloudSyncReady, pullDataBackupFromCloud, uploadDataBackupToCloud } from '../lib/cloudSync'
import { chooseLocalSyncFile, clearLocalSyncFile, getLocalSyncFileInfo, hasLocalSyncFileHandle, isLocalFileSyncSupported } from '../lib/localFileSync'
import { type ApiProfile, type AppSettings, type CloudSyncProvider } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'

import { CANVAS_VIDEO_BASE_URL, CANVAS_VIDEO_TIMEOUT, normalizeCanvasVideoModel } from '../lib/videoModel'
import { useCanvasStore } from '../infiniteCanvasSource/app/(user)/canvas/stores/use-canvas-store'
import { useAssetStore } from '../infiniteCanvasSource/stores/use-asset-store'
import Select from './Select'
import { Checkbox } from './Checkbox'

import PriceTableButton from './PriceTableButton'
import HomeStreamerSetting from './HomeStreamerSetting'
import { CloseIcon, CopyIcon, TrashIcon, ExportIcon, ImportIcon } from './icons'

type ExternalApiTarget = 'text' | 'video'

const RANDOM_BACKGROUND_API_URL = 'https://i.mukyu.ru/random'
const RANDOM_BACKGROUND_IMAGE_ORIGIN = 'https://i.mukyu.ru'
const RANDOM_BACKGROUND_PROXY_PREFIX = '/wy-public/mukyu'
const RANDOM_BACKGROUND_FETCH_TIMEOUT_MS = 8000
const BACKGROUND_IMAGE_LOAD_TIMEOUT_MS = 8000

function readBackgroundImageUrl(input: unknown): string | null {
  if (typeof input === 'string' && /^(https?:\/\/|\/i\/)/i.test(input.trim())) return input.trim()
  if (!input || typeof input !== 'object') return null

  if (Array.isArray(input)) {
    for (const item of input) {
      const found = readBackgroundImageUrl(item)
      if (found) return found
    }
    return null
  }

  const record = input as Record<string, unknown>
  for (const key of ['proxy', 'origin', 'imgproxy', 'url', 'image', 'imageUrl', 'src']) {
    const found = readBackgroundImageUrl(record[key])
    if (found) return found
  }

  for (const value of Object.values(record)) {
    const found = readBackgroundImageUrl(value)
    if (found) return found
  }

  return null
}

function normalizeRandomBackgroundImageUrl(value: string) {
  if (value.startsWith('/')) return `${RANDOM_BACKGROUND_IMAGE_ORIGIN}${value}`
  return value
}

async function fetchJsonWithTimeout(requestUrl: string, timeoutMs = RANDOM_BACKGROUND_FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(requestUrl, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw new Error(`背景接口请求失败：${response.status}`)
    return response.json()
  } finally {
    window.clearTimeout(timer)
  }
}

async function fetchBackgroundJson(requestUrl: string) {
  const sameOriginProxyUrl = getRandomBackgroundProxyUrl(requestUrl)
  if (sameOriginProxyUrl) {
    try {
      return await fetchJsonWithTimeout(sameOriginProxyUrl)
    } catch {
      // 部分静态部署可能没有公开代理，失败时继续走直连和公共代理兜底。
    }
  }

  try {
    return await fetchJsonWithTimeout(requestUrl)
  } catch (err) {
    const proxiedUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(requestUrl)}`
    try {
      return await fetchJsonWithTimeout(proxiedUrl, RANDOM_BACKGROUND_FETCH_TIMEOUT_MS)
    } catch {
      throw err
    }
  }
}

function getRandomBackgroundProxyUrl(requestUrl: string): string | null {
  try {
    const parsed = new URL(requestUrl)
    if (parsed.origin !== RANDOM_BACKGROUND_IMAGE_ORIGIN) return null
    return `${RANDOM_BACKGROUND_PROXY_PREFIX}${parsed.pathname}${parsed.search}`
  } catch {
    return null
  }
}

function preloadBackgroundImageUrl(imageUrl: string, timeoutMs = BACKGROUND_IMAGE_LOAD_TIMEOUT_MS) {
  if (/^(data:image\/|blob:)/i.test(imageUrl)) return Promise.resolve(imageUrl)

  return new Promise<string>((resolve, reject) => {
    const image = new Image()
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('背景图片加载超时'))
    }, timeoutMs)
    const cleanup = () => {
      window.clearTimeout(timer)
      image.onload = null
      image.onerror = null
    }

    image.onload = () => {
      cleanup()
      resolve(imageUrl)
    }
    image.onerror = () => {
      cleanup()
      reject(new Error('背景图片加载失败'))
    }
    image.decoding = 'async'
    image.referrerPolicy = 'no-referrer'
    image.src = imageUrl
  })
}

function getRandomBackgroundApiUrl() {
  const url = new URL(RANDOM_BACKGROUND_API_URL)
  // 点击随机时才请求接口，并保存最终固定图地址，避免刷新或打开设置时重新随机。
  url.searchParams.set('format', 'simple_json')
  url.searchParams.set('r18', '0')
  url.searchParams.set('ai_type', '0')
  url.searchParams.set('illust_type', 'illust')
  url.searchParams.set('orientation', 'landscape')
  url.searchParams.set('min_width', '1920')
  url.searchParams.set('min_height', '1080')
  url.searchParams.set('min_pixels', '2500000')
  url.searchParams.set('attempts', '3')
  url.searchParams.set('pixiv_cat', '1')
  url.searchParams.set('pximg_mirror_host', 're')
  url.searchParams.set('t', Date.now().toString())
  return url.toString()
}

async function getRandomBackgroundImageUrl() {
  const payload = await fetchBackgroundJson(getRandomBackgroundApiUrl())
  const imageUrl = readBackgroundImageUrl(payload)
  if (!imageUrl) throw new Error('背景接口没有返回图片地址')
  return normalizeRandomBackgroundImageUrl(imageUrl)
}

type ExternalApiConfigSectionProps = {
  idPrefix: string
  title: string
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  showApiKey: boolean
  modelOptions: string[]
  isFetchingModels: boolean
  onBaseUrlDraftChange: (value: string) => void
  onBaseUrlCommit: (value: string) => void
  onApiKeyDraftChange: (value: string) => void
  onApiKeyCommit: (value: string) => void
  onModelDraftChange: (value: string) => void
  onModelCommit: (value: string) => void
  onTimeoutDraftChange: (value: number) => void
  onTimeoutCommit: (value: number) => void
  onToggleShowApiKey: () => void
  onFetchModels: () => void
  fixedModel?: string
  fixedBaseUrl?: string
  fixedTimeout?: number
  modelOptionsLocked?: boolean
  onCopyBaseUrl?: () => void
  apiKeyHint?: string
  apiKeyReadOnly?: boolean
  onCopyApiKey?: () => void
}

function ExternalApiConfigSection({
  idPrefix,
  title,
  baseUrl,
  apiKey,
  model,
  timeout,
  showApiKey,
  modelOptions,
  isFetchingModels,
  onBaseUrlDraftChange,
  onBaseUrlCommit,
  onApiKeyDraftChange,
  onApiKeyCommit,
  onModelDraftChange,
  onModelCommit,
  onTimeoutDraftChange,
  onTimeoutCommit,
  onToggleShowApiKey,
  onFetchModels,
  fixedModel,
  fixedBaseUrl,
  fixedTimeout,
  modelOptionsLocked = false,
  onCopyBaseUrl,
  apiKeyHint,
  apiKeyReadOnly = false,
  onCopyApiKey,
}: ExternalApiConfigSectionProps) {
  const modelInputId = `${idPrefix}-model-input`
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const visibleModelOptions = modelOptions
  const modelSelectionLocked = Boolean(fixedModel || modelOptionsLocked)
  const displayedModel = fixedModel || model
  const displayedBaseUrl = fixedBaseUrl ?? baseUrl
  const displayedTimeout = fixedTimeout ?? timeout

  useEffect(() => {
    if (modelOptions.length && !fixedModel) setModelMenuOpen(true)
  }, [fixedModel, modelOptions])

  useEffect(() => {
    if (!modelMenuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (modelMenuRef.current?.contains(event.target as Node)) return
      setModelMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [modelMenuOpen])

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200/70 bg-white/55 p-4 dark:border-white/[0.08] dark:bg-white/[0.025]" aria-label={title}>
      <label className="block">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="block text-sm text-gray-600 dark:text-gray-300">API URL</span>
          {onCopyBaseUrl && (
            <button
              type="button"
              onClick={onCopyBaseUrl}
              className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-gray-200/70 bg-white/70 text-gray-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:border-blue-400/30 dark:hover:bg-blue-500/15 dark:hover:text-blue-200"
              aria-label="复制视频 API URL"
              title="复制 API URL"
            >
              <CopyIcon className="h-3 w-3" />
            </button>
          )}
        </div>
        <input
          value={displayedBaseUrl}
          readOnly={Boolean(fixedBaseUrl)}
          onFocus={(event) => { if (fixedBaseUrl) event.currentTarget.select() }}
          onChange={(e) => {
            if (!fixedBaseUrl) onBaseUrlDraftChange(e.target.value)
          }}
          onBlur={(e) => onBaseUrlCommit(fixedBaseUrl || e.target.value)}
          type="text"
          placeholder="https://example.com/v1"
          className={`w-full rounded-xl border border-gray-200/70 px-3 py-2.5 text-sm text-gray-700 outline-none transition dark:border-white/[0.08] dark:text-gray-200 ${fixedBaseUrl ? 'cursor-default bg-gray-100/80 dark:bg-white/[0.05]' : 'bg-white/60 focus:border-blue-300 dark:bg-white/[0.03] dark:focus:border-blue-500/50'}`}
        />
      </label>

      <div className="block">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-300">API Key</span>
          {onCopyApiKey && <button type="button" onClick={onCopyApiKey} disabled={!apiKey} aria-label="复制视频 API Key" className="rounded-md p-1 text-gray-500 hover:text-blue-600 disabled:opacity-40 dark:text-gray-300"><CopyIcon className="h-3 w-3" /></button>}
        </div>
        <div className="relative">
          <input
            value={apiKey}
            readOnly={apiKeyReadOnly}
            onChange={(e) => { if (!apiKeyReadOnly) onApiKeyDraftChange(e.target.value) }}
            onBlur={(e) => { if (!apiKeyReadOnly) onApiKeyCommit(e.target.value) }}
            type={showApiKey ? 'text' : 'password'}
            placeholder="sk-..."
            className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 pr-10 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
          />
          <button
            type="button"
            onClick={onToggleShowApiKey}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
            tabIndex={-1}
            aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
          >
            {showApiKey ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            )}
          </button>
        </div>
        {apiKeyHint && <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{apiKeyHint}</p>}
      </div>

      <div ref={modelMenuRef} className="relative block">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="block text-sm text-gray-600 dark:text-gray-300">模型 ID</span>
          {modelSelectionLocked ? (
            <span className="rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">固定模型列表</span>
          ) : (
            <button
              type="button"
              onClick={onFetchModels}
              disabled={isFetchingModels}
              className="rounded-xl bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isFetchingModels ? '获取中...' : '获取模型'}
            </button>
          )}
        </div>
        <input
          id={modelInputId}
          value={displayedModel}
          readOnly={modelSelectionLocked}
          onFocus={() => {
            if (modelOptions.length) setModelMenuOpen(true)
          }}
          onChange={(e) => {
            if (modelSelectionLocked) return
            onModelDraftChange(e.target.value)
            if (modelOptions.length) setModelMenuOpen(true)
          }}
           onBlur={(e) => onModelCommit(fixedModel || e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setModelMenuOpen(false)
          }}
          type="text"
          placeholder="填写模型 ID，或点击获取模型后选择"
          className={`w-full rounded-xl border border-gray-200/70 px-3 py-2.5 text-sm text-gray-700 outline-none transition dark:border-white/[0.08] dark:text-gray-200 ${modelSelectionLocked ? 'cursor-default bg-gray-100/80 dark:bg-white/[0.05]' : 'bg-white/60 focus:border-blue-300 dark:bg-white/[0.03] dark:focus:border-blue-500/50'}`}
        />
        {!fixedModel && modelMenuOpen && modelOptions.length ? (
          <div className="absolute left-0 right-0 top-full z-[120] mt-1 max-h-56 overflow-y-auto rounded-xl border border-gray-200/70 bg-white/95 py-1 text-sm shadow-xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 custom-scrollbar">
            {visibleModelOptions.length ? (
              visibleModelOptions.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`block w-full truncate px-3 py-2 text-left transition ${item === model ? 'bg-blue-50 font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onModelDraftChange(item)
                    onModelCommit(item)
                    setModelMenuOpen(false)
                  }}
                >
                  {item}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">没有匹配模型</div>
            )}
          </div>
        ) : null}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">请求超时 (秒)</span>
        <input
          value={displayedTimeout}
          readOnly={fixedTimeout !== undefined}
          onChange={(e) => {
            if (fixedTimeout === undefined) onTimeoutDraftChange(Number(e.target.value) || DEFAULT_SETTINGS.textTimeout)
          }}
          onBlur={(e) => onTimeoutCommit(fixedTimeout ?? (Number(e.target.value) || DEFAULT_SETTINGS.textTimeout))}
          type="number"
          min={10}
          max={fixedTimeout ?? 600}
          className={`w-full rounded-xl border border-gray-200/70 px-3 py-2.5 text-sm text-gray-700 outline-none transition dark:border-white/[0.08] dark:text-gray-200 ${fixedTimeout !== undefined ? 'cursor-default bg-gray-100/80 dark:bg-white/[0.05]' : 'bg-white/60 focus:border-blue-300 dark:bg-white/[0.03] dark:focus:border-blue-500/50'}`}
        />
      </label>
    </section>
  )
}

export default function SettingsModal() {
  const showSettings = useStore((s) => s.showSettings)
  const settingsTabRequest = useStore((s) => s.settingsTabRequest)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const canvasProjects = useCanvasStore((s) => s.projects)
  const assets = useAssetStore((s) => s.assets)
  const reusedTaskApiProfileId = useStore((s) => s.reusedTaskApiProfileId)
  const setReusedTaskApiProfile = useStore((s) => s.setReusedTaskApiProfile)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const importInputRef = useRef<HTMLInputElement>(null)
  const backgroundFileInputRef = useRef<HTMLInputElement>(null)
  const settingsScrollBoundaryRef = useRef<HTMLDivElement>(null)
  
  const [draft, setDraft] = useState<AppSettings>(normalizeSettings(settings))
  const [timeoutInput, setTimeoutInput] = useState(String(getActiveApiProfile(settings).timeout))
  const [showApiKey, setShowApiKey] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>('api')
  const [isRandomizingBackground, setIsRandomizingBackground] = useState(false)
  const [isQueryingBalance, setIsQueryingBalance] = useState(false)
  const [isFetchingTextModels, setIsFetchingTextModels] = useState(false)
  const [textModelOptions, setTextModelOptions] = useState<string[]>([])
  // 账号凭据读取实时状态，不写入手填 Key；获取模型与节点生成共用同一选择规则。
  const effectiveVideoApiKey = getEffectiveVideoApiKey({
    ...draft,
    newApiAccountSessions: settings.newApiAccountSessions,
    accountApiKeyMode: settings.accountApiKeyMode,
  })
  const videoAccountSession = settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]
  const videoAccountKey = getBoundVideoApiKey(videoAccountSession)
  const videoKeyQuery = useAccountVideoKey()
  const videoUsesAccountCredentials = Boolean(videoAccountSession && (settings.accountApiKeyMode === 'account' || !draft.videoApiKey.trim()))
  useEffect(() => { setShowApiKey(false) }, [videoAccountSession?.accessToken, activeTab, showSettings])
  const videoModelsQuery = useVideoModels(effectiveVideoApiKey, draft.videoApiProxy, showSettings && activeTab === 'videoApi')
  const videoModelOptions = videoModelsQuery.data ?? []
  const isFetchingVideoModels = videoModelsQuery.isFetching
  const [exportTasks, setExportTasks] = useState(true)
  const [exportCanvasProjects, setExportCanvasProjects] = useState(false)
  const [exportAssets, setExportAssets] = useState(false)
  const [exportCanvasProjectIds, setExportCanvasProjectIds] = useState<string[]>([])
  const [exportAssetIds, setExportAssetIds] = useState<string[]>([])
  const [importConfig, setImportConfig] = useState(true)
  const [importTasks, setImportTasks] = useState(true)
  const [importCanvasProjects, setImportCanvasProjects] = useState(true)
  const [importAssets, setImportAssets] = useState(true)
  const [clearConfig, setClearConfig] = useState(true)
  const [clearTasks, setClearTasks] = useState(true)
  const [clearCanvasProjects, setClearCanvasProjects] = useState(false)
  const [clearAssets, setClearAssets] = useState(false)
  const [isImportingData, setIsImportingData] = useState(false)
  const [isCloudSyncBusy, setIsCloudSyncBusy] = useState(false)
  const [isChoosingLocalSyncFile, setIsChoosingLocalSyncFile] = useState(false)
  const [localSyncFileName, setLocalSyncFileName] = useState('')
  const [localSyncFileReady, setLocalSyncFileReady] = useState(false)
  const activeProfile = draft.profiles.find((profile) => profile.id === draft.activeProfileId) ?? draft.profiles[0] ?? getActiveApiProfile(draft)
  const activeProviderIsOpenAICompatible = isOpenAICompatibleProvider(draft, activeProfile.provider)
  const activeProviderUsesApiUrl = activeProviderIsOpenAICompatible || activeProfile.provider === 'fal'
  const activeProfileBalance = getApiBalanceSnapshot(draft, activeProfile.id)
  const activeProfileBalanceText = activeProfileBalance?.text ?? ''
  const activeProfileBalanceUpdatedAt = activeProfileBalance?.updatedAt
  const wasSettingsOpenRef = useRef(false)

  useEffect(() => {
    if (!showSettings) {
      wasSettingsOpenRef.current = false
      return
    }
    if (wasSettingsOpenRef.current) return

    wasSettingsOpenRef.current = true
    const normalizedSettings = normalizeSettings(settings)
    const displaySettings = normalizedSettings.reuseTaskApiProfileTemporarily && reusedTaskApiProfileId && normalizedSettings.profiles.some((profile) => profile.id === reusedTaskApiProfileId)
      ? normalizeSettings({ ...normalizedSettings, activeProfileId: reusedTaskApiProfileId })
      : normalizedSettings
    const nextDraft = displaySettings
    setDraft(nextDraft)
    setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
  }, [showSettings, settings, reusedTaskApiProfileId])

  useEffect(() => {
    setTimeoutInput(String(activeProfile.timeout))
  }, [activeProfile.id, activeProfile.timeout])

  useEffect(() => {
    if (showSettings && settingsTabRequest) setActiveTab(settingsTabRequest)
  }, [settingsTabRequest, showSettings])

  useEffect(() => {
    if (!showSettings) return
    void Promise.all([getLocalSyncFileInfo(), hasLocalSyncFileHandle()]).then(([info, hasHandle]) => {
      const name = info?.name ?? ''
      setLocalSyncFileName(name)
      setLocalSyncFileReady(hasHandle)
      if (!name || normalizeSettings(useStore.getState().settings).cloudSync.localFileName) return
      const cloudSync = { ...normalizeSettings(useStore.getState().settings).cloudSync, localFileName: name }
      setSettings({ cloudSync })
      setDraft((current) => normalizeSettings({ ...current, cloudSync }))
    })
  }, [setSettings, showSettings])

  useEffect(() => {
    setExportCanvasProjectIds((ids) => ids.filter((id) => canvasProjects.some((project) => project.id === id)))
    setExportAssetIds((ids) => ids.filter((id) => assets.some((asset) => asset.id === id)))
  }, [assets, canvasProjects])

  const commitSettings = (nextDraft: AppSettings) => {
    // 两个站点的地址和协议统一由配置归一函数约束，不再维护另一套可编辑服务商规则。
    // 设置弹窗打开期间登录状态可能改变，保存表单时不能恢复已退出的账号。
    const current = useStore.getState().settings
    const normalizedDraft = normalizeSettings({
      ...nextDraft,
      newApiAccountSessions: current.newApiAccountSessions,
      accountApiKeyMode: current.accountApiKeyMode,
    })
    setDraft(normalizedDraft)
    setSettings(normalizedDraft)
  }

  const getDraftWithActiveProfilePatch = (patch: Partial<ApiProfile>) => ({
      ...draft,
      profiles: draft.profiles.map((profile) => profile.id === activeProfile.id ? { ...profile, ...patch } : profile),
    })

  const updateActiveProfile = (patch: Partial<ApiProfile>, commit = false) => {
    const nextDraft = getDraftWithActiveProfilePatch(patch)
    setDraft(nextDraft)
    if (commit) commitSettings(nextDraft)
  }

  const commitActiveProfilePatch = (patch: Partial<ApiProfile>) => {
    const nextDraft = getDraftWithActiveProfilePatch(patch)
    commitSettings(nextDraft)
  }

  const handleClose = () => {
    const nextTimeout = Number(timeoutInput)
    const normalizedTimeout =
      timeoutInput.trim() === '' || Number.isNaN(nextTimeout)
        ? DEFAULT_SETTINGS.timeout
        : nextTimeout
    const nextDraft = {
      ...draft,
      profiles: activeProviderIsOpenAICompatible
        ? draft.profiles.map((profile) =>
            profile.id === activeProfile.id ? { ...profile, timeout: normalizedTimeout } : profile,
          )
        : draft.profiles,
    }
    commitSettings(nextDraft)
    setShowSettings(false)
  }

  const commitTimeout = useCallback(() => {
    if (!isOpenAICompatibleProvider(draft, activeProfile.provider)) return
    const nextTimeout = Number(timeoutInput)
    const normalizedTimeout =
      timeoutInput.trim() === '' ? DEFAULT_SETTINGS.timeout : Number.isNaN(nextTimeout) ? activeProfile.timeout : nextTimeout
    setTimeoutInput(String(normalizedTimeout))
    updateActiveProfile({ timeout: normalizedTimeout }, true)
  }, [draft, activeProfile.id, activeProfile.provider, activeProfile.timeout, timeoutInput])

  useCloseOnEscape(showSettings, handleClose)
  usePreventBackgroundScroll(showSettings, settingsScrollBoundaryRef)

  if (!showSettings) return null

  const setCanvasProjectExportEnabled = (checked: boolean) => {
    setExportCanvasProjects(checked)
    if (checked && exportCanvasProjectIds.length === 0) {
      setExportCanvasProjectIds(canvasProjects.map((project) => project.id))
    }
  }

  const setAssetExportEnabled = (checked: boolean) => {
    setExportAssets(checked)
    if (checked && exportAssetIds.length === 0) {
      setExportAssetIds(assets.map((asset) => asset.id))
    }
  }

  const toggleExportCanvasProject = (id: string, checked: boolean) => {
    setExportCanvasProjectIds((ids) => checked ? Array.from(new Set([...ids, id])) : ids.filter((item) => item !== id))
  }

  const toggleExportAsset = (id: string, checked: boolean) => {
    setExportAssetIds((ids) => checked ? Array.from(new Set([...ids, id])) : ids.filter((item) => item !== id))
  }

  const selectedExportCanvasIds = exportCanvasProjects ? exportCanvasProjectIds : []
  const selectedExportAssetIds = exportAssets ? exportAssetIds : []
  const canExportData = exportTasks || selectedExportCanvasIds.length > 0 || selectedExportAssetIds.length > 0
  const canImportData = importConfig || importTasks || importCanvasProjects || importAssets
  const canClearData = clearConfig || clearTasks || clearCanvasProjects || clearAssets
  const cloudSync = draft.cloudSync
  const cloudSyncInfo = getCloudSyncProviderInfo(cloudSync.provider)
  const isLocalFileSync = cloudSync.provider === 'local-file'
  const localFileSyncSupported = isLocalFileSyncSupported()
  const displayLocalSyncFileName = localSyncFileName || cloudSync.localFileName || ''
  const cloudSyncReady = isCloudSyncReady(cloudSync)
  const cloudSyncUploadReady = isLocalFileSync ? localFileSyncSupported && hasCloudSyncUploadScope(cloudSync) : cloudSyncReady && hasCloudSyncUploadScope(cloudSync)
  const cloudSyncPullReady = isLocalFileSync ? cloudSyncReady && localSyncFileReady && hasCloudSyncPullScope(cloudSync) : cloudSyncReady && hasCloudSyncPullScope(cloudSync)
  const formatCloudSyncTime = (value?: number) => value ? new Date(value).toLocaleString('zh-CN') : '从未'

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setIsImportingData(true)
      try {
        const imported = await importData(file, { importConfig, importTasks, importCanvasProjects, importAssets })
        if (imported) {
          const nextDraft = normalizeSettings(useStore.getState().settings)
          setDraft(nextDraft)
          setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
              }
      } finally {
        setIsImportingData(false)
      }
    }
    e.target.value = ''
  }

  const handleClearAllData = async () => {
    await clearData({ clearConfig, clearTasks, clearCanvasProjects, clearAssets })
    const nextDraft = normalizeSettings(useStore.getState().settings)
    setDraft(nextDraft)
    setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
  }

  const updateCloudSync = (patch: Partial<AppSettings['cloudSync']>) => {
    const nextCloudSync = { ...draft.cloudSync, ...patch }
    setDraft((current) => normalizeSettings({ ...current, cloudSync: nextCloudSync }))
    setSettings({ cloudSync: nextCloudSync })
  }

  const handleCloudSyncUpload = async () => {
    setIsCloudSyncBusy(true)
    try {
      await uploadDataBackupToCloud(normalizeSettings(useStore.getState().settings).cloudSync)
      setDraft(normalizeSettings(useStore.getState().settings))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSettings({ cloudSync: { ...normalizeSettings(useStore.getState().settings).cloudSync, lastError: message } })
      showToast(message, 'error')
    } finally {
      setIsCloudSyncBusy(false)
    }
  }

  const handleCloudSyncPull = async () => {
    setIsCloudSyncBusy(true)
    try {
      await pullDataBackupFromCloud(normalizeSettings(useStore.getState().settings).cloudSync)
      const nextDraft = normalizeSettings(useStore.getState().settings)
      setDraft(nextDraft)
      setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSettings({ cloudSync: { ...normalizeSettings(useStore.getState().settings).cloudSync, lastError: message } })
      showToast(message, 'error')
    } finally {
      setIsCloudSyncBusy(false)
    }
  }

  const handleChooseLocalSyncFile = async () => {
    setIsChoosingLocalSyncFile(true)
    try {
      const info = await chooseLocalSyncFile(cloudSync.fileName)
      setLocalSyncFileName(info.name)
      setLocalSyncFileReady(true)
      updateCloudSync({ provider: 'local-file', localFileName: info.name, lastError: undefined })
      showToast('已选择本地备份文件', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateCloudSync({ lastError: message })
      showToast(message, 'error')
    } finally {
      setIsChoosingLocalSyncFile(false)
    }
  }

  const handleClearLocalSyncFile = async () => {
    await clearLocalSyncFile()
    setLocalSyncFileName('')
    setLocalSyncFileReady(false)
    updateCloudSync({ localFileName: undefined })
    showToast('已清除本地备份文件授权', 'success')
  }

  const switchProfile = (id: string) => {
    setReusedTaskApiProfile(null)
    const nextDraft = normalizeSettings({ ...draft, activeProfileId: id })
    commitSettings(nextDraft)
  }
  
  const randomizeBackgroundFromApi = async () => {
    setIsRandomizingBackground(true)
    try {
      const imageUrl = await preloadBackgroundImageUrl(await getRandomBackgroundImageUrl())
      commitSettings({ ...draft, appearanceBackgroundImageUrl: imageUrl })
      showToast('背景已更新', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '随机背景失败', 'error')
    } finally {
      setIsRandomizingBackground(false)
    }
  }

  const handleBackgroundUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件', 'error')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl) {
        showToast('图片读取失败', 'error')
        return
      }
      commitSettings({ ...draft, appearanceBackgroundImageUrl: dataUrl })
      showToast('背景已上传', 'success')
    }
    reader.onerror = () => showToast('图片读取失败', 'error')
    reader.readAsDataURL(file)
  }

  const copyApiUrl = async (url: string) => {
    try {
      await copyTextToClipboard(url)
      showToast('API URL 已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制 API URL 失败', err), 'error')
    }
  }

  const queryActiveProfileBalance = async () => {
    setIsQueryingBalance(true)
    try {
      const balance = await queryNewApiBalance(activeProfile)
      commitSettings({
        ...draft,
        ...setApiBalanceSnapshot(draft, activeProfile.id, balance),
      })
      showToast('余额已更新', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '余额查询失败', 'error')
    } finally {
      setIsQueryingBalance(false)
    }
  }

  const fetchExternalApiModels = async (target: ExternalApiTarget) => {
    const isText = target === 'text'
    const baseUrl = isText ? draft.textBaseUrl : draft.videoBaseUrl
    const apiKey = isText ? draft.textApiKey : draft.videoApiKey
    const currentModel = isText ? draft.textModel : draft.videoModel

    if (!baseUrl.trim()) {
      showToast(`请先填写${isText ? '文字' : '视频'} API URL`, 'error')
      return
    }

    if (isText) setIsFetchingTextModels(true)
    try {
      if (!isText) {
        const result = await videoModelsQuery.refetch()
        if (result.error) throw result.error
        showToast(`已获取 ${result.data?.length ?? 0} 个模型`, 'success')
        return
      }
      const response = await fetch(buildApiUrl(baseUrl, 'models'), {
        headers: apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined,
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => null) as { data?: unknown, error?: { message?: string }, msg?: string } | null
      if (!response.ok) throw new Error(payload?.error?.message || payload?.msg || `读取模型失败：${response.status}`)

      const models = parseModelListPayload(payload)

      if (models.length === 0) throw new Error('接口没有返回模型列表')
      setTextModelOptions(models)

      if (!currentModel.trim()) {
        const patch = isText ? { textModel: models[0] } : { videoModel: models[0] }
        commitSettings({ ...draft, ...patch })
      }
      showToast(`已获取 ${models.length} 个模型`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '读取模型失败', 'error')
    } finally {
      if (isText) setIsFetchingTextModels(false)
    }
  }

  return (
        <div data-no-drag-select className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in"
        onClick={handleClose}
      />
      <div
        ref={settingsScrollBoundaryRef}
        data-settings-dialog
        className="relative z-10 w-full max-w-3xl rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 flex h-[85vh] sm:h-[600px] flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between shrink-0 p-5 border-b border-gray-100 dark:border-white/[0.08]">
          <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </h3>
          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
          {/* Sidebar */}
          <div className="w-full sm:w-48 shrink-0 flex flex-col border-b sm:border-b-0 sm:border-r border-gray-100 dark:border-white/[0.08] bg-gray-50/50 dark:bg-white/[0.02]">
            <nav className="flex-1 overflow-x-auto sm:overflow-y-auto custom-scrollbar p-3 space-x-1 sm:space-x-0 sm:space-y-1 flex sm:flex-col">
              <button
                onClick={() => setActiveTab('api')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'api' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                出图 API 配置
              </button>
              <button
                onClick={() => setActiveTab('textApi')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'textApi' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h8M8 14h5m-9 5l2.5-2.5H18a3 3 0 003-3V7a3 3 0 00-3-3H6a3 3 0 00-3 3v6.5a3 3 0 003 3H4v2.5z" />
                </svg>
                文字 API 配置
              </button>
              <button
                onClick={() => setActiveTab('videoApi')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'videoApi' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 6h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
                </svg>
                视频 API 配置
              </button>
              <button
                onClick={() => setActiveTab('appearance')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'appearance' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                外观
              </button>
              <button
                onClick={() => setActiveTab('general')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'general' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
                </svg>
                习惯配置
              </button>
              <button
                onClick={() => setActiveTab('sync')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'sync' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <Cloud className="h-4 w-4" />
                同步
              </button>
              <button
                onClick={() => setActiveTab('data')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'data' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
                数据管理
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-transparent relative overflow-hidden">
            <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar p-5 sm:p-6">
            {activeTab === 'general' && (
              <div className="space-y-4">
                <div className="hidden sm:block">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">任务提交方式</span>
                    <div className="w-32">
                      <Select
                        value={draft.enterSubmit ? 'enter' : 'ctrl-enter'}
                        onChange={(val) => commitSettings({ ...draft, enterSubmit: val === 'enter' })}
                        options={[
                          { label: 'Enter', value: 'enter' },
                          { label: navigator.userAgent.includes('Mac') ? 'Cmd + Enter' : 'Ctrl + Enter', value: 'ctrl-enter' }
                        ]}
                        className="w-full px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] text-xs transition-all duration-200 shadow-sm text-gray-700 dark:text-gray-200 outline-none"
                      />
                    </div>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                    选择 Enter 提交时，使用 Shift + Enter 换行；否则直接 Enter 换行。
                  </div>
                </div>
                <div className="block">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">提交任务后清空输入框</span>
                    <button
                      type="button"
                      onClick={() => commitSettings({ ...draft, clearInputAfterSubmit: !draft.clearInputAfterSubmit })}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${draft.clearInputAfterSubmit ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      role="switch"
                      aria-checked={draft.clearInputAfterSubmit}
                      aria-label="提交任务后清空输入框"
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${draft.clearInputAfterSubmit ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                    </button>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                    开启后，提交成功创建任务时会清空提示词和参考图。
                  </div>
                </div>
                <div className="block">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">参考图编辑按钮</span>
                    <div className="w-32">
                      <Select
                        value={draft.referenceImageEditAction}
                        onChange={(val) => commitSettings({ ...draft, referenceImageEditAction: val as AppSettings['referenceImageEditAction'] })}
                        options={[
                          { label: '询问', value: 'ask' },
                          { label: '替换参考图', value: 'replace-reference' },
                          { label: '添加遮罩', value: 'add-mask' },
                        ]}
                        className="w-full px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] text-xs transition-all duration-200 shadow-sm text-gray-700 dark:text-gray-200 outline-none"
                      />
                    </div>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                    控制未添加遮罩的参考图点击编辑按钮时，是每次询问、直接替换参考图，还是直接添加遮罩。
                  </div>
                </div>
                <div className="block">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">重启后加载上次的输入框</span>
                    <button
                      type="button"
                      onClick={() => commitSettings({ ...draft, persistInputOnRestart: !draft.persistInputOnRestart })}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${draft.persistInputOnRestart ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      role="switch"
                      aria-checked={draft.persistInputOnRestart}
                      aria-label="重启后加载上次的输入框"
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${draft.persistInputOnRestart ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                    </button>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                    关闭后，不再持久化提示词和参考图，下次启动会使用空输入框。
                  </div>
                </div>
                <div className="block">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">复用配置时临时复用该任务的 API 配置</span>
                    <button
                      type="button"
                      onClick={() => commitSettings({ ...draft, reuseTaskApiProfileTemporarily: !draft.reuseTaskApiProfileTemporarily })}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${draft.reuseTaskApiProfileTemporarily ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      role="switch"
                      aria-checked={draft.reuseTaskApiProfileTemporarily}
                      aria-label="复用配置时临时复用该任务的 API 配置"
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${draft.reuseTaskApiProfileTemporarily ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                    </button>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                    开启后，复用历史任务时会临时使用该任务的 API 配置，找不到该配置时提交会提示；关闭后，会继续使用当前的 API 配置。
                  </div>
                </div>
                <div className="block">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">成功任务仍然展示重试按钮</span>
                    <button
                      type="button"
                      onClick={() => commitSettings({ ...draft, alwaysShowRetryButton: !draft.alwaysShowRetryButton })}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${draft.alwaysShowRetryButton ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      role="switch"
                      aria-checked={draft.alwaysShowRetryButton}
                      aria-label="成功任务仍然展示重试按钮"
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${draft.alwaysShowRetryButton ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                    </button>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                    开启后，即使任务成功生成，也会在任务卡片和详情页显示重试按钮。
                  </div>
                </div>
                <div className="block">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">显示画布对齐辅助线</span>
                    <button
                      type="button"
                      onClick={() => commitSettings({ ...draft, showCanvasAlignmentGuides: !draft.showCanvasAlignmentGuides })}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${draft.showCanvasAlignmentGuides ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      role="switch"
                      aria-checked={draft.showCanvasAlignmentGuides}
                      aria-label="显示画布对齐辅助线"
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${draft.showCanvasAlignmentGuides ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                    </button>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                    关闭后，拖动节点时不显示虚线，但仍会保留自动对齐。
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'api' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-500/15 dark:bg-blue-500/[0.08]">
                  <h4 className="text-sm font-bold text-blue-700 dark:text-blue-300">出图 API 配置</h4>
                  <p data-selectable-text className="mt-1 text-xs leading-relaxed text-blue-600/80 dark:text-blue-200/70">
                    用于生图工坊和画布工坊的图片生成、图片编辑请求。
                  </p>
                </div>
                <div className="block">
                  <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">当前配置</span>
                  <div className="grid grid-cols-2 gap-2">
                    {LOCKED_OPENAI_API_PROFILES.map((profile) => (
                      <button
                        key={profile.id}
                        type="button"
                        onClick={() => switchProfile(profile.id)}
                        className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                          activeProfile.id === profile.id
                            ? 'border-blue-300 bg-blue-50 text-blue-700 shadow-sm shadow-blue-500/10 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-200'
                            : 'border-gray-200/70 bg-white/60 text-gray-600 hover:border-gray-300 hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.07]'
                        }`}
                      >
                        {profile.name}
                      </button>
                    ))}
                  </div>
                </div>

              {/* 3. API URL */}
              {activeProviderUsesApiUrl && (
                <label className="block">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">API URL</span>
                    <button
                      type="button"
                      onClick={() => void copyApiUrl(activeProfile.baseUrl)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-gray-200/70 bg-white/70 text-gray-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:border-blue-400/30 dark:hover:bg-blue-500/15 dark:hover:text-blue-200"
                      aria-label="复制 API URL"
                      title="复制 API URL"
                    >
                      <CopyIcon className="h-3 w-3" />
                    </button>
                  </div>
                  <input
                    value={activeProfile.baseUrl}
                    type="text"
                    readOnly
                    onFocus={(event) => event.currentTarget.select()}
                    className="w-full cursor-text rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                  />
                </label>
              )}

              {/* 5. API Key */}
              <div className="block">
                <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">API Key</span>
                <div className="relative">
                  <input
                    value={activeProfile.apiKey}
                    onChange={(e) => updateActiveProfile({ apiKey: e.target.value })}
                    onBlur={(e) => commitActiveProfilePatch({ apiKey: e.target.value })}
                    type={showApiKey ? 'text' : 'password'}
                    placeholder={activeProfile.provider === 'fal' ? 'FAL_KEY' : 'sk-...'}
                    className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 pr-10 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showApiKey ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="mt-1.5 text-xs text-gray-500 dark:text-gray-500" />
              </div>



              {/* 11. 请求超时 */}
              {activeProviderIsOpenAICompatible && (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">请求超时 (秒)</span>
                    <input
                      value={timeoutInput}
                      onChange={(e) => setTimeoutInput(e.target.value)}
                      onBlur={commitTimeout}
                      type="number"
                      min={10}
                      max={600}
                      className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                    />
                  </label>

                  <div className="block">
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="block text-sm text-gray-600 dark:text-gray-300">Key 余额</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={queryActiveProfileBalance}
                          disabled={isQueryingBalance}
                          className="rounded-xl bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isQueryingBalance ? '查询中...' : '查询'}
                        </button>
                        <PriceTableButton
                          activeProfile={activeProfile}
                          buttonClassName="rounded-xl border border-gray-200/70 bg-white/70 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:border-blue-400/30 dark:hover:bg-blue-500/15 dark:hover:text-blue-200"
                        />
                      </div>
                    </div>
                    <div className="min-h-[42px] rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200">
                      {activeProfileBalanceText ? (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>{activeProfileBalanceText}</span>
                          {activeProfileBalanceUpdatedAt && (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {new Date(activeProfileBalanceUpdatedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">未查询</span>
                      )}
                    </div>
                  </div>
                </>
              )}

            </div>
            )}

            {activeTab === 'textApi' && (
              <div className="space-y-5">
                <ExternalApiConfigSection
                  idPrefix="text-api"
                  title="文字 API 配置"
                  baseUrl={draft.textBaseUrl}
                  apiKey={draft.textApiKey}
                  model={draft.textModel}
                  timeout={draft.textTimeout}
                  showApiKey={showApiKey}
                  modelOptions={textModelOptions}
                  isFetchingModels={isFetchingTextModels}
                  onBaseUrlDraftChange={(value) => setDraft({ ...draft, textBaseUrl: value })}
                  onBaseUrlCommit={(value) => commitSettings({ ...draft, textBaseUrl: normalizeBaseUrl(value) })}
                  onApiKeyDraftChange={(value) => setDraft({ ...draft, textApiKey: value })}
                  onApiKeyCommit={(value) => commitSettings({ ...draft, textApiKey: value })}
                  onModelDraftChange={(value) => setDraft({ ...draft, textModel: value })}
                  onModelCommit={(value) => commitSettings({ ...draft, textModel: value.trim() })}
                  onTimeoutDraftChange={(value) => setDraft({ ...draft, textTimeout: value })}
                  onTimeoutCommit={(value) => commitSettings({ ...draft, textTimeout: value })}
                  onToggleShowApiKey={() => setShowApiKey((value) => !value)}
                  onFetchModels={() => void fetchExternalApiModels('text')}
                />
              </div>
            )}

            {/* 保留标题卡片及简短用途说明，生成参数仍由画布节点单独设置。 */}
            {activeTab === 'videoApi' && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-500/15 dark:bg-blue-500/[0.08]">
                  <h4 className="text-sm font-bold text-blue-700 dark:text-blue-300">视频 API 配置</h4>
                  <p data-selectable-text className="mt-1 text-xs leading-relaxed text-blue-600/80 dark:text-blue-200/70">
                    用于画布工坊里的视频生成。
                  </p>
                </div>
                <ExternalApiConfigSection
                  idPrefix="video-api"
                  title="视频 API 配置"
                  onCopyBaseUrl={() => void copyApiUrl(CANVAS_VIDEO_BASE_URL)}
                  // 正常状态不展示内部绑定说明，仅在凭据未就绪时保留必要提示。
                  apiKeyHint={videoUsesAccountCredentials && !videoAccountKey ? videoKeyQuery.isError ? '账号视频 Key 暂不可用' : '正在准备账号视频 Key' : undefined}
                  baseUrl={CANVAS_VIDEO_BASE_URL}
                  apiKey={videoUsesAccountCredentials ? videoAccountKey : draft.videoApiKey}
                  apiKeyReadOnly={videoUsesAccountCredentials}
                  onCopyApiKey={async () => {
                    try {
                      await copyTextToClipboard(effectiveVideoApiKey)
                      showToast('视频 Key 已复制', 'success')
                    } catch { showToast('复制视频 Key 失败', 'error') }
                  }}
                  model={draft.videoModel}
                  timeout={CANVAS_VIDEO_TIMEOUT}
                  showApiKey={showApiKey}
                  modelOptions={videoModelOptions}
                  isFetchingModels={isFetchingVideoModels}
                  onBaseUrlDraftChange={() => undefined}
                  onBaseUrlCommit={() => undefined}
                  onApiKeyDraftChange={(value) => setDraft({ ...draft, videoApiKey: value })}
                  onApiKeyCommit={(value) => commitSettings({ ...draft, videoApiKey: value })}
                  onModelDraftChange={(value) => setDraft({ ...draft, videoModel: normalizeCanvasVideoModel(value) })}
                  onModelCommit={(value) => commitSettings({ ...draft, videoModel: normalizeCanvasVideoModel(value) })}
                  onTimeoutDraftChange={() => undefined}
                  onTimeoutCommit={() => undefined}
                  onToggleShowApiKey={() => setShowApiKey((value) => !value)}
                  onFetchModels={() => void fetchExternalApiModels('video')}
                  fixedBaseUrl={CANVAS_VIDEO_BASE_URL}
                  fixedTimeout={CANVAS_VIDEO_TIMEOUT}
                />
                {videoUsesAccountCredentials && videoKeyQuery.isError && !videoAccountKey && (
                  <div role="alert" className="flex items-center justify-between gap-3 text-sm text-red-600 dark:text-red-400">
                    <span>{videoKeyQuery.error.message}</span>
                    <button type="button" disabled={videoKeyQuery.isFetching} onClick={() => void videoKeyQuery.refetch()} className="shrink-0 rounded-xl border border-current px-3 py-1.5 disabled:opacity-50">重试</button>
                  </div>
                )}
              </div>
            )}
            
            {activeTab === 'appearance' && (
              <div className="space-y-5">
                <HomeStreamerSetting enabled={draft.homeStreamerMode} onChange={(enabled) => commitSettings({ ...draft, homeStreamerMode: enabled })} />
                <div className="block">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">当前背景</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <button type="button" onClick={randomizeBackgroundFromApi} disabled={isRandomizingBackground} className="rounded-xl bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50">{isRandomizingBackground ? '获取中...' : '随机'}</button>
                      <button type="button" onClick={() => backgroundFileInputRef.current?.click()} className="rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]">上传</button>
                      <button type="button" onClick={() => commitSettings({ ...draft, appearanceBackgroundImageUrl: '' })} className="rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]">清空</button>
                    </div>
                  </div>
                  <input value={draft.appearanceBackgroundImageUrl} onChange={(e) => setDraft({ ...draft, appearanceBackgroundImageUrl: e.target.value })} onBlur={(e) => commitSettings({ ...draft, appearanceBackgroundImageUrl: e.target.value })} type="text" placeholder="随机后自动填入，也可以手动粘贴图片地址" className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50" />
                  <input ref={backgroundFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleBackgroundUpload} />
                </div>
                <label className="block">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">背景透明度</span>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{Math.round(draft.appearanceBackgroundOpacity * 100)}%</span>
                  </div>
                  <input
                    value={draft.appearanceBackgroundOpacity}
                    onChange={(e) => {
                      const value = Math.min(1, Math.max(0, Number(e.target.value)))
                      commitSettings({ ...draft, appearanceBackgroundOpacity: value })
                    }}
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    className="w-full accent-blue-500"
                  />
                </label>

                <label className="block">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">毛玻璃</span>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{draft.appearanceBackgroundBlur}px</span>
                  </div>
                  <input
                    value={draft.appearanceBackgroundBlur}
                    onChange={(e) => {
                      const value = Math.min(60, Math.max(0, Number(e.target.value)))
                      commitSettings({ ...draft, appearanceBackgroundBlur: value })
                    }}
                    type="range"
                    min={0}
                    max={60}
                    step={1}
                    className="w-full accent-blue-500"
                  />
                </label>

                {draft.appearanceBackgroundImageUrl.trim() && (
                  <div className="aspect-video overflow-hidden rounded-2xl border border-gray-200/70 bg-gray-100 dark:border-white/[0.08] dark:bg-white/[0.03]">
                    <img src={draft.appearanceBackgroundImageUrl} alt="" className="h-full w-full object-cover" />
                  </div>
                )}

              </div>
            )}

            {activeTab === 'sync' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02] space-y-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Cloud className="h-4 w-4 text-gray-700 dark:text-gray-300" />
                      <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">同步</h4>
                    </div>
                    <Checkbox checked={cloudSync.enabled} onChange={(checked) => updateCloudSync({ enabled: checked })} label="启用同步" />
                  </div>

                  <div className="grid gap-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold text-gray-500 dark:text-gray-400">网盘类型</span>
                        <Select
                          value={cloudSync.provider}
                          onChange={(value) => updateCloudSync({ provider: value as CloudSyncProvider })}
                          options={CLOUD_SYNC_PROVIDER_OPTIONS.map((provider) => ({ label: provider.label, value: provider.value }))}
                          className="rounded-xl border border-gray-200/70 bg-white/80 px-3 py-2.5 text-sm text-gray-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold text-gray-500 dark:text-gray-400">{isLocalFileSync ? '备份文件名' : '远端文件名'}</span>
                        <input
                          value={cloudSync.fileName}
                          onChange={(e) => updateCloudSync({ fileName: e.target.value })}
                          className="w-full rounded-xl border border-gray-200/70 bg-white/80 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:focus:border-blue-500/50"
                          placeholder="gpt-image-playground-backup.zip"
                        />
                      </label>
                    </div>

                    <div className="rounded-xl border border-blue-100/70 bg-blue-50/50 px-3 py-2 text-xs leading-relaxed text-blue-700 dark:border-blue-400/10 dark:bg-blue-400/10 dark:text-blue-200">
                      {cloudSyncInfo.help}
                      {cloudSyncInfo.docsUrl ? (
                        <a href={cloudSyncInfo.docsUrl} target="_blank" rel="noreferrer" className="ml-2 font-semibold underline underline-offset-2">
                          文档
                        </a>
                      ) : null}
                    </div>

                    {isLocalFileSync ? (
                      <div className="grid gap-3">
                        <div className="rounded-xl border border-gray-100 bg-white/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.04]">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                                <HardDrive className="h-4 w-4" />
                                本地备份文件
                              </div>
                              <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                                {displayLocalSyncFileName ? `当前文件：${displayLocalSyncFileName}` : '还没有选择本地备份文件'}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={handleChooseLocalSyncFile}
                                disabled={isChoosingLocalSyncFile || !localFileSyncSupported}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isChoosingLocalSyncFile ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <HardDrive className="h-3.5 w-3.5" />}
                                选择文件
                              </button>
                              {displayLocalSyncFileName ? (
                                <button
                                  type="button"
                                  onClick={handleClearLocalSyncFile}
                                  className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]"
                                >
                                  清除授权
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:border-amber-400/10 dark:bg-amber-400/10 dark:text-amber-200">
                            {localFileSyncSupported
                              ? '浏览器需要你先手动选择一次文件授权。授权后自动同步会写入这个文件；如果清理浏览器站点数据，授权会失效，但硬盘上的备份文件还在。'
                              : '当前浏览器或访问地址不支持本地硬盘同步，请使用 Chrome/Edge，并通过 HTTPS 或 localhost 打开。'}
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="block">
                            <span className="mb-1.5 block text-xs font-semibold text-gray-500 dark:text-gray-400">自动同步间隔</span>
                            <input
                              value={cloudSync.autoSyncIntervalMinutes}
                              onChange={(e) => updateCloudSync({ autoSyncIntervalMinutes: Number(e.target.value) || 5 })}
                              type="number"
                              min={5}
                              step={1}
                              className="w-full rounded-xl border border-gray-200/70 bg-white/80 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:focus:border-blue-500/50"
                            />
                          </label>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <Checkbox checked={cloudSync.autoSync} onChange={(checked) => updateCloudSync({ autoSync: checked })} label={`每 ${Math.max(5, Number(cloudSync.autoSyncIntervalMinutes) || 5)} 分钟自动写入本地文件`} />
                          <div className="text-xs text-gray-400 dark:text-gray-500">
                            上次写入：{formatCloudSyncTime(cloudSync.lastUploadAt)}；上次拉取：{formatCloudSyncTime(cloudSync.lastPullAt)}
                          </div>
                        </div>
                      </div>
                    ) : cloudSyncInfo.direct ? (
                      <>
                        {(cloudSyncInfo.protocol === 'webdav' || cloudSyncInfo.protocol === 'custom-api') && (
                          <label className="block">
                            <span className="mb-1.5 block text-xs font-semibold text-gray-500 dark:text-gray-400">
                              {cloudSyncInfo.protocol === 'webdav' ? 'WebDAV 地址' : '自定义同步接口 URL'}
                            </span>
                            <input
                              value={cloudSync.endpoint}
                              onChange={(e) => updateCloudSync({ endpoint: e.target.value })}
                              className="w-full rounded-xl border border-gray-200/70 bg-white/80 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:focus:border-blue-500/50"
                              placeholder={cloudSyncInfo.protocol === 'webdav' ? 'https://example.com/dav' : 'https://example.com/api/backup'}
                            />
                          </label>
                        )}

                        <div className="grid gap-3 md:grid-cols-2">
                          {cloudSyncInfo.protocol === 'webdav' ? (
                            <>
                              <label className="block">
                                <span className="mb-1.5 block text-xs font-semibold text-gray-500 dark:text-gray-400">账号</span>
                                <input
                                  value={cloudSync.username}
                                  onChange={(e) => updateCloudSync({ username: e.target.value })}
                                  className="w-full rounded-xl border border-gray-200/70 bg-white/80 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:focus:border-blue-500/50"
                                  placeholder="WebDAV 用户名"
                                />
                              </label>
                              <label className="block">
                                <span className="mb-1.5 block text-xs font-semibold text-gray-500 dark:text-gray-400">应用密码</span>
                                <input
                                  value={cloudSync.password}
                                  onChange={(e) => updateCloudSync({ password: e.target.value })}
                                  type="password"
                                  className="w-full rounded-xl border border-gray-200/70 bg-white/80 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:focus:border-blue-500/50"
                                  placeholder="WebDAV 密码或应用密码"
                                />
                              </label>
                            </>
                          ) : (
                            <label className="block md:col-span-2">
                              <span className="mb-1.5 block text-xs font-semibold text-gray-500 dark:text-gray-400">Access Token</span>
                              <input
                                value={cloudSync.token}
                                onChange={(e) => updateCloudSync({ token: e.target.value })}
                                type="password"
                                className="w-full rounded-xl border border-gray-200/70 bg-white/80 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:focus:border-blue-500/50"
                                placeholder="OAuth access token 或自定义 Bearer Token"
                              />
                            </label>
                          )}
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="block">
                            <span className="mb-1.5 block text-xs font-semibold text-gray-500 dark:text-gray-400">
                              {cloudSync.provider === 'google-drive' ? 'Google 文件夹 ID（可选）' : '远端目录'}
                            </span>
                            <input
                              value={cloudSync.provider === 'google-drive' ? cloudSync.folderId : cloudSync.remotePath}
                              onChange={(e) => updateCloudSync(cloudSync.provider === 'google-drive' ? { folderId: e.target.value } : { remotePath: e.target.value })}
                              className="w-full rounded-xl border border-gray-200/70 bg-white/80 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:focus:border-blue-500/50"
                              placeholder={cloudSync.provider === 'google-drive' ? '留空则上传到我的云端硬盘根目录' : '/gpt-image-playground'}
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1.5 block text-xs font-semibold text-gray-500 dark:text-gray-400">自动同步间隔</span>
                            <input
                              value={cloudSync.autoSyncIntervalMinutes}
                              onChange={(e) => updateCloudSync({ autoSyncIntervalMinutes: Number(e.target.value) || 5 })}
                              type="number"
                              min={5}
                              step={1}
                              className="w-full rounded-xl border border-gray-200/70 bg-white/80 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:focus:border-blue-500/50"
                            />
                          </label>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <Checkbox checked={cloudSync.autoSync} onChange={(checked) => updateCloudSync({ autoSync: checked })} label={`每 ${Math.max(5, Number(cloudSync.autoSyncIntervalMinutes) || 5)} 分钟自动上传`} />
                          <div className="text-xs text-gray-400 dark:text-gray-500">
                            上次上传：{formatCloudSyncTime(cloudSync.lastUploadAt)}；上次拉取：{formatCloudSyncTime(cloudSync.lastPullAt)}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:border-amber-400/10 dark:bg-amber-400/10 dark:text-amber-200">
                        这个网盘不建议在浏览器里直连。可以先用 AList/OpenList 转 WebDAV，或把上传/下载逻辑放到自定义同步接口里。
                      </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-gray-100 bg-white/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.04]">
                        <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">上传范围</div>
                        <div className="space-y-2">
                          <Checkbox checked={cloudSync.uploadTasks} onChange={(checked) => updateCloudSync({ uploadTasks: checked })} label="生图工坊记录和图片" />
                          <Checkbox checked={cloudSync.uploadCanvasProjects} onChange={(checked) => updateCloudSync({ uploadCanvasProjects: checked })} label={`画布工坊（${canvasProjects.length} 个）`} />
                          <Checkbox checked={cloudSync.uploadAssets} onChange={(checked) => updateCloudSync({ uploadAssets: checked })} label={`我的素材（${assets.length} 个）`} />
                        </div>
                        <div className="mt-2 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">手动上传和自动同步使用这个范围。</div>
                      </div>

                      <div className="rounded-xl border border-gray-100 bg-white/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.04]">
                        <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">拉取范围</div>
                        <div className="space-y-2">
                          <Checkbox checked={cloudSync.pullTasks} onChange={(checked) => updateCloudSync({ pullTasks: checked })} label="生图工坊记录和图片" />
                          <Checkbox checked={cloudSync.pullCanvasProjects} onChange={(checked) => updateCloudSync({ pullCanvasProjects: checked })} label="画布工坊" />
                          <Checkbox checked={cloudSync.pullAssets} onChange={(checked) => updateCloudSync({ pullAssets: checked })} label="我的素材" />
                        </div>
                        <div className="mt-2 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">手动拉取只导入勾选的数据，不导入配置和 API。</div>
                      </div>
                    </div>

                    {cloudSync.lastError ? (
                      <div className="rounded-xl border border-red-100 bg-red-50/60 px-3 py-2 text-xs text-red-600 dark:border-red-500/10 dark:bg-red-500/10 dark:text-red-300">
                        最近错误：{cloudSync.lastError}
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={handleCloudSyncUpload}
                      disabled={!cloudSyncUploadReady || isCloudSyncBusy}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300"
                    >
                      {isCloudSyncBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                      手动上传
                    </button>
                    <button
                      type="button"
                      onClick={handleCloudSyncPull}
                      disabled={!cloudSyncPullReady || isCloudSyncBusy}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300"
                    >
                      {isCloudSyncBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
                      手动拉取
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'data' && (
              <div className="space-y-4">
                <div className="rounded-2xl bg-gray-50/80 p-4 border border-gray-200/60 dark:bg-white/[0.02] dark:border-white/[0.05] flex items-start gap-3">
                  <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <div className="text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
                    所有的配置、任务记录和生成的图片均仅保存在您的浏览器本地（除非您使用的服务商存储了它们）。如果您需要清理浏览器站点数据、重置浏览器或使用其他设备，请先导出备份。
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02] space-y-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <ExportIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                    <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导出数据</h4>
                  </div>
                  <div className="grid gap-3">
                    <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                      <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">生图工坊</div>
                      <div className="flex flex-wrap gap-x-6 gap-y-3">
                        <Checkbox checked={exportTasks} onChange={setExportTasks} label="生成记录、对话和图片" />
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <Checkbox checked={exportCanvasProjects} onChange={setCanvasProjectExportEnabled} label={`画布工坊（${canvasProjects.length} 个）`} />
                        {canvasProjects.length ? (
                          <button
                            type="button"
                            onClick={() => setExportCanvasProjectIds(exportCanvasProjectIds.length === canvasProjects.length ? [] : canvasProjects.map((project) => project.id))}
                            className="text-xs font-medium text-blue-500 transition hover:text-blue-600 dark:text-blue-300"
                          >
                            {exportCanvasProjectIds.length === canvasProjects.length ? '取消全选' : '全选画布'}
                          </button>
                        ) : null}
                      </div>
                      {exportCanvasProjects ? (
                        canvasProjects.length ? (
                          <div className="max-h-40 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                            {canvasProjects.map((project) => (
                              <div key={project.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2 text-sm dark:bg-white/[0.04]">
                                <span className="min-w-0">
                                  <span className="block truncate text-gray-700 dark:text-gray-200">{project.title || '未命名画布'}</span>
                                  <span className="mt-0.5 block text-xs text-gray-400">{project.nodes.length} 个节点</span>
                                </span>
                                <Checkbox checked={exportCanvasProjectIds.includes(project.id)} onChange={(checked) => toggleExportCanvasProject(project.id, checked)} label="" />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400">暂无可导出的画布</div>
                        )
                      ) : null}
                    </div>

                    <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <Checkbox checked={exportAssets} onChange={setAssetExportEnabled} label={`我的素材（${assets.length} 个）`} />
                        {assets.length ? (
                          <button
                            type="button"
                            onClick={() => setExportAssetIds(exportAssetIds.length === assets.length ? [] : assets.map((asset) => asset.id))}
                            className="text-xs font-medium text-blue-500 transition hover:text-blue-600 dark:text-blue-300"
                          >
                            {exportAssetIds.length === assets.length ? '取消全选' : '全选素材'}
                          </button>
                        ) : null}
                      </div>
                      {exportAssets ? (
                        assets.length ? (
                          <div className="max-h-40 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                            {assets.map((asset) => (
                              <div key={asset.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2 text-sm dark:bg-white/[0.04]">
                                <span className="min-w-0">
                                  <span className="block truncate text-gray-700 dark:text-gray-200">{asset.title || '未命名素材'}</span>
                                  <span className="mt-0.5 block text-xs text-gray-400">{asset.kind === 'text' ? '文本' : asset.kind === 'video' ? '视频' : '图片'}</span>
                                </span>
                                <Checkbox checked={exportAssetIds.includes(asset.id)} onChange={(checked) => toggleExportAsset(asset.id, checked)} label="" />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400">暂无可导出的素材</div>
                        )
                      ) : null}
                    </div>
                  </div>
                  <button
                    onClick={() => exportData({ exportTasks, exportCanvasProjectIds: selectedExportCanvasIds, exportAssetIds: selectedExportAssetIds })}
                    disabled={!canExportData}
                    className="w-full rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300 flex items-center justify-center gap-2"
                  >
                    导出所选数据
                  </button>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02] space-y-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <ImportIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                    <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导入数据</h4>
                  </div>
                  <div className="grid gap-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">从备份中导入</div>
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                      <Checkbox checked={importConfig} onChange={setImportConfig} label="配置和 API" />
                      <Checkbox checked={importTasks} onChange={setImportTasks} label="生图工坊记录和图片" />
                      <Checkbox checked={importCanvasProjects} onChange={setImportCanvasProjects} label="画布工坊" />
                      <Checkbox checked={importAssets} onChange={setImportAssets} label="我的素材" />
                    </div>
                    <div className="text-xs leading-relaxed text-gray-400 dark:text-gray-500">导入会合并到当前数据，不会覆盖已有画布和素材；旧版备份、单独画布包、单独素材包也可以在这里导入。</div>
                  </div>
                  <button
                    onClick={() => importInputRef.current?.click()}
                    disabled={!canImportData || isImportingData}
                    className="w-full rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300 flex items-center justify-center gap-2"
                  >
                    {isImportingData ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        导入中...
                      </>
                    ) : (
                      '从 ZIP 导入所选数据'
                    )}
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={handleImport}
                  />
                </div>

                <div className="rounded-2xl border border-red-100/50 bg-red-50/30 p-4 dark:border-red-500/10 dark:bg-red-500/5 space-y-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <TrashIcon className="w-4 h-4 text-red-500/90 dark:text-red-400" />
                    <h4 className="text-sm font-bold text-red-500/90 dark:text-red-400">清除数据</h4>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-3">
                    <Checkbox checked={clearConfig} onChange={setClearConfig} label="配置和 API" tone="danger" />
                    <Checkbox checked={clearTasks} onChange={setClearTasks} label="生图工坊记录和图片" tone="danger" />
                    <Checkbox checked={clearCanvasProjects} onChange={setClearCanvasProjects} label="画布工坊" tone="danger" />
                    <Checkbox checked={clearAssets} onChange={setClearAssets} label="我的素材" tone="danger" />
                  </div>
                  <button
                    onClick={() =>
                      setConfirmDialog({
                        title: '清空所选数据',
                        message: `确定要清空所选的数据吗？此操作不可恢复。`,
                        action: () => handleClearAllData(),
                      })
                    }
                    disabled={!canClearData}
                    className="w-full rounded-xl border border-red-200/60 bg-red-50/50 px-4 py-2.5 text-sm font-medium text-red-500 transition-all hover:bg-red-50 hover:border-red-200 hover:text-red-600 disabled:opacity-50 disabled:hover:bg-red-50/50 disabled:hover:border-red-200/60 disabled:hover:text-red-500 dark:border-red-500/15 dark:bg-red-500/5 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:border-red-500/30 dark:hover:text-red-300 dark:disabled:hover:bg-red-500/5 dark:disabled:hover:border-red-500/15 dark:disabled:hover:text-red-400"
                  >
                    清空所选数据
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
      </div>

    </div>
  )
}
