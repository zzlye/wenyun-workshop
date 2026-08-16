import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Cloud, CloudDownload, CloudUpload, HardDrive, RefreshCw } from 'lucide-react'
import { normalizeBaseUrl } from '../lib/api'
import { buildApiUrl, isApiProxyAvailable, isApiProxyLocked, readClientDevProxyConfig, shouldUseApiProxy } from '../lib/devProxy'
import { useStore, exportData, importData, clearData, type SettingsTab } from '../store'
import {
  createDefaultOpenAIProfile,
  DEFAULT_FAL_BASE_URL,
  DEFAULT_FAL_MODEL,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_OPENAI_PROFILE_ID,
  DEFAULT_RESPONSES_MODEL,
  DEFAULT_SETTINGS,
  findEquivalentApiProfile,
  getApiProviderLabel,
  getApiBalanceSnapshot,
  getActiveApiProfile,
  importCustomProviderSettingsFromJson,
  isOpenAICompatibleProvider,
  LOCKED_OPENAI_API_PROFILES,
  mergeImportedSettings,
  normalizeCustomProviderDefinition,
  normalizeSettings,
  normalizeStreamPartialImages,
  setApiBalanceSnapshot,
  switchApiProfileProvider,
} from '../lib/apiProfiles'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { queryNewApiBalance } from '../lib/newApi'
import { parseModelListPayload } from '../lib/modelList'
import { CLOUD_SYNC_PROVIDER_OPTIONS, getCloudSyncProviderInfo, hasCloudSyncPullScope, hasCloudSyncUploadScope, isCloudSyncReady, pullDataBackupFromCloud, uploadDataBackupToCloud } from '../lib/cloudSync'
import { chooseLocalSyncFile, clearLocalSyncFile, getLocalSyncFileInfo, hasLocalSyncFileHandle, isLocalFileSyncSupported } from '../lib/localFileSync'
import { DEFAULT_STREAM_PARTIAL_IMAGES, type ApiProfile, type AppSettings, type CloudSyncProvider, type CustomProviderDefinition } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { DEFAULT_DROPDOWN_MAX_HEIGHT, getDropdownMaxHeight } from '../lib/dropdown'
import { CANVAS_VIDEO_BASE_URL, CANVAS_VIDEO_MODELS, CANVAS_VIDEO_TIMEOUT, normalizeCanvasVideoModel } from '../lib/videoModel'
import { useCanvasStore } from '../infiniteCanvasSource/app/(user)/canvas/stores/use-canvas-store'
import { useAssetStore } from '../infiniteCanvasSource/stores/use-asset-store'
import Select from './Select'
import { Checkbox } from './Checkbox'
import ViewportTooltip from './ViewportTooltip'
import PriceTableButton from './PriceTableButton'
import { ChevronDownIcon, CloseIcon, CopyIcon, PlusIcon, TrashIcon, ExportIcon, ImportIcon, DragHandleIcon, LinkIcon } from './icons'

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

const ADD_CUSTOM_PROVIDER_VALUE = '__add_custom_provider__'
const COPY_IMPORT_URL_OPTIONS_STORAGE_KEY = 'gpt-image-playground.copy-import-url-options'

const DEFAULT_COPY_IMPORT_URL_OPTIONS = {
  includeApiKey: false,
  useNewApiAddress: false,
  useNewApiKey: true,
  useNewApiModel: false,
}

type CopyImportUrlOptions = typeof DEFAULT_COPY_IMPORT_URL_OPTIONS
type ExternalApiTarget = 'text' | 'video'

function readCopyImportUrlOptions(): CopyImportUrlOptions {
  if (typeof window === 'undefined') return DEFAULT_COPY_IMPORT_URL_OPTIONS

  try {
    const saved = window.localStorage.getItem(COPY_IMPORT_URL_OPTIONS_STORAGE_KEY)
    if (!saved) return DEFAULT_COPY_IMPORT_URL_OPTIONS

    const parsed = JSON.parse(saved) as Partial<CopyImportUrlOptions> | null
    if (!parsed || typeof parsed !== 'object') return DEFAULT_COPY_IMPORT_URL_OPTIONS


    return {
      includeApiKey: false,
      useNewApiAddress: Boolean(parsed.useNewApiAddress),
      useNewApiKey: parsed.useNewApiKey === undefined ? true : Boolean(parsed.useNewApiKey),
      useNewApiModel: Boolean(parsed.useNewApiModel),
    }
  } catch {
    return DEFAULT_COPY_IMPORT_URL_OPTIONS
  }
}

function saveCopyImportUrlOptions(options: CopyImportUrlOptions) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(COPY_IMPORT_URL_OPTIONS_STORAGE_KEY, JSON.stringify({
      useNewApiAddress: options.useNewApiAddress,
      useNewApiKey: options.useNewApiKey,
      useNewApiModel: options.useNewApiModel,
    }))
  } catch {
    // localStorage 不可用时只保留当前会话状态。
  }
}


interface CustomProviderForm {
  json: string
}

const DEFAULT_CUSTOM_PROVIDER_MANIFEST = {
  name: '自定义服务商',
  submit: {
    path: 'images/generations',
    method: 'POST',
    contentType: 'json',
    body: {
      model: '$profile.model',
      prompt: '$prompt',
      size: '$params.size',
      quality: '$params.quality',
      output_format: '$params.output_format',
      moderation: '$params.moderation',
      output_compression: '$params.output_compression',
      n: '$params.n',
    },
    result: {
      imageUrlPaths: ['data.*.url'],
      b64JsonPaths: ['data.*.b64_json'],
    },
  },
  editSubmit: {
    path: 'images/edits',
    method: 'POST',
    contentType: 'multipart',
    body: {
      model: '$profile.model',
      prompt: '$prompt',
      size: '$params.size',
      quality: '$params.quality',
      output_format: '$params.output_format',
      moderation: '$params.moderation',
      output_compression: '$params.output_compression',
      n: '$params.n',
    },
    files: [
      { field: 'image[]', source: 'inputImages', array: true },
      { field: 'mask', source: 'mask' },
    ],
    result: {
      imageUrlPaths: ['data.*.url'],
      b64JsonPaths: ['data.*.b64_json'],
    },
  },
}

function createDefaultCustomProviderForm(): CustomProviderForm {
  return {
    json: JSON.stringify(DEFAULT_CUSTOM_PROVIDER_MANIFEST, null, 2),
  }
}

function customProviderToForm(provider: CustomProviderDefinition): CustomProviderForm {
  return {
    json: JSON.stringify({
      name: provider.name,
      submit: provider.submit,
      editSubmit: provider.editSubmit,
      poll: provider.poll,
    }, null, 2),
  }
}

function customProviderFormToInput(form: CustomProviderForm) {
  return JSON.parse(form.json)
}

function isPristineNewOpenAIProfile(profile: ApiProfile) {
  const defaultProfile = createDefaultOpenAIProfile({ id: profile.id, name: '新配置' })
  return profile.name === '新配置' &&
    profile.provider === 'openai' &&
    profile.baseUrl === DEFAULT_SETTINGS.baseUrl &&
    profile.apiKey === '' &&
    profile.model === DEFAULT_IMAGES_MODEL &&
    profile.timeout === DEFAULT_SETTINGS.timeout &&
    profile.apiMode === 'images' &&
    profile.codexCli === false &&
    profile.apiProxy === defaultProfile.apiProxy &&
    profile.streamImages === defaultProfile.streamImages &&
    profile.streamPartialImages === defaultProfile.streamPartialImages
}

function getImportedProfileFromMergedSettings(
  nextSettings: AppSettings,
  previousProfileIds: Set<string>,
  importedSettings: { customProviders: CustomProviderDefinition[], profiles: ApiProfile[] },
) {
  const existingProfile = importedSettings.profiles
    .map((profile) => findEquivalentApiProfile(nextSettings, profile, importedSettings.customProviders))
    .find((profile): profile is ApiProfile => profile != null && previousProfileIds.has(profile.id))
  if (existingProfile) return existingProfile

  return nextSettings.profiles.find((profile) => !previousProfileIds.has(profile.id)) ?? nextSettings.profiles[0]
}

function isAsyncCustomProvider(provider: CustomProviderDefinition | null | undefined) {
  return Boolean(provider?.poll || provider?.submit.taskIdPath || provider?.editSubmit?.taskIdPath)
}

function isProfileApiProxyEligible(settings: AppSettings, profile: ApiProfile) {
  if (!isOpenAICompatibleProvider(settings, profile.provider)) return false
  const customProvider = settings.customProviders.find((provider) => provider.id === profile.provider)
  return !isAsyncCustomProvider(customProvider)
}

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
  description: string
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
}

function ExternalApiConfigSection({
  idPrefix,
  title,
  description,
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
    <section className="space-y-4 rounded-2xl border border-gray-200/70 bg-white/55 p-4 dark:border-white/[0.08] dark:bg-white/[0.025]" aria-label={title} title={description}>
      <label className="block">
        <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">API URL</span>
        <input
          value={displayedBaseUrl}
          readOnly={Boolean(fixedBaseUrl)}
          onChange={(e) => {
            if (!fixedBaseUrl) onBaseUrlDraftChange(e.target.value)
          }}
          onBlur={(e) => onBaseUrlCommit(fixedBaseUrl || e.target.value)}
          type="text"
          placeholder="https://example.com/v1"
          className={`w-full rounded-xl border border-gray-200/70 px-3 py-2.5 text-sm text-gray-700 outline-none transition dark:border-white/[0.08] dark:text-gray-200 ${fixedBaseUrl ? 'cursor-default bg-gray-100/80 dark:bg-white/[0.05]' : 'bg-white/60 focus:border-blue-300 dark:bg-white/[0.03] dark:focus:border-blue-500/50'}`}
        />
        {fixedBaseUrl ? <div data-selectable-text className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">接口地址固定，画布视频请求不会使用其他 URL。</div> : null}
      </label>

      <div className="block">
        <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">API Key</span>
        <div className="relative">
          <input
            value={apiKey}
            onChange={(e) => onApiKeyDraftChange(e.target.value)}
            onBlur={(e) => onApiKeyCommit(e.target.value)}
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
        {fixedTimeout !== undefined ? <div data-selectable-text className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">画布视频任务最长等待 900 秒。</div> : null}
      </label>
    </section>
  )
}

const CUSTOM_PROVIDER_LLM_PROMPT = `# 角色
你是 API 文档解析助手。你的任务是根据用户提供的图像生成 API 文档，生成本应用可导入的自定义服务商配置 JSON。

# 工作流程
1. 先向用户索要 API 文档链接或完整文档文本。
2. 如果当前环境支持读取链接，主动读取；否则要求用户粘贴文档内容。
3. 在未获得文档前不要猜测，不要生成占位配置。
4. 从文档中判断提交接口、图生图接口、异步任务查询接口、状态值、结果图片路径。
5. 如果文档中明确了默认模型 ID 或 API Base URL，在 profiles 中填入；如果未明确模型 ID，model 使用 "gpt-image-2"；如果未明确 API Base URL，baseUrl 留空，由用户稍后填写。
6. 输出最终 JSON；不要索要 API Key。

# 输出结构
输出 JSON 包含两个顶层字段：
- customProviders：自定义服务商 Manifest 数组，每项描述一个服务商的接口映射规则。
- profiles：API 配置数组，每项描述一个可直接使用的连接配置，引用 customProviders 中的服务商。

## customProviders 元素（Manifest）
每个元素的顶层字段：id、name、submit、editSubmit、poll。
id 是服务商的唯一标识，用于 profiles 中的 provider 字段引用，建议使用 custom-{英文短名} 格式。
submit 是文生图提交配置，必填。
editSubmit 是图生图或局部重绘提交配置，可选。如果文生图和图生图使用同一个 JSON 接口，可以省略 editSubmit，并在 submit.body 中加入 image_urls。
poll 是异步任务查询配置，可选；同步接口不要写 poll。

submit/editSubmit 字段：
- path：接口路径，不带开头斜杠，不带 /v1/ 前缀，例如 images/generations 或 tasks/{task_id}。
- method：GET 或 POST，默认 POST。
- contentType：json 或 multipart。
- query：提交 query 参数对象，可选，例如 {"async":"true"}。
- body：请求体模板对象。
- files：multipart 文件字段数组，仅 contentType=multipart 时使用。
- taskIdPath：提交响应里的任务 ID JSON 路径；同步接口不要写。
- result：同步响应图片提取规则。

poll 字段：
- path：任务查询路径，使用 {task_id} 占位，例如 images/tasks/{task_id} 或 tasks/{task_id}。
- method：GET 或 POST，默认 GET。
- query：查询 query 参数对象，可选。
- intervalSeconds：轮询间隔秒数。
- statusPath：查询响应状态字段路径。
- successValues：成功状态值数组。
- failureValues：失败状态值数组。
- errorPath：失败原因路径，可选。
- result：成功后图片提取规则。

result 字段：
- imageUrlPaths：图片 URL 路径数组，支持 * 通配数组。例如 data.*.url、data.result.images.*.url.*。
- b64JsonPaths：base64 图片路径数组，支持 * 通配数组。例如 data.*.b64_json。

body 模板变量：
- $profile.model：用户在设置里填写的模型 ID。
- $prompt：当前提示词。
- $params.size、$params.quality、$params.output_format、$params.output_compression、$params.moderation、$params.n：应用内参数。
- $inputImages.dataUrls：参考图 data URL 数组；没有参考图时会自动省略该字段。
- $mask.dataUrl：遮罩图 data URL；没有遮罩时会自动省略该字段。

multipart files 示例：
- {"field":"image[]","source":"inputImages","array":true}
- {"field":"mask","source":"mask"}

## profiles 元素
每个元素的字段：
- name：配置名称，方便用户识别。
- provider：对应 customProviders 中某个元素的 id。
- baseUrl：API Base URL。如果文档明确给出，填入完整基础地址；否则留空字符串 ""。
- model：模型 ID。如果 API 文档明确了默认模型，填入该值；否则使用 "gpt-image-2"。
- apiMode：固定为 "images"。
- apiProxy：可选。仅同步自定义服务商可以设为 true，用于配合部署端 API 代理隐藏真实上游地址；包含 taskIdPath 或 poll 的异步任务配置不要开启，应用不支持异步自定义服务商走代理。

profiles 中不要包含 apiKey（用户导入后自行填写）。

# 输出要求
- 最终回复只包含一个 \`\`\`json 代码块，代码块内是 JSON 对象。
- JSON 对象必须包含 customProviders 和 profiles 两个顶层字段。
- 代码块外不要附加解释文字。
- 不要输出 API Key、Authorization header。
- 如果文档返回 task_id，就必须配置 taskIdPath 和 poll。
- 如果结果 URL 是数组，路径必须写到数组元素，例如 data.result.images.*.url.*。

## 同步接口示例
{"customProviders":[{"id":"custom-example-sync","name":"示例同步服务商","submit":{"path":"images/generations","method":"POST","contentType":"json","body":{"model":"$profile.model","prompt":"$prompt","size":"$params.size","quality":"$params.quality","output_format":"$params.output_format","moderation":"$params.moderation","output_compression":"$params.output_compression","n":"$params.n"},"result":{"imageUrlPaths":["data.*.url"],"b64JsonPaths":["data.*.b64_json"]}},"editSubmit":{"path":"images/edits","method":"POST","contentType":"multipart","body":{"model":"$profile.model","prompt":"$prompt","size":"$params.size","quality":"$params.quality","output_format":"$params.output_format","moderation":"$params.moderation","output_compression":"$params.output_compression","n":"$params.n"},"files":[{"field":"image[]","source":"inputImages","array":true},{"field":"mask","source":"mask"}],"result":{"imageUrlPaths":["data.*.url"],"b64JsonPaths":["data.*.b64_json"]}}}],"profiles":[{"name":"示例同步服务商","provider":"custom-example-sync","baseUrl":"https://api.example.com/v1","model":"example-model-v1","apiMode":"images"}]}

## 异步接口示例
{"customProviders":[{"id":"custom-example-async","name":"示例异步服务商","submit":{"path":"images/generations","method":"POST","contentType":"json","query":{"async":"true"},"body":{"model":"$profile.model","prompt":"$prompt","size":"$params.size","n":"$params.n"},"taskIdPath":"data"},"editSubmit":{"path":"images/edits","method":"POST","contentType":"multipart","query":{"async":"true"},"body":{"model":"$profile.model","prompt":"$prompt","size":"$params.size","n":"$params.n"},"files":[{"field":"image[]","source":"inputImages","array":true}],"taskIdPath":"data"},"poll":{"path":"images/tasks/{task_id}","method":"GET","intervalSeconds":5,"statusPath":"data.status","successValues":["SUCCESS"],"failureValues":["FAILURE"],"errorPath":"data.fail_reason","result":{"imageUrlPaths":["data.data.data.*.url"],"b64JsonPaths":["data.data.data.*.b64_json"]}}}],"profiles":[{"name":"示例异步服务商","provider":"custom-example-async","baseUrl":"","model":"gpt-image-2","apiMode":"images"}]}

## 统一任务接口示例
{"customProviders":[{"id":"custom-example-task","name":"示例任务服务商","submit":{"path":"images/generations","method":"POST","contentType":"json","body":{"model":"$profile.model","prompt":"$prompt","n":"$params.n","size":"$params.size","resolution":"2k","quality":"$params.quality","image_urls":"$inputImages.dataUrls"},"taskIdPath":"data.0.task_id"},"poll":{"path":"tasks/{task_id}","method":"GET","query":{"language":"zh"},"intervalSeconds":5,"statusPath":"data.status","successValues":["completed"],"failureValues":["failed","cancelled"],"errorPath":"data.error.message","result":{"imageUrlPaths":["data.result.images.*.url.*"],"b64JsonPaths":[]}}}],"profiles":[{"name":"示例任务服务商","provider":"custom-example-task","baseUrl":"","model":"gpt-image-2","apiMode":"images"}]}`

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
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const profileMenuTriggerRef = useRef<HTMLButtonElement>(null)

  const profileImportUrlTooltipTimerRef = useRef<number | null>(null)
  const duplicateProfileTooltipTimerRef = useRef<number | null>(null)
  const llmPromptTooltipTimerRef = useRef<number | null>(null)
  const settingsScrollBoundaryRef = useRef<HTMLDivElement>(null)
  const customProviderScrollBoundaryRef = useRef<HTMLDivElement>(null)
  
  const [draft, setDraft] = useState<AppSettings>(normalizeSettings(settings))
  const [timeoutInput, setTimeoutInput] = useState(String(getActiveApiProfile(settings).timeout))
  const [showApiKey, setShowApiKey] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [profileMenuMaxHeight, setProfileMenuMaxHeight] = useState(DEFAULT_DROPDOWN_MAX_HEIGHT)
  const [showCustomProviderImport, setShowCustomProviderImport] = useState(false)
  const [editingCustomProviderId, setEditingCustomProviderId] = useState<string | null>(null)
  const [customProviderForm, setCustomProviderForm] = useState<CustomProviderForm>(createDefaultCustomProviderForm())
  const [customProviderImportError, setCustomProviderImportError] = useState<string | null>(null)
  const [profileImportUrlTooltipVisible, setProfileImportUrlTooltipVisible] = useState(false)
  const [duplicateProfileTooltipVisible, setDuplicateProfileTooltipVisible] = useState(false)
  const [llmPromptTooltipVisible, setLlmPromptTooltipVisible] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>('api')
  const [isRandomizingBackground, setIsRandomizingBackground] = useState(false)
  const [isQueryingBalance, setIsQueryingBalance] = useState(false)
  const [isFetchingTextModels, setIsFetchingTextModels] = useState(false)
  const [isFetchingVideoModels, setIsFetchingVideoModels] = useState(false)
  const [textModelOptions, setTextModelOptions] = useState<string[]>([])
  const [videoModelOptions, setVideoModelOptions] = useState<string[]>(() => [...CANVAS_VIDEO_MODELS])
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
  const [isImportingJson, setIsImportingJson] = useState(false)
  const [draggedProfileId, setDraggedProfileId] = useState<string | null>(null)
  const [dragOverProfileId, setDragOverProfileId] = useState<string | null>(null)
  const [dragDropPosition, setDragDropPosition] = useState<'before' | 'after' | null>(null)
  const [profileTouchDragPreview, setProfileTouchDragPreview] = useState<{
    label: string
    providerLabel: string
    x: number
    y: number
    width: number
    height: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const profileTouchDragRef = useRef<{ id: string, startX: number, startY: number, moved: boolean } | null>(null)
  const [copyImportUrlProfile, setCopyImportUrlProfile] = useState<ApiProfile | null>(null)
  const [copyImportUrlOptions, setCopyImportUrlOptions] = useState<CopyImportUrlOptions>(readCopyImportUrlOptions)

  const apiProxyConfig = readClientDevProxyConfig()
  const apiProxyAvailable = isApiProxyAvailable(apiProxyConfig)
  const apiProxyLocked = isApiProxyLocked(apiProxyConfig)
  const activeProfile = draft.profiles.find((profile) => profile.id === draft.activeProfileId) ?? draft.profiles[0] ?? getActiveApiProfile(draft)
  const activeProviderIsOpenAICompatible = isOpenAICompatibleProvider(draft, activeProfile.provider)
  const activeProviderUsesApiUrl = activeProviderIsOpenAICompatible || activeProfile.provider === 'fal'
  const activeCustomProvider = draft.customProviders.find((provider) => provider.id === activeProfile.provider)
  const activeProfileApiProxyEligible = isProfileApiProxyEligible(draft, activeProfile)
  const activeCustomProviderAsync = isAsyncCustomProvider(activeCustomProvider)
  const apiProxyChecked = activeProfileApiProxyEligible && (apiProxyLocked || activeProfile.apiProxy)
  const apiProxyEnabled = apiProxyAvailable && activeProfileApiProxyEligible && apiProxyChecked
  const activeProfileBalance = getApiBalanceSnapshot(draft, activeProfile.id)
  const activeProfileBalanceText = activeProfileBalance?.text ?? ''
  const activeProfileBalanceUpdatedAt = activeProfileBalance?.updatedAt
  const defaultProviderOrder = ['openai', 'fal', ...draft.customProviders.map(p => p.id)]
  const providerOrder = draft.providerOrder || defaultProviderOrder

  const unorderedProviderOptions = [
    { label: 'OpenAI 兼容接口', value: 'openai', draggable: true },
    { label: 'fal.ai', value: 'fal', draggable: true },
    ...draft.customProviders.map((provider) => ({
      label: provider.name,
      value: provider.id,
      draggable: true,
      actions: [
        { label: '编辑', onClick: () => openEditCustomProvider(provider) },
        {
          label: '删除',
          variant: 'danger' as const,
          onClick: () => confirmDeleteCustomProvider(provider),
        },
      ],
    })),
  ]

  const providerOptions = [
    { label: '创建自定义服务商', value: ADD_CUSTOM_PROVIDER_VALUE, variant: 'action' as const },
    ...unorderedProviderOptions.sort((a, b) => {
      const aIndex = providerOrder.indexOf(String(a.value))
      const bIndex = providerOrder.indexOf(String(b.value))
      const validA = aIndex !== -1 ? aIndex : defaultProviderOrder.indexOf(String(a.value))
      const validB = bIndex !== -1 ? bIndex : defaultProviderOrder.indexOf(String(b.value))
      return validA - validB
    })
  ]

  const getDefaultModelForMode = (apiMode: AppSettings['apiMode']) =>
    apiMode === 'responses' ? DEFAULT_RESPONSES_MODEL : DEFAULT_IMAGES_MODEL

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
    const nextDraft = normalizeSettings({
      ...displaySettings,
      profiles: displaySettings.profiles.map((profile) => ({
        ...profile,
        apiProxy: isProfileApiProxyEligible(displaySettings, profile) && apiProxyAvailable
          ? (apiProxyLocked || profile.apiProxy)
          : false,
      })),
    })
    setDraft(nextDraft)
    setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
  }, [apiProxyAvailable, apiProxyLocked, showSettings, settings, reusedTaskApiProfileId])

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

  const updateProfileMenuMaxHeight = useCallback(() => {
    if (!profileMenuTriggerRef.current) return
    setProfileMenuMaxHeight(getDropdownMaxHeight(profileMenuTriggerRef.current))
  }, [])

  useEffect(() => {
    if (!showProfileMenu) return

    const handlePointerDown = (event: PointerEvent) => {
      if (profileMenuRef.current?.contains(event.target as Node)) return
      setShowProfileMenu(false)
    }

    updateProfileMenuMaxHeight()
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', updateProfileMenuMaxHeight)
    window.addEventListener('scroll', updateProfileMenuMaxHeight, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', updateProfileMenuMaxHeight)
      window.removeEventListener('scroll', updateProfileMenuMaxHeight, true)
    }
  }, [showProfileMenu, updateProfileMenuMaxHeight])

  useEffect(() => () => {
    if (profileImportUrlTooltipTimerRef.current != null) window.clearTimeout(profileImportUrlTooltipTimerRef.current)
    if (duplicateProfileTooltipTimerRef.current != null) window.clearTimeout(duplicateProfileTooltipTimerRef.current)
    if (llmPromptTooltipTimerRef.current != null) window.clearTimeout(llmPromptTooltipTimerRef.current)
  }, [])

  useEffect(() => {
    if (!profileTouchDragPreview) return

    const preventTouchScroll = (event: TouchEvent) => {
      event.preventDefault()
    }
    const listenerOptions = { passive: false, capture: true } as AddEventListenerOptions
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior

    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    window.addEventListener('touchmove', preventTouchScroll, listenerOptions)

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
      window.removeEventListener('touchmove', preventTouchScroll, listenerOptions)
    }
  }, [profileTouchDragPreview])

  const clearProfileImportUrlTooltipTimer = () => {
    if (profileImportUrlTooltipTimerRef.current != null) {
      window.clearTimeout(profileImportUrlTooltipTimerRef.current)
      profileImportUrlTooltipTimerRef.current = null
    }
  }

  const clearDuplicateProfileTooltipTimer = () => {
    if (duplicateProfileTooltipTimerRef.current != null) {
      window.clearTimeout(duplicateProfileTooltipTimerRef.current)
      duplicateProfileTooltipTimerRef.current = null
    }
  }

  const clearLlmPromptTooltipTimer = () => {
    if (llmPromptTooltipTimerRef.current != null) {
      window.clearTimeout(llmPromptTooltipTimerRef.current)
      llmPromptTooltipTimerRef.current = null
    }
  }

  const commitSettings = (nextDraft: AppSettings) => {
    const normalizedProfiles = nextDraft.profiles.map((profile) => {
      const nextApiProxy = isProfileApiProxyEligible(nextDraft, profile) && apiProxyAvailable ? (apiProxyLocked || profile.apiProxy) : false
      const shouldKeepEmptyBaseUrl = profile.provider !== 'fal' && nextApiProxy && !profile.baseUrl.trim()
      const normalizedBaseUrl = profile.provider === 'fal'
        ? profile.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_FAL_BASE_URL
        : shouldKeepEmptyBaseUrl ? '' : normalizeBaseUrl(profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl)
      const defaultModel = profile.provider === 'fal' ? DEFAULT_FAL_MODEL : getDefaultModelForMode(profile.apiMode)
      return {
        ...profile,
        name: profile.name.trim() || (profile.id === DEFAULT_OPENAI_PROFILE_ID ? '默认' : '新配置'),
        baseUrl: normalizedBaseUrl,
        model: profile.model.trim() || defaultModel,
        timeout: Number(profile.timeout) || DEFAULT_SETTINGS.timeout,
        apiProxy: nextApiProxy,
        codexCli: false,
        streamImages: profile.provider === 'openai' ? profile.streamImages : false,
        streamPartialImages: profile.provider === 'openai' ? normalizeStreamPartialImages(profile.streamPartialImages) : DEFAULT_STREAM_PARTIAL_IMAGES,
      }
    })
    const fallbackProfile = createDefaultOpenAIProfile({ id: newId('openai') })
    const normalizedDraft = normalizeSettings({
      ...nextDraft,
      profiles: normalizedProfiles.length ? normalizedProfiles : [fallbackProfile],
      activeProfileId: normalizedProfiles.some((profile) => profile.id === nextDraft.activeProfileId)
        ? nextDraft.activeProfileId
        : (normalizedProfiles[0]?.id ?? fallbackProfile.id),
    })
    setDraft(normalizedDraft)
    setSettings(normalizedDraft)
  }

  const updateCopyImportUrlOptions = (patch: Partial<CopyImportUrlOptions>) => {
    setCopyImportUrlOptions((previous) => {
      const next = { ...previous, ...patch, includeApiKey: false }
      saveCopyImportUrlOptions(next)
      return next
    })
  }

  const createProfileImportUrl = (profile: ApiProfile, options: CopyImportUrlOptions) => {
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''

    if (profile.provider === 'openai') {
      const baseUrl = profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl
      url.searchParams.set('apiUrl', options.useNewApiAddress && !options.includeApiKey ? '{address}' : normalizeBaseUrl(baseUrl))
      if (options.includeApiKey && profile.apiKey.trim()) {
        url.searchParams.set('apiKey', profile.apiKey.trim())
      } else if (!options.includeApiKey && options.useNewApiKey) {
        url.searchParams.set('apiKey', '{key}')
      }
      url.searchParams.set('apiMode', profile.apiMode)
      const model = profile.model.trim() || getDefaultModelForMode(profile.apiMode)
      url.searchParams.set('model', !options.includeApiKey && options.useNewApiModel ? '{model}' : model)
      if (profile.codexCli) url.searchParams.set('codexCli', 'true')
      if (profile.streamImages !== DEFAULT_SETTINGS.streamImages) url.searchParams.set('streamImages', String(Boolean(profile.streamImages)))
      if (profile.streamPartialImages !== DEFAULT_STREAM_PARTIAL_IMAGES) url.searchParams.set('streamPartialImages', String(normalizeStreamPartialImages(profile.streamPartialImages)))

      let result = url.toString()
      if (!options.includeApiKey) {
        if (options.useNewApiAddress) result = result.replace('%7Baddress%7D', '{address}')
        if (options.useNewApiKey) result = result.replace('%7Bkey%7D', '{key}')
        if (options.useNewApiModel) result = result.replace('%7Bmodel%7D', '{model}')
      }
      return result
    }

    const provider = draft.customProviders.find((item) => item.id === profile.provider)
    const importProfile: ApiProfile = {
      ...profile,
      apiKey: options.includeApiKey ? profile.apiKey : '',
    }
    if (!options.includeApiKey) {
      if (options.useNewApiAddress) importProfile.baseUrl = '{address}'
      if (options.useNewApiKey) importProfile.apiKey = '{key}'
      if (options.useNewApiModel) importProfile.model = '{model}'
    }
    url.searchParams.set('settings', JSON.stringify({
      customProviders: provider ? [provider] : [],
      profiles: [importProfile],
    }))

    let result = url.toString()
    if (!options.includeApiKey) {
      if (options.useNewApiAddress) result = result.replace(/%7Baddress%7D/g, '{address}')
      if (options.useNewApiKey) result = result.replace(/%7Bkey%7D/g, '{key}')
      if (options.useNewApiModel) result = result.replace(/%7Bmodel%7D/g, '{model}')
    }
    return result
  }

  const copyProfileImportUrl = async (profile: ApiProfile, options: CopyImportUrlOptions) => {
    try {
      await copyTextToClipboard(createProfileImportUrl(profile, options))
      showToast(options.includeApiKey ? '导入 URL 已复制（包含 API Key）' : '导入 URL 已复制', 'success')
      setCopyImportUrlProfile(null)
    } catch (err) {
      showToast(getClipboardFailureMessage('复制导入 URL 失败', err), 'error')
    }
  }

  const confirmCopyProfileImportUrl = (profile: ApiProfile) => {
    setShowProfileMenu(false)
    setProfileImportUrlTooltipVisible(false)
    setCopyImportUrlProfile(profile)
    setCopyImportUrlOptions(readCopyImportUrlOptions())
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
  usePreventBackgroundScroll(showSettings, showCustomProviderImport ? customProviderScrollBoundaryRef : settingsScrollBoundaryRef)

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
          setShowProfileMenu(false)
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
    setShowProfileMenu(false)
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

  const createNewProfile = () => {
    setReusedTaskApiProfile(null)
    const profile = createDefaultOpenAIProfile({ id: newId('openai'), name: '新配置' })
    const nextDraft = normalizeSettings({ 
        ...draft, 
        profiles: [...draft.profiles, profile],
        activeProfileId: profile.id
    })
    commitSettings(nextDraft)
    setShowProfileMenu(false)
  }

  const duplicateActiveProfile = () => {
    setReusedTaskApiProfile(null)
    setDuplicateProfileTooltipVisible(false)
    const profile: ApiProfile = {
      ...activeProfile,
      id: newId(activeProfile.provider === 'openai' ? 'openai' : 'profile'),
      name: `${activeProfile.name}（复制）`,
    }
    const nextDraft = normalizeSettings({
      ...draft,
      profiles: [...draft.profiles, profile],
      activeProfileId: profile.id,
    })
    commitSettings(nextDraft)
    setShowProfileMenu(false)
  }

  const switchProfile = (id: string) => {
    setReusedTaskApiProfile(null)
    const nextDraft = normalizeSettings({ ...draft, activeProfileId: id })
    commitSettings(nextDraft)
    setShowProfileMenu(false)
  }
  
  const handleProfileDragStart = (e: React.DragEvent, id: string) => {
    setDraggedProfileId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  const handleProfileDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const targetElement = e.currentTarget as HTMLElement
    const rect = targetElement.getBoundingClientRect()
    const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'

    if (dragOverProfileId !== targetId || dragDropPosition !== position) {
      setDragOverProfileId(targetId)
      setDragDropPosition(position)
    }

    const scrollContainer = targetElement.closest('.custom-scrollbar')
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect()
      const scrollThreshold = 30

      if (e.clientY < containerRect.top + scrollThreshold) {
        scrollContainer.scrollTop -= 10
      } else if (e.clientY > containerRect.bottom - scrollThreshold) {
        scrollContainer.scrollTop += 10
      }
    }
  }

  const handleProfileDragEnd = () => {
    setDraggedProfileId(null)
    setDragOverProfileId(null)
    setDragDropPosition(null)
    setProfileTouchDragPreview(null)
    profileTouchDragRef.current = null
  }

  const moveProfileToDropTarget = (sourceId: string, targetId: string, position: 'before' | 'after' | null) => {
    if (!sourceId || sourceId === targetId) return

    const sourceIndex = draft.profiles.findIndex((p) => p.id === sourceId)
    const targetIndex = draft.profiles.findIndex((p) => p.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return

    const newProfiles = [...draft.profiles]
    const [removed] = newProfiles.splice(sourceIndex, 1)

    let newTargetIndex = targetIndex
    if (position === 'after') newTargetIndex++
    if (sourceIndex < targetIndex) newTargetIndex--

    newProfiles.splice(newTargetIndex, 0, removed)

    const nextDraft = normalizeSettings({ ...draft, profiles: newProfiles })
    commitSettings(nextDraft)
  }

  const handleProfileDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    moveProfileToDropTarget(e.dataTransfer.getData('text/plain'), targetId, dragDropPosition)
    handleProfileDragEnd()
  }

  const handleProfileTouchStart = (e: React.TouchEvent, profile: ApiProfile) => {
    if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return
    const touch = e.touches[0]
    const rect = e.currentTarget.getBoundingClientRect()

    e.preventDefault()
    e.stopPropagation()
    profileTouchDragRef.current = { id: profile.id, startX: touch.clientX, startY: touch.clientY, moved: false }
    setDraggedProfileId(profile.id)
    setProfileTouchDragPreview({
      label: profile.name,
      providerLabel: getApiProviderLabel(draft, profile.provider),
      x: touch.clientX,
      y: touch.clientY,
      width: rect.width,
      height: rect.height,
      offsetX: touch.clientX - rect.left,
      offsetY: touch.clientY - rect.top,
    })
  }

  const handleProfileTouchMove = (e: React.TouchEvent) => {
    const drag = profileTouchDragRef.current
    if (!drag) return
    const touch = e.touches[0]

    if (!drag.moved) {
      if (Math.abs(touch.clientX - drag.startX) > 5 || Math.abs(touch.clientY - drag.startY) > 5) {
        drag.moved = true
      } else {
        return
      }
    }

    e.preventDefault()
    setProfileTouchDragPreview((current) => current ? { ...current, x: touch.clientX, y: touch.clientY } : current)

    const el = document.elementFromPoint(touch.clientX, touch.clientY)
    const targetElement = el?.closest('[data-profile-id]') as HTMLElement | null
    if (!targetElement) return

    const targetId = targetElement.getAttribute('data-profile-id')
    if (!targetId) return

    const rect = targetElement.getBoundingClientRect()
    const position = touch.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDragOverProfileId(targetId)
    setDragDropPosition(position)

    const scrollContainer = targetElement.closest('.custom-scrollbar') as HTMLElement | null
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect()
      const scrollThreshold = 30
      if (touch.clientY < containerRect.top + scrollThreshold) {
        scrollContainer.scrollTop -= 10
      } else if (touch.clientY > containerRect.bottom - scrollThreshold) {
        scrollContainer.scrollTop += 10
      }
    }
  }

  const handleProfileTouchEnd = (e: React.TouchEvent) => {
    const drag = profileTouchDragRef.current
    if (!drag) return
    if (drag.moved && dragOverProfileId && dragOverProfileId !== drag.id) {
      e.preventDefault()
      moveProfileToDropTarget(drag.id, dragOverProfileId, dragDropPosition)
    }
    handleProfileDragEnd()
  }

  const deleteProfile = (id: string) => {
    if (draft.profiles.length <= 1) return
    if (id === reusedTaskApiProfileId) setReusedTaskApiProfile(null)
    const nextProfiles = draft.profiles.filter((item) => item.id !== id)
    const nextDraft = normalizeSettings({
      ...draft,
      profiles: nextProfiles,
      activeProfileId: draft.activeProfileId === id ? nextProfiles[0].id : draft.activeProfileId,
    })
    commitSettings(nextDraft)
  }

  const handleProviderReorder = (sourceValue: string | number, targetValue: string | number, position: 'before' | 'after' | null) => {
    const currentOrder = draft.providerOrder || ['openai', 'fal', ...draft.customProviders.map(p => p.id)]
    const sourceIndex = currentOrder.indexOf(String(sourceValue))
    const targetIndex = currentOrder.indexOf(String(targetValue))
    if (sourceIndex < 0 || targetIndex < 0) return

    const newOrder = [...currentOrder]
    const [removed] = newOrder.splice(sourceIndex, 1)

    let newTargetIndex = targetIndex
    if (position === 'after') newTargetIndex++
    if (sourceIndex < targetIndex) newTargetIndex--

    newOrder.splice(newTargetIndex, 0, removed)

    const nextDraft = normalizeSettings({ ...draft, providerOrder: newOrder })
    commitSettings(nextDraft)
  }

  const handleProviderTypeChange = (value: string | number) => {
    if (value === ADD_CUSTOM_PROVIDER_VALUE) {
      setEditingCustomProviderId(null)
      setCustomProviderForm(createDefaultCustomProviderForm())
      setShowCustomProviderImport(true)
      setCustomProviderImportError(null)
      return
    }

    const provider = String(value) as ApiProfile['provider']
    const customProvider = draft.customProviders.find((item) => item.id === provider)
    updateActiveProfile(switchApiProfileProvider(activeProfile, provider, customProvider), true)
  }

  const updateCustomProviderForm = (patch: Partial<CustomProviderForm>) => {
    setCustomProviderForm((current) => ({ ...current, ...patch }))
    setCustomProviderImportError(null)
  }

  const buildCustomProviderFromForm = () => {
    const input = customProviderFormToInput(customProviderForm)
    const usedIds = new Set(
      draft.customProviders
        .filter((item) => item.id !== editingCustomProviderId)
        .map((item) => item.id),
    )
    const provider = normalizeCustomProviderDefinition(
      editingCustomProviderId && input && typeof input === 'object'
        ? { ...input, id: editingCustomProviderId }
        : input,
      usedIds,
    )
    if (!provider) throw new Error('自定义服务商配置无效')
    return provider
  }

  function openEditCustomProvider(provider: CustomProviderDefinition) {
    setEditingCustomProviderId(provider.id)
    setCustomProviderForm(customProviderToForm(provider))
    setShowCustomProviderImport(true)
    setCustomProviderImportError(null)
  }

  const saveCustomProvider = () => {
    try {
      const customProvider = buildCustomProviderFromForm()
      if (editingCustomProviderId) {
        const nextDraft = normalizeSettings({
          ...draft,
          customProviders: draft.customProviders.map((provider) =>
            provider.id === editingCustomProviderId ? customProvider : provider,
          ),
        })
        commitSettings(nextDraft)
        setShowCustomProviderImport(false)
        setEditingCustomProviderId(null)
        setCustomProviderImportError(null)
        showToast('服务商配置已更新', 'success')
        return
      }

      const nextProfile = switchApiProfileProvider(activeProfile, customProvider.id, customProvider)
      const nextDraft = normalizeSettings({
        ...draft,
        customProviders: [...draft.customProviders, customProvider],
        profiles: draft.profiles.map((profile) => profile.id === activeProfile.id ? nextProfile : profile),
      })
      commitSettings(nextDraft)
      setShowCustomProviderImport(false)
      setEditingCustomProviderId(null)
      setCustomProviderImportError(null)
    } catch (err) {
      setCustomProviderImportError(err instanceof Error ? err.message : String(err))
    }
  }

  function confirmDeleteCustomProvider(provider: CustomProviderDefinition) {
    setConfirmDialog({
      title: '删除服务商',
      message: `确定要删除自定义服务商「${provider.name}」吗？正在使用它的配置会切回 OpenAI 兼容接口。`,
      action: () => deleteCustomProvider(provider),
    })
  }

  function deleteCustomProvider(provider: CustomProviderDefinition) {
    const providerId = provider.id
    const nextDraft = normalizeSettings({
      ...draft,
      customProviders: draft.customProviders.filter((provider) => provider.id !== providerId),
      profiles: draft.profiles.map((profile) =>
        profile.provider === providerId ? switchApiProfileProvider(profile, 'openai') : profile,
      ),
    })
    commitSettings(nextDraft)
    showToast('服务商已删除', 'success')
  }

  const copyCustomProviderLlmPrompt = async () => {
    try {
      await copyTextToClipboard(CUSTOM_PROVIDER_LLM_PROMPT)
      showToast('LLM 生成提示词已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制 LLM 生成提示词失败', err), 'error')
    }
  }

  const handleCustomProviderJsonPaste = async () => {
    setIsImportingJson(true)
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        throw new Error('剪贴板为空')
      }
      const imported = importCustomProviderSettingsFromJson(text, draft.customProviders)
      if (imported.profiles.length > 0) {
        const previousProfileIds = new Set(draft.profiles.map((profile) => profile.id))
        const mergedDraft = mergeImportedSettings(draft, imported)
        const importedProfile = getImportedProfileFromMergedSettings(mergedDraft, previousProfileIds, imported)
        const importedProfileAlreadyExisted = previousProfileIds.has(importedProfile.id)
        const shouldReplaceActiveProfile = !editingCustomProviderId && isPristineNewOpenAIProfile(activeProfile) && !importedProfileAlreadyExisted
        const switchedToExistingProfile = !shouldReplaceActiveProfile && importedProfileAlreadyExisted
        const nextDraft = shouldReplaceActiveProfile
          ? normalizeSettings({
              ...mergedDraft,
              profiles: mergedDraft.profiles
                .filter((profile) => profile.id === activeProfile.id || profile.id !== importedProfile.id)
                .map((profile) => profile.id === activeProfile.id ? { ...importedProfile, id: activeProfile.id } : profile),
              activeProfileId: activeProfile.id,
            })
          : normalizeSettings({
              ...mergedDraft,
              activeProfileId: importedProfile.id,
            })
        setDraft(nextDraft)
        setSettings(nextDraft)
        setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
        setShowCustomProviderImport(false)
        setEditingCustomProviderId(null)
        setCustomProviderImportError(null)
        showToast(shouldReplaceActiveProfile ? '已覆盖当前空配置' : switchedToExistingProfile ? '已存在相同配置，已切换到已有配置' : 'JSON 配置已导入并切换', 'success')
        return
      }

      const provider = imported.customProviders[0]
      setCustomProviderForm(customProviderToForm(provider))
      setCustomProviderImportError(null)
      showToast('JSON 配置已导入', 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setCustomProviderImportError(null)
      if (err instanceof Error && err.name === 'NotAllowedError') {
        showToast('无法读取剪贴板，请允许浏览器访问剪贴板，或直接粘贴到输入框中', 'error')
      } else {
        showToast(msg, 'error')
      }
    } finally {
      setIsImportingJson(false)
    }
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

  const copyActiveProfileUrl = async () => {
    try {
      await copyTextToClipboard(activeProfile.baseUrl)
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
    const setLoading = isText ? setIsFetchingTextModels : setIsFetchingVideoModels
    const setOptions = isText ? setTextModelOptions : setVideoModelOptions
    const currentModel = isText ? draft.textModel : draft.videoModel

    if (!baseUrl.trim()) {
      showToast(`请先填写${isText ? '文字' : '视频'} API URL`, 'error')
      return
    }

    setLoading(true)
    try {
      const response = await fetch(buildApiUrl(baseUrl, 'models'), {
        headers: apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined,
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => null) as { data?: unknown, error?: { message?: string }, msg?: string } | null
      if (!response.ok) throw new Error(payload?.error?.message || payload?.msg || `读取模型失败：${response.status}`)

      const models = parseModelListPayload(payload)

      if (models.length === 0) throw new Error('接口没有返回模型列表')
      setOptions(models)

      if (!currentModel.trim()) {
        const patch = isText ? { textModel: models[0] } : { videoModel: models[0] }
        commitSettings({ ...draft, ...patch })
      }
      showToast(`已获取 ${models.length} 个模型`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '读取模型失败', 'error')
    } finally {
      setLoading(false)
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
              </div>
            )}

            {activeTab === 'api' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-500/15 dark:bg-blue-500/[0.08]">
                  <h4 className="text-sm font-bold text-blue-700 dark:text-blue-300">出图 API 配置</h4>
                  <p data-selectable-text className="mt-1 text-xs leading-relaxed text-blue-600/80 dark:text-blue-200/70">
                    用于文运工坊和画布工坊的图片生成、图片编辑请求。
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

                <div className="hidden">
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">当前配置</span>
                    <span className="relative inline-flex">
                      <button
                        type="button"
                        onClick={() => confirmCopyProfileImportUrl(activeProfile)}
                        onMouseEnter={() => setProfileImportUrlTooltipVisible(true)}
                        onMouseLeave={() => setProfileImportUrlTooltipVisible(false)}
                        onFocus={() => setProfileImportUrlTooltipVisible(true)}
                        onBlur={() => setProfileImportUrlTooltipVisible(false)}
                        onTouchStart={() => {
                          clearProfileImportUrlTooltipTimer()
                          profileImportUrlTooltipTimerRef.current = window.setTimeout(() => {
                            setProfileImportUrlTooltipVisible(true)
                            profileImportUrlTooltipTimerRef.current = null
                          }, 450)
                        }}
                        onTouchEnd={clearProfileImportUrlTooltipTimer}
                        onTouchCancel={clearProfileImportUrlTooltipTimer}
                        className="flex h-5 w-5 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
                        aria-label={`复制导入配置「${activeProfile.name}」的 URL`}
                      >
                        <LinkIcon className="h-3.5 w-3.5" />
                      </button>
                      <ViewportTooltip visible={profileImportUrlTooltipVisible} className="whitespace-nowrap">
                        复制导入 URL
                      </ViewportTooltip>
                    </span>
                    <span className="relative inline-flex">
                      <button
                        type="button"
                        onClick={duplicateActiveProfile}
                        onMouseEnter={() => setDuplicateProfileTooltipVisible(true)}
                        onMouseLeave={() => setDuplicateProfileTooltipVisible(false)}
                        onFocus={() => setDuplicateProfileTooltipVisible(true)}
                        onBlur={() => setDuplicateProfileTooltipVisible(false)}
                        onTouchStart={() => {
                          clearDuplicateProfileTooltipTimer()
                          duplicateProfileTooltipTimerRef.current = window.setTimeout(() => {
                            setDuplicateProfileTooltipVisible(true)
                            duplicateProfileTooltipTimerRef.current = null
                          }, 450)
                        }}
                        onTouchEnd={clearDuplicateProfileTooltipTimer}
                        onTouchCancel={clearDuplicateProfileTooltipTimer}
                        className="flex h-5 w-5 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
                        aria-label={`复制一份配置「${activeProfile.name}」`}
                      >
                        <CopyIcon className="h-3.5 w-3.5" />
                      </button>
                      <ViewportTooltip visible={duplicateProfileTooltipVisible} className="whitespace-nowrap">
                        复制当前配置
                      </ViewportTooltip>
                    </span>
                  </div>
                  <div ref={profileMenuRef} className="relative">
                    <button
                      ref={profileMenuTriggerRef}
                      type="button"
                      onClick={() => {
                        if (!showProfileMenu) updateProfileMenuMaxHeight()
                        setShowProfileMenu(!showProfileMenu)
                      }}
                      className="flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06]"
                      title={activeProfile.name}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate">{activeProfile.name}</span>
                        <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                          {getApiProviderLabel(draft, activeProfile.provider)}
                        </span>
                      </span>
                      <ChevronDownIcon className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${showProfileMenu ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {showProfileMenu && (
                      <>
                        <div
                          className="absolute right-0 top-full z-50 mt-1.5 w-full overflow-hidden overflow-y-auto rounded-xl border border-gray-200/60 bg-white/95 py-1 shadow-[0_8px_30px_rgb(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur-xl animate-dropdown-down dark:border-white/[0.08] dark:bg-gray-900/95 dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] dark:ring-white/10 custom-scrollbar"
                          style={{ maxHeight: profileMenuMaxHeight }}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              createNewProfile()
                            }}
                            className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
                          >
                            <span className="truncate font-semibold">创建新配置</span>
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                              <PlusIcon className="h-4 w-4" />
                            </span>
                          </button>
                          <div>
                            {draft.profiles.map(profile => (
                              <div
                                key={profile.id}
                                data-profile-id={profile.id}
                                title={profile.name}
                                draggable
                                onDragStart={(e) => handleProfileDragStart(e, profile.id)}
                                onDragOver={(e) => handleProfileDragOver(e, profile.id)}
                                onDrop={(e) => handleProfileDrop(e, profile.id)}
                                onDragEnd={handleProfileDragEnd}
                                onTouchStart={(e) => handleProfileTouchStart(e, profile)}
                                onTouchMove={handleProfileTouchMove}
                                onTouchEnd={handleProfileTouchEnd}
                                onTouchCancel={handleProfileDragEnd}
                                onClick={(e) => {
                                  // Don't switch profile if they are clicking the drag handle
                                  if ((e.target as HTMLElement).closest('[data-drag-handle]')) return
                                  e.preventDefault()
                                  switchProfile(profile.id)
                                }}
                                className={`relative group flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-xs transition-colors ${draggedProfileId === profile.id ? 'opacity-40 bg-gray-100 dark:bg-white/[0.04]' : profile.id === activeProfile.id ? 'bg-blue-50 font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'}`}
                              >
                                {dragOverProfileId === profile.id && dragDropPosition === 'before' && draggedProfileId !== profile.id && (
                                  <div className="absolute -top-[1px] left-0 right-0 h-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
                                )}
                                {dragOverProfileId === profile.id && dragDropPosition === 'after' && draggedProfileId !== profile.id && (
                                  <div className="absolute -bottom-[1px] left-0 right-0 h-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
                                )}
                                <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
                                  <div
                                    data-drag-handle
                                    className="flex cursor-grab active:cursor-grabbing items-center justify-center text-gray-400 opacity-60 transition-opacity hover:opacity-100 dark:text-gray-500"
                                    style={{ touchAction: 'none' }}
                                    title="拖拽排序"
                                  >
                                    <DragHandleIcon className="h-3.5 w-3.5" />
                                  </div>
                                  <span className="min-w-0 truncate">{profile.name}</span>
                                  <span className={`rounded px-1.5 py-0.5 text-[10px] shrink-0 ${profile.id === activeProfile.id ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-white/[0.08] dark:text-gray-400'}`}>
                                    {getApiProviderLabel(draft, profile.provider)}
                                  </span>
                                </div>
                                
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      confirmCopyProfileImportUrl(profile)
                                    }}
                                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 opacity-60 transition-all hover:bg-gray-100 hover:text-gray-600 hover:opacity-100 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
                                    aria-label={`复制导入配置「${profile.name}」的 URL`}
                                    title="复制导入 URL"
                                  >
                                    <LinkIcon className="h-3.5 w-3.5" />
                                  </button>
                                  {draft.profiles.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        setConfirmDialog({
                                          title: '删除配置',
                                          message: `确定要删除配置「${profile.name}」吗？`,
                                          action: () => deleteProfile(profile.id)
                                        })
                                      }}
                                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 opacity-60 transition-all hover:bg-red-50 hover:text-red-500 hover:opacity-100 dark:hover:bg-red-500/10"
                                      aria-label="删除配置"
                                    >
                                      <TrashIcon className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

              {/* 1. 配置名称 */}
              <label className="hidden">
                <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">配置名称</span>
                <input
                  value={activeProfile.name}
                  onChange={(e) => updateActiveProfile({ name: e.target.value })}
                  onBlur={(e) => commitActiveProfilePatch({ name: e.target.value })}
                  type="text"
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
              </label>

              {/* 2. 服务商类型 */}
              <div className="hidden">
                <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">服务商类型</span>
                <Select
                  value={activeProfile.provider}
                  onChange={handleProviderTypeChange}
                  onReorder={handleProviderReorder}
                  options={providerOptions}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
              </div>

              {/* 3. API URL */}
              {activeProviderUsesApiUrl && (
                <label className="block">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">API URL</span>
                    <button
                      type="button"
                      onClick={copyActiveProfileUrl}
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
                  <div data-selectable-text className="mt-1.5 min-h-[22px] flex items-center text-xs text-gray-500 dark:text-gray-500">
                    固定接口地址，可选中复制。
                  </div>
                </label>
              )}

              {/* 4. API 代理（紧跟 URL） */}
              {apiProxyAvailable && activeProviderIsOpenAICompatible && !activeCustomProviderAsync && (
                <div className="hidden">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">API 代理</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (!apiProxyLocked) updateActiveProfile({ apiProxy: !activeProfile.apiProxy }, true)
                      }}
                      disabled={apiProxyLocked}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${apiProxyChecked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'} ${apiProxyLocked ? 'cursor-not-allowed opacity-70' : ''}`}
                      role="switch"
                      aria-checked={apiProxyChecked}
                      aria-label="API 代理"
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${apiProxyChecked ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                    </button>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                    {apiProxyLocked ? '部署端已锁定代理开启，请求经服务器转发到上游 API，上方 URL 设置将失效。' : '开启后请求经服务器转发到上游 API，可绕过浏览器跨域限制，上方 URL 设置将失效。'}
                  </div>
                </div>
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



              {/* 6. API 接口（Images/Responses） */}
              {activeProfile.provider === 'openai' && (
                <div className="hidden">
                  <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">API 接口</span>
                  <Select
                    value={activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode}
                    onChange={(value) => {
                      const apiMode = value as AppSettings['apiMode']
                      const nextModel =
                        activeProfile.model === DEFAULT_IMAGES_MODEL || activeProfile.model === DEFAULT_RESPONSES_MODEL
                          ? getDefaultModelForMode(apiMode)
                          : activeProfile.model
                      updateActiveProfile({ apiMode, model: nextModel }, true)
                    }}
                    options={[
                      { label: 'Images API (/v1/images)', value: 'images' },
                      { label: 'Responses API (/v1/responses)', value: 'responses' },
                    ]}
                    className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                  />
                  <div data-selectable-text className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">
                    支持通过查询参数覆盖：<code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">apiMode=images</code> 或 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">apiMode=responses</code>。
                  </div>
                </div>
              )}

              {/* 7. 模型 ID（紧跟接口选择） */}
              <label className="hidden">
                <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">
                  模型 ID
                </span>
                <input
                  value={activeProfile.model}
                  onChange={(e) => updateActiveProfile({ model: e.target.value })}
                  onBlur={(e) => commitActiveProfilePatch({ model: e.target.value })}
                  type="text"
                  placeholder={activeProfile.provider === 'fal' ? DEFAULT_FAL_MODEL : getDefaultModelForMode(activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode)}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
                <div data-selectable-text className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">
                  {activeProfile.provider === 'fal' ? (
                    <>当前适配 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_FAL_MODEL}</code>。</>
                  ) : activeCustomProvider ? (
                    <>当前使用 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{activeCustomProvider.name}</code>。</>
                  ) : (activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode) === 'responses' ? (
                    <>Responses API 需要使用支持 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">image_generation</code> 工具的文本模型，例如 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_RESPONSES_MODEL}</code>。</>
                  ) : (
                    <>Images API 需要使用 GPT Image 模型，例如 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_IMAGES_MODEL}</code>。</>
                  )}
                  {activeProfile.provider === 'openai' && (
                    <>支持通过查询参数覆盖：<code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">?model=</code>。</>
                  )}
                </div>
              </label>

              {/* 8. 流式传输 + 中间步骤图像数 */}
              {activeProfile.provider === 'openai' && (
                <div className="hidden space-y-3">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="block text-sm text-gray-600 dark:text-gray-300">流式传输</span>
                      <button
                        type="button"
                        onClick={() => updateActiveProfile({ streamImages: !activeProfile.streamImages }, true)}
                        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${activeProfile.streamImages ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                        role="switch"
                        aria-checked={!!activeProfile.streamImages}
                        aria-label="流式传输"
                      >
                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${activeProfile.streamImages ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                      </button>
                    </div>
                    <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                      开启后请求以流式传输，并非所有服务商和网关都支持此功能。官方接口在流式模式下不发送心跳，需要配合请求中间步骤图像来维持连接，避免超时断开。官方接口仅支持单图流式传输，因此数量大于 1 时会将多图生成拆分为并发单图。
                    </div>
                  </div>
                  <label className={`block ${activeProfile.streamImages ? '' : 'opacity-60'}`}>
                    <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">请求中间步骤图像数</span>
                    <Select
                      value={normalizeStreamPartialImages(activeProfile.streamPartialImages)}
                      onChange={(value) => updateActiveProfile({ streamPartialImages: normalizeStreamPartialImages(value) }, true)}
                      disabled={!activeProfile.streamImages}
                      options={[
                        { label: '0，不请求', value: 0 },
                        { label: '1 张', value: 1 },
                        { label: '2 张', value: 2 },
                        { label: '3 张', value: 3 },
                      ]}
                      className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                    />
                    <div data-selectable-text className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">
                      对应 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">partial_images</code> 参数（0-3）。建议设为 2 或 3 以避免长时间生成时连接超时断开。实际返回的每张中间图像会产生少量额外计费。设为 0 时不请求中间步骤图像，连接可能因无数据传输而被断开。
                    </div>
                  </label>
                </div>
              )}

              {/* 9. 返回 Base64 图片数据 */}
              {activeProviderIsOpenAICompatible && (
                <div className="hidden">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">返回 Base64 图片数据</span>
                    <button
                      type="button"
                      onClick={() => updateActiveProfile({ responseFormatB64Json: !activeProfile.responseFormatB64Json }, true)}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${activeProfile.responseFormatB64Json ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      role="switch"
                      aria-checked={!!activeProfile.responseFormatB64Json}
                      aria-label="返回 Base64 图片数据"
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${activeProfile.responseFormatB64Json ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                    </button>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                    开启后在请求体中追加 <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">response_format: b64_json</code>，使接口直接返回 Base64 编码的图片数据而非 URL。并非所有服务商和网关都支持此功能。
                  </div>
                </div>
              )}

              {/* 10. Codex CLI 兼容模式 */}
              {activeProfile.provider === 'openai' && (
                <div className="hidden">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">Codex CLI 兼容模式</span>
                    <button
                      type="button"
                      onClick={() => updateActiveProfile({ codexCli: !activeProfile.codexCli }, true)}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${activeProfile.codexCli ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      role="switch"
                      aria-checked={activeProfile.codexCli}
                      aria-label="Codex CLI 兼容模式"
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${activeProfile.codexCli ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                    </button>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                    开启后应用 Codex CLI 实际支持的参数。支持查询参数覆盖：<code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">codexCli=true</code>。
                  </div>
                </div>
              )}

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
                <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-500/15 dark:bg-blue-500/[0.08]">
                  <h4 className="text-sm font-bold text-blue-700 dark:text-blue-300">文字 API 配置</h4>
                  <p data-selectable-text className="mt-1 text-xs leading-relaxed text-blue-600/80 dark:text-blue-200/70">
                    用于画布工坊里的文字问答和节点说明，和出图接口完全分开。
                  </p>
                </div>
                <ExternalApiConfigSection
                  idPrefix="text-api"
                  title="文字 API 配置"
                  description="用于画布工坊里的文字问答和节点说明，和出图接口完全分开。"
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

            {activeTab === 'videoApi' && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-500/15 dark:bg-blue-500/[0.08]">
                  <h4 className="text-sm font-bold text-blue-700 dark:text-blue-300">视频 API 配置</h4>
                  <p data-selectable-text className="mt-1 text-xs leading-relaxed text-blue-600/80 dark:text-blue-200/70">
                    用于画布工坊里的视频生成。URL 固定为 {CANVAS_VIDEO_BASE_URL}，模型从文档支持列表中选择。
                  </p>
                </div>
                <ExternalApiConfigSection
                  idPrefix="video-api"
                  title="视频 API 配置"
                  description={`用于画布工坊里的视频生成，URL 固定为 ${CANVAS_VIDEO_BASE_URL}，超时固定为 ${CANVAS_VIDEO_TIMEOUT} 秒。`}
                  baseUrl={CANVAS_VIDEO_BASE_URL}
                  apiKey={draft.videoApiKey}
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
                  onFetchModels={() => undefined}
                  fixedBaseUrl={CANVAS_VIDEO_BASE_URL}
                  fixedTimeout={CANVAS_VIDEO_TIMEOUT}
                  modelOptionsLocked
                />
              </div>
            )}
            
            {activeTab === 'appearance' && (
              <div className="space-y-5">
                <div className="block">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">当前背景</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={randomizeBackgroundFromApi}
                        disabled={isRandomizingBackground}
                        className="rounded-xl bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isRandomizingBackground ? '获取中...' : '随机'}
                      </button>
                      <button
                        type="button"
                        onClick={() => backgroundFileInputRef.current?.click()}
                        className="rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]"
                      >
                        上传
                      </button>
                      <button
                        type="button"
                        onClick={() => commitSettings({ ...draft, appearanceBackgroundImageUrl: '' })}
                        className="rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                  <input
                    value={draft.appearanceBackgroundImageUrl}
                    onChange={(e) => setDraft({ ...draft, appearanceBackgroundImageUrl: e.target.value })}
                    onBlur={(e) => commitSettings({ ...draft, appearanceBackgroundImageUrl: e.target.value })}
                    type="text"
                    placeholder="随机后自动填入，也可以手动粘贴图片地址"
                    className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                  />
                  <input
                    ref={backgroundFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleBackgroundUpload}
                  />
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
                    <img
                      src={draft.appearanceBackgroundImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
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
                          <Checkbox checked={cloudSync.uploadTasks} onChange={(checked) => updateCloudSync({ uploadTasks: checked })} label="文运生成记录和图片" />
                          <Checkbox checked={cloudSync.uploadCanvasProjects} onChange={(checked) => updateCloudSync({ uploadCanvasProjects: checked })} label={`画布工坊（${canvasProjects.length} 个）`} />
                          <Checkbox checked={cloudSync.uploadAssets} onChange={(checked) => updateCloudSync({ uploadAssets: checked })} label={`我的素材（${assets.length} 个）`} />
                        </div>
                        <div className="mt-2 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">手动上传和自动同步使用这个范围。</div>
                      </div>

                      <div className="rounded-xl border border-gray-100 bg-white/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.04]">
                        <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">拉取范围</div>
                        <div className="space-y-2">
                          <Checkbox checked={cloudSync.pullTasks} onChange={(checked) => updateCloudSync({ pullTasks: checked })} label="文运生成记录和图片" />
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
                      <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">文运工坊</div>
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
                      <Checkbox checked={importTasks} onChange={setImportTasks} label="文运生成记录和图片" />
                      <Checkbox checked={importCanvasProjects} onChange={setImportCanvasProjects} label="画布工坊" />
                      <Checkbox checked={importAssets} onChange={setImportAssets} label="我的素材" />
                    </div>
                    <div className="text-xs leading-relaxed text-gray-400 dark:text-gray-500">导入会合并到当前数据，不会覆盖已有画布和素材；旧版文运备份、单独画布包、单独素材包也可以在这里导入。</div>
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
                    <Checkbox checked={clearTasks} onChange={setClearTasks} label="文运生成记录和图片" tone="danger" />
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

        {showCustomProviderImport && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" onClick={() => {
              setShowCustomProviderImport(false)
              setEditingCustomProviderId(null)
            }} />
            <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 flex flex-col h-[85vh] sm:h-[680px] max-h-[90vh] overflow-hidden">
              <div className="mb-5 flex items-center justify-between gap-4 shrink-0">
                <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">
                  {editingCustomProviderId ? '编辑自定义服务商' : '创建自定义服务商'}
                </h3>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomProviderImport(false)
                      setEditingCustomProviderId(null)
                    }}
                    className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                    aria-label="关闭"
                  >
                    <CloseIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div ref={customProviderScrollBoundaryRef} className="flex-1 flex flex-col min-h-0 px-1 -mx-1 pb-2">
                <div className="mb-6 shrink-0 rounded-2xl bg-gray-50/80 p-4 border border-gray-200/60 dark:bg-white/[0.02] dark:border-white/[0.05]">
                  <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-800 dark:text-gray-200">
                    <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    AI 一键生成与导入
                  </div>
                  <div data-selectable-text className="mb-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                    复制提示词发给 LLM，可根据 API 文档自动生成完整的配置（包含服务商、模型、URL 等）。复制 LLM 输出的 JSON 后，点击“从剪贴板粘贴并导入”即可一键生效。
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="relative inline-flex">
                      <button
                        type="button"
                        onClick={copyCustomProviderLlmPrompt}
                        aria-label="复制用于生成完整导入 JSON 的 LLM 提示词"
                        onMouseEnter={() => setLlmPromptTooltipVisible(true)}
                        onMouseLeave={() => setLlmPromptTooltipVisible(false)}
                        onFocus={() => setLlmPromptTooltipVisible(true)}
                        onBlur={() => setLlmPromptTooltipVisible(false)}
                        onTouchStart={() => {
                          clearLlmPromptTooltipTimer()
                          llmPromptTooltipTimerRef.current = window.setTimeout(() => {
                            setLlmPromptTooltipVisible(true)
                            llmPromptTooltipTimerRef.current = null
                          }, 450)
                        }}
                        onTouchEnd={clearLlmPromptTooltipTimer}
                        onTouchCancel={clearLlmPromptTooltipTimer}
                        className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm border border-gray-200/80 transition hover:bg-gray-50 hover:text-gray-900 dark:bg-white/[0.05] dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                      >
                        <LinkIcon className="h-3.5 w-3.5" />
                        复制生成提示词
                      </button>
                      <ViewportTooltip visible={llmPromptTooltipVisible} className="w-56 whitespace-normal text-center">
                        生成完整的服务商和配置信息，包含模型和接口地址，导入后只需填入 API Key。
                      </ViewportTooltip>
                    </span>
                    <button
                      type="button"
                      onClick={handleCustomProviderJsonPaste}
                      disabled={isImportingJson}
                      className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm border border-gray-200/80 transition hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-white/[0.05] dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                    >
                    {isImportingJson ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        导入中...
                      </>
                    ) : (
                      '从剪贴板粘贴并导入'
                    )}
                  </button>
                </div>
              </div>

              <div className="flex-1 flex flex-col min-h-0">
                <label className="flex-1 flex flex-col min-h-0">
                  <span className="mb-1 shrink-0 block text-xs text-gray-500 dark:text-gray-400">手动编辑 (仅接口映射 Manifest)</span>
                  <textarea
                    value={customProviderForm.json}
                    onChange={(e) => updateCustomProviderForm({ json: e.target.value })}
                    spellCheck={false}
                    className="flex-1 min-h-[150px] w-full resize-none rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 font-mono text-xs leading-relaxed text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50 custom-scrollbar"
                  />
                </label>
              </div>

                {customProviderImportError && (
                  <div data-selectable-text className="shrink-0 mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-500 dark:bg-red-500/10 dark:text-red-300">
                    {customProviderImportError}
                  </div>
                )}
              </div>
              <div className="mt-4 flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowCustomProviderImport(false)
                    setEditingCustomProviderId(null)
                  }}
                  className="rounded-xl bg-gray-100 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveCustomProvider}
                  className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600"
                >
                  {editingCustomProviderId ? '保存修改' : '创建并使用'}
                </button>
              </div>
            </div>
          </div>
          , document.body)}
        {profileTouchDragPreview && createPortal(
          <div
            className="fixed pointer-events-none z-[110] flex items-center justify-between gap-2 rounded-xl bg-white/95 px-3 py-2 text-xs text-gray-700 shadow-xl ring-1 ring-black/5 backdrop-blur-xl dark:bg-gray-900/95 dark:text-gray-300 dark:ring-white/10"
            style={{
              left: profileTouchDragPreview.x - profileTouchDragPreview.offsetX,
              top: profileTouchDragPreview.y - profileTouchDragPreview.offsetY,
              width: profileTouchDragPreview.width,
              minHeight: profileTouchDragPreview.height,
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
              <DragHandleIcon className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500" />
              <span className="min-w-0 truncate">{profileTouchDragPreview.label}</span>
              <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-white/[0.08] dark:text-gray-400">
                {profileTouchDragPreview.providerLabel}
              </span>
            </div>
          </div>,
          document.body,
        )}
        {copyImportUrlProfile && createPortal(
          <div
            data-no-drag-select
            className="fixed inset-0 z-[110] flex items-center justify-center p-4"
            onClick={() => setCopyImportUrlProfile(null)}
          >
            <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-md animate-overlay-in" />
            <div
              className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-white/50 dark:border-white/[0.08] rounded-3xl shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)] max-w-sm w-full p-6 z-10 ring-1 ring-black/5 dark:ring-white/10 animate-confirm-in"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setCopyImportUrlProfile(null)}
                className="absolute right-4 top-4 shrink-0 rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                aria-label="关闭"
              >
                <CloseIcon className="h-5 w-5" />
              </button>

              <h3 className="mb-3 pr-8 flex items-start gap-2.5 text-base font-bold text-gray-800 dark:text-gray-100 leading-snug">
                <CopyIcon className="h-5 w-5 shrink-0 text-blue-500 mt-0.5" />
                <span>复制导入配置「{copyImportUrlProfile.name}」的 URL</span>
              </h3>
              <div className="text-[13px] text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
                是否包含 API Key？如果选择「不包含」，可额外配置是否使用 New API 变量。
              </div>

              {!copyImportUrlOptions.includeApiKey && (
                <div className="mb-6 rounded-2xl bg-gray-50/80 p-4 dark:bg-white/[0.03] ring-1 ring-black/5 dark:ring-white/5">
                  <div className="text-[13px] font-bold text-gray-700 dark:text-gray-300 mb-3.5">New API 变量配置</div>
                  <div className="space-y-3">
                    <Checkbox
                      checked={copyImportUrlOptions.useNewApiAddress}
                      onChange={(checked) => updateCopyImportUrlOptions({ useNewApiAddress: checked })}
                      label={<>使用 <code className="mx-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[0.85em] font-mono text-gray-700 dark:bg-white/[0.08] dark:text-gray-200">{"{address}"}</code> (不含 /v1)</>}
                    />
                    <Checkbox
                      checked={copyImportUrlOptions.useNewApiKey}
                      onChange={(checked) => updateCopyImportUrlOptions({ useNewApiKey: checked })}
                      label={<>使用 <code className="mx-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[0.85em] font-mono text-gray-700 dark:bg-white/[0.08] dark:text-gray-200">{"{key}"}</code></>}
                    />
                    <Checkbox
                      checked={copyImportUrlOptions.useNewApiModel}
                      onChange={(checked) => updateCopyImportUrlOptions({ useNewApiModel: checked })}
                      label={<>使用 <code className="mx-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[0.85em] font-mono text-gray-700 dark:bg-white/[0.08] dark:text-gray-200">{"{model}"}</code></>}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const options = { ...copyImportUrlOptions, includeApiKey: false }
                    copyProfileImportUrl(copyImportUrlProfile, options)
                  }}
                  className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-white/[0.08] text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.06] transition"
                >
                  不包含
                </button>
                <button
                  onClick={() => {
                    const options = { ...copyImportUrlOptions, includeApiKey: true }
                    copyProfileImportUrl(copyImportUrlProfile, options)
                  }}
                  className="flex-1 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition shadow-sm shadow-blue-500/20"
                >
                  包含 API Key
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
