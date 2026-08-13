import type {
  AccountApiKeyMode,
  ApiMode,
  ApiBalanceSnapshot,
  ApiPriceSnapshot,
  ApiProfile,
  ApiProvider,
  AppSettings,
  CloudSyncProvider,
  CloudSyncSettings,
  CustomProviderContentType,
  CustomProviderDefinition,
  CustomProviderFileMapping,
  CustomProviderPollMapping,
  CustomProviderRequestMethod,
  CustomProviderResultMapping,
  CustomProviderSubmitMapping,
  CustomProviderTemplate,
  NewApiAccountSession,
  ReferenceImageEditAction,
} from '../types'
import { DEFAULT_AGENT_MAX_TOOL_ROUNDS, DEFAULT_STREAM_PARTIAL_IMAGES } from '../types'
import { normalizeBaseUrl, shouldUseApiProxyForBaseUrl } from './devProxy'
import { readRuntimeEnv } from './runtimeEnv'
import { isImportableConfigUrl } from './customProviderConfigUrl'
import type { SizeTier } from './size'
import { CANVAS_VIDEO_MODEL } from './videoModel'
import {
  DEFAULT_IMAGES_MODEL,
  FIXED_IMAGE_MODEL_OPTIONS,
  GPT_IMAGE_2_VIP_MODEL,
  GPT_IMAGE_2_SUPER_MODEL,
  GPT_IMAGE_2_SUPER_REQUEST_MODEL,
  GPT_IMAGE_2_4K_MODEL,
  GPT_IMAGE_2_4K_REQUEST_MODEL,
  getBananaPricedImageModel,
  getFixedImageModelUnitCostText,
  getFixedImageRequestModel,
  getImageModelOptionsForProfile,
  isBananaImageModel,
  normalizeFixedImageModel,
} from './modelPricing'

export {
  DEFAULT_IMAGES_MODEL,
  FIXED_IMAGE_MODEL_OPTIONS,
  GPT_IMAGE_2_VIP_MODEL,
  GPT_IMAGE_2_SUPER_MODEL,
  GPT_IMAGE_2_SUPER_REQUEST_MODEL,
  GPT_IMAGE_2_4K_MODEL,
  GPT_IMAGE_2_4K_REQUEST_MODEL,
  getBananaPricedImageModel,
  getFixedImageModelUnitCostText,
  getFixedImageRequestModel,
  getImageModelOptionsForProfile,
  isBananaImageModel,
  normalizeFixedImageModel,
} from './modelPricing'

export const LOCKED_WENYUN_PROFILE_ID = 'wenyun-site'
export const LOCKED_PUBLIC_PROFILE_ID = 'public-site'
export const LOCKED_WENYUN_BASE_URL = 'https://api.zzlye.xyz/v1'
export const LOCKED_PUBLIC_BASE_URL = 'https://1520635.xyz:3901/v1'
export const LOCKED_OPENAI_BASE_URL = LOCKED_WENYUN_BASE_URL
export const PIXIV_RANDOM_BACKGROUND_API_URL = 'https://i.mukyu.ru/random?redirect=1&r18=0&ai_type=0&illust_type=illust&orientation=landscape&min_width=1920&min_height=1080&min_pixels=2500000&attempts=3&pixiv_cat=1&pximg_mirror_host=re'
const OPENAI_DEFAULT_BASE_URL = LOCKED_OPENAI_BASE_URL
const RAW_DEFAULT_API_URL = readRuntimeEnv(import.meta.env.VITE_DEFAULT_API_URL)
const DEFAULT_OPENAI_API_PROXY = readRuntimeEnv(import.meta.env.VITE_API_PROXY_AVAILABLE) === 'true'
const DOCKER_DEPLOYMENT = readRuntimeEnv(import.meta.env.VITE_DOCKER_DEPLOYMENT) === 'true'
const DEFAULT_BASE_URL = isImportableConfigUrl(RAW_DEFAULT_API_URL)
  ? ''
  : RAW_DEFAULT_API_URL || (DOCKER_DEPLOYMENT && DEFAULT_OPENAI_API_PROXY ? '' : OPENAI_DEFAULT_BASE_URL)
export const DEFAULT_RESPONSES_MODEL = 'gpt-5.5'
export const DEFAULT_FAL_BASE_URL = 'https://fal.run'
export const DEFAULT_FAL_MODEL = 'openai/gpt-image-2'
export const DEFAULT_OPENAI_PROFILE_ID = LOCKED_WENYUN_PROFILE_ID
export const DEFAULT_API_TIMEOUT = 600
const IMAGE_STREAMING_ENABLED = false

export function normalizeImageModelForProfile(model: string, profileId: string): string {
  void profileId
  return normalizeFixedImageModel(model)
}

export function getImageSizeTiersForProfile(_profileId: string): SizeTier[] {
  return ['1K', '2K', '4K']
}

export function allowsCustomImageRatioForProfile(_profileId: string): boolean {
  return true
}

export function normalizeImageSizeForProfile(size: string, _profileId: string): string {
  return size
}

function normalizeApiPriceItem(value: unknown): ApiPriceSnapshot['items'][number] | null {
  if (!isRecord(value)) return null
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  const rawPrice = typeof value.rawPrice === 'number' ? value.rawPrice : Number(value.rawPrice)
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  if (!model || !Number.isFinite(rawPrice) || !text) return null
  return { model, rawPrice, text }
}

function normalizeApiPriceSnapshot(value: unknown): ApiPriceSnapshot | null {
  if (!isRecord(value)) return null
  const items = Array.isArray(value.items)
    ? value.items.map(normalizeApiPriceItem).filter((item): item is NonNullable<ApiPriceSnapshot['items'][number]> => Boolean(item))
    : []
  return {
    items,
    updatedAt: normalizeApiBalanceUpdatedAt(value.updatedAt),
    found: typeof value.found === 'boolean' ? value.found : undefined,
  }
}

export function getApiModelUnitCostText(settings: AppSettings, profileId: string, model: string): string | null {
  const snapshot = settings.apiPriceByProfileId[profileId]
  const normalizedModel = model.trim().toLowerCase()
  const normalizedRequestModel = getFixedImageRequestModel(model).trim().toLowerCase()
  const synced = snapshot?.items.find((item) => {
    const itemModel = item.model.trim().toLowerCase()
    return itemModel === normalizedModel || itemModel === normalizedRequestModel
  })
  return synced?.text ?? getFixedImageModelUnitCostText(model)
}

export function getApiPriceSnapshot(settings: Pick<AppSettings, 'apiPriceByProfileId'>, profileId: string): ApiPriceSnapshot | null {
  return settings.apiPriceByProfileId[profileId] ?? null
}

export function setApiPriceSnapshot(settings: AppSettings, profileId: string, snapshot: ApiPriceSnapshot): Partial<AppSettings> {
  return {
    apiPriceByProfileId: {
      ...settings.apiPriceByProfileId,
      [profileId]: snapshot,
    },
  }
}

const LOCKED_OPENAI_PROFILE_DEFINITIONS = [
  { id: LOCKED_WENYUN_PROFILE_ID, name: '文运站', baseUrl: LOCKED_WENYUN_BASE_URL },
  { id: LOCKED_PUBLIC_PROFILE_ID, name: '公益站', baseUrl: LOCKED_PUBLIC_BASE_URL },
] as const

export const LOCKED_OPENAI_API_PROFILES = LOCKED_OPENAI_PROFILE_DEFINITIONS

const BUILT_IN_PROVIDER_IDS = new Set<ApiProvider>(['openai', 'fal'])
const CLOUD_SYNC_PROVIDERS = new Set<CloudSyncProvider>([
  'local-file',
  'webdav',
  'google-drive',
  'onedrive',
  'dropbox',
  'custom-api',
  'baidu-netdisk',
  'quark-drive',
  'aliyundrive',
  'alist',
  'nextcloud',
  'jianguoyun',
  'synology',
  'cloudreve',
  'koofr',
  'yandex-disk',
  'box',
  'pcloud',
])
export const DEFAULT_CLOUD_SYNC_SETTINGS: CloudSyncSettings = {
  enabled: false,
  autoSync: false,
  autoSyncIntervalMinutes: 5,
  uploadTasks: true,
  uploadCanvasProjects: true,
  uploadAssets: true,
  pullTasks: true,
  pullCanvasProjects: true,
  pullAssets: true,
  provider: 'local-file',
  endpoint: '',
  username: '',
  password: '',
  token: '',
  folderId: '',
  remotePath: '/gpt-image-playground',
  fileName: 'gpt-image-playground-backup.zip',
}
const DEFAULT_CUSTOM_PROVIDER_PATHS = {
  generationPath: 'images/generations',
  editPath: 'images/edits',
  taskPath: 'images/tasks/{task_id}',
}
const DEFAULT_GENERATE_BODY = {
  model: '$profile.model',
  prompt: '$prompt',
  size: '$params.size',
  quality: '$params.quality',
  output_format: '$params.output_format',
  moderation: '$params.moderation',
  output_compression: '$params.output_compression',
  n: '$params.n',
}
const DEFAULT_EDIT_BODY = DEFAULT_GENERATE_BODY
const DEFAULT_OPENAI_RESULT: CustomProviderResultMapping = {
  imageUrlPaths: ['data.*.url'],
  b64JsonPaths: ['data.*.b64_json'],
}
const DEFAULT_EDIT_FILES: CustomProviderFileMapping[] = [
  { field: 'image[]', source: 'inputImages', array: true },
  { field: 'mask', source: 'mask' },
]

type ApiProfileProviderDraft = NonNullable<ApiProfile['providerDrafts']>[ApiProvider]

function normalizeLockedBaseUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '').toLowerCase() : ''
}

function getLockedOpenAIProfileDefinition(input?: Partial<ApiProfile> | null) {
  const id = typeof input?.id === 'string' ? input.id : ''
  const baseUrl = normalizeLockedBaseUrl(input?.baseUrl)
  return LOCKED_OPENAI_PROFILE_DEFINITIONS.find((definition) => definition.id === id)
    ?? LOCKED_OPENAI_PROFILE_DEFINITIONS.find((definition) => normalizeLockedBaseUrl(definition.baseUrl) === baseUrl)
    ?? LOCKED_OPENAI_PROFILE_DEFINITIONS[0]
}

function normalizeApiTimeout(value: unknown, fallback = DEFAULT_API_TIMEOUT): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function normalizeApiBalanceUpdatedAt(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined
}

function normalizeApiBalanceText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text) return ''
  // 迁移旧缓存，避免刷新后在自动查询完成前短暂显示旧美元符号。
  return text.replace(/\$(\d)/g, 'HUHN $1')
}

function normalizeApiBalanceSnapshot(value: unknown): ApiBalanceSnapshot | null {
  if (!isRecord(value)) return null
  const text = normalizeApiBalanceText(value.text)
  if (!text) return null
  return {
    text,
    currency: typeof value.currency === 'string' ? value.currency : undefined,
    updatedAt: normalizeApiBalanceUpdatedAt(value.updatedAt),
  }
}

function normalizeApiBalanceByProfileId(record: Record<string, unknown>, profileIds: Set<string>): Record<string, ApiBalanceSnapshot> {
  const balances: Record<string, ApiBalanceSnapshot> = {}
  if (isRecord(record.apiBalanceByProfileId)) {
    for (const [profileId, value] of Object.entries(record.apiBalanceByProfileId)) {
      if (!profileIds.has(profileId)) continue
      const snapshot = normalizeApiBalanceSnapshot(value)
      if (snapshot) balances[profileId] = snapshot
    }
  }

  const legacyProfileId = typeof record.apiBalanceProfileId === 'string' ? record.apiBalanceProfileId : ''
  if (profileIds.has(legacyProfileId) && !balances[legacyProfileId]) {
    const legacySnapshot = normalizeApiBalanceSnapshot({
      text: record.apiBalanceText,
      currency: record.apiBalanceCurrency,
      updatedAt: record.apiBalanceUpdatedAt,
    })
    if (legacySnapshot) balances[legacyProfileId] = legacySnapshot
  }

  return balances
}

function normalizeApiPriceByProfileId(record: Record<string, unknown>, profileIds: Set<string>): Record<string, ApiPriceSnapshot> {
  const prices: Record<string, ApiPriceSnapshot> = {}
  if (isRecord(record.apiPriceByProfileId)) {
    for (const [profileId, value] of Object.entries(record.apiPriceByProfileId)) {
      if (!profileIds.has(profileId)) continue
      const snapshot = normalizeApiPriceSnapshot(value)
      if (snapshot) prices[profileId] = snapshot
    }
  }
  return prices
}

export function getApiBalanceSnapshot(settings: Pick<AppSettings, 'apiBalanceByProfileId' | 'apiBalanceProfileId' | 'apiBalanceText' | 'apiBalanceCurrency' | 'apiBalanceUpdatedAt'>, profileId: string): ApiBalanceSnapshot | null {
  return settings.apiBalanceByProfileId[profileId] ?? (
    settings.apiBalanceProfileId === profileId && settings.apiBalanceText
      ? {
          text: settings.apiBalanceText,
          currency: settings.apiBalanceCurrency,
          updatedAt: settings.apiBalanceUpdatedAt,
        }
      : null
  )
}

export function setApiBalanceSnapshot(settings: AppSettings, profileId: string, snapshot: ApiBalanceSnapshot): Partial<AppSettings> {
  return {
    apiBalanceText: snapshot.text,
    apiBalanceCurrency: snapshot.currency,
    apiBalanceUpdatedAt: snapshot.updatedAt,
    apiBalanceProfileId: profileId,
    apiBalanceByProfileId: {
      ...settings.apiBalanceByProfileId,
      [profileId]: snapshot,
    },
  }
}

function createLockedOpenAIProfile(definition: typeof LOCKED_OPENAI_PROFILE_DEFINITIONS[number], overrides: Partial<ApiProfile> = {}): ApiProfile {
  return {
    id: definition.id,
    name: definition.name,
    provider: 'openai',
    baseUrl: definition.baseUrl,
    apiKey: typeof overrides.apiKey === 'string' ? overrides.apiKey : '',
    model: normalizeFixedImageModel(overrides.model),
    timeout: normalizeApiTimeout(overrides.timeout),
    apiMode: 'images',
    codexCli: false,
    apiProxy: typeof overrides.apiProxy === 'boolean' ? overrides.apiProxy : false,
    responseFormatB64Json: overrides.responseFormatB64Json === true ? true : undefined,
    streamImages: IMAGE_STREAMING_ENABLED,
    streamPartialImages: normalizeStreamPartialImages(overrides.streamPartialImages, DEFAULT_STREAM_PARTIAL_IMAGES),
    providerDrafts: undefined,
  }
}

function createLockedOpenAIProfiles(input: unknown, legacyProfile: ApiProfile): ApiProfile[] {
  const profileRecords = Array.isArray(input) ? input : []
  const byDefinition = new Map<string, ApiProfile>()
  const legacyFallback = lockOpenAIProfile(legacyProfile)

  for (const item of profileRecords) {
    const normalized = normalizeApiProfile(item)
    byDefinition.set(normalized.id, normalized)
  }

  return LOCKED_OPENAI_PROFILE_DEFINITIONS.map((definition, index) =>
    byDefinition.get(definition.id)
      ?? createLockedOpenAIProfile(definition, index === 0 ? legacyFallback : {}),
  )
}

function normalizeAppearanceOpacity(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0.28
  return Math.min(1, Math.max(0, numeric))
}

function normalizeAppearanceBlur(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 18
  return Math.min(60, Math.max(0, Math.trunc(numeric)))
}

function normalizeAppearanceUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const url = value.trim()
  // 旧版本曾保存随机入口本身，会导致刷新或打开设置时重新随机，这里直接迁移清空。
  if (/^https:\/\/i\.mukyu\.ru\/random(?:\?|$)/i.test(url)) return ''
  return url
}

function lockOpenAIProfile(profile: ApiProfile): ApiProfile {
  const definition = getLockedOpenAIProfileDefinition(profile)
  return createLockedOpenAIProfile(definition, profile)
}

export function normalizeStreamPartialImages(value: unknown, fallback: number | undefined = DEFAULT_STREAM_PARTIAL_IMAGES): number {
  const fallbackValue = fallback ?? DEFAULT_STREAM_PARTIAL_IMAGES
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallbackValue
  return Math.min(3, Math.max(0, Math.trunc(numeric)))
}

export function normalizeAgentMaxToolRounds(value: unknown, fallback: number | undefined = DEFAULT_AGENT_MAX_TOOL_ROUNDS): number {
  const fallbackValue = fallback ?? DEFAULT_AGENT_MAX_TOOL_ROUNDS
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallbackValue
  return Math.min(50, Math.max(1, Math.trunc(numeric)))
}

function normalizeReferenceImageEditAction(value: unknown): ReferenceImageEditAction {
  return value === 'replace-reference' || value === 'add-mask' ? value : 'ask'
}

function isCustomProviderTemplate(value: unknown): value is CustomProviderTemplate {
  return value === 'http-image'
}

function normalizeProviderPath(value: unknown, fallback: string): string {
  return (typeof value === 'string' && value.trim() ? value : fallback).trim().replace(/^\/+/, '').replace(/^v1\//, '')
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined

  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string | number | boolean] =>
      typeof entry[0] === 'string' && ['string', 'number', 'boolean'].includes(typeof entry[1]),
    )
    .map(([key, item]) => [key, String(item)] as const)

  return entries.length ? Object.fromEntries(entries) : undefined
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
    : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCloudSyncProvider(value: unknown): CloudSyncProvider {
  return typeof value === 'string' && CLOUD_SYNC_PROVIDERS.has(value as CloudSyncProvider)
    ? value as CloudSyncProvider
    : DEFAULT_CLOUD_SYNC_SETTINGS.provider
}

function normalizeCloudSyncSettings(value: unknown): CloudSyncSettings {
  const record = isRecord(value) ? value : {}
  const interval = Number(record.autoSyncIntervalMinutes)
  const fileName = typeof record.fileName === 'string' && record.fileName.trim()
    ? record.fileName.trim()
    : DEFAULT_CLOUD_SYNC_SETTINGS.fileName

  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_CLOUD_SYNC_SETTINGS.enabled,
    autoSync: typeof record.autoSync === 'boolean' ? record.autoSync : DEFAULT_CLOUD_SYNC_SETTINGS.autoSync,
    autoSyncIntervalMinutes: Number.isFinite(interval) ? Math.max(5, Math.trunc(interval)) : DEFAULT_CLOUD_SYNC_SETTINGS.autoSyncIntervalMinutes,
    uploadTasks: typeof record.uploadTasks === 'boolean' ? record.uploadTasks : DEFAULT_CLOUD_SYNC_SETTINGS.uploadTasks,
    uploadCanvasProjects: typeof record.uploadCanvasProjects === 'boolean' ? record.uploadCanvasProjects : DEFAULT_CLOUD_SYNC_SETTINGS.uploadCanvasProjects,
    uploadAssets: typeof record.uploadAssets === 'boolean' ? record.uploadAssets : DEFAULT_CLOUD_SYNC_SETTINGS.uploadAssets,
    pullTasks: typeof record.pullTasks === 'boolean' ? record.pullTasks : DEFAULT_CLOUD_SYNC_SETTINGS.pullTasks,
    pullCanvasProjects: typeof record.pullCanvasProjects === 'boolean' ? record.pullCanvasProjects : DEFAULT_CLOUD_SYNC_SETTINGS.pullCanvasProjects,
    pullAssets: typeof record.pullAssets === 'boolean' ? record.pullAssets : DEFAULT_CLOUD_SYNC_SETTINGS.pullAssets,
    provider: normalizeCloudSyncProvider(record.provider),
    endpoint: typeof record.endpoint === 'string' ? record.endpoint.trim() : DEFAULT_CLOUD_SYNC_SETTINGS.endpoint,
    username: typeof record.username === 'string' ? record.username : DEFAULT_CLOUD_SYNC_SETTINGS.username,
    password: typeof record.password === 'string' ? record.password : DEFAULT_CLOUD_SYNC_SETTINGS.password,
    token: typeof record.token === 'string' ? record.token.trim() : DEFAULT_CLOUD_SYNC_SETTINGS.token,
    folderId: typeof record.folderId === 'string' ? record.folderId.trim() : DEFAULT_CLOUD_SYNC_SETTINGS.folderId,
    remotePath: typeof record.remotePath === 'string' && record.remotePath.trim() ? record.remotePath.trim() : DEFAULT_CLOUD_SYNC_SETTINGS.remotePath,
    fileName: fileName.endsWith('.zip') ? fileName : `${fileName}.zip`,
    localFileName: typeof record.localFileName === 'string' && record.localFileName.trim() ? record.localFileName.trim() : undefined,
    lastUploadAt: normalizeApiBalanceUpdatedAt(record.lastUploadAt),
    lastPullAt: normalizeApiBalanceUpdatedAt(record.lastPullAt),
    lastAutoSyncAt: normalizeApiBalanceUpdatedAt(record.lastAutoSyncAt),
    lastError: typeof record.lastError === 'string' ? record.lastError : undefined,
  }
}

function normalizeAccountApiKeyMode(value: unknown): AccountApiKeyMode {
  return value === 'account' ? 'account' : 'manual'
}

function normalizeNewApiAccountSession(value: unknown, siteProfileId: string): NewApiAccountSession | null {
  if (!isRecord(value)) return null
  const username = typeof value.username === 'string' ? value.username.trim() : ''
  const accessToken = typeof value.accessToken === 'string' ? value.accessToken.trim() : ''
  if (!username || !accessToken) return null

  return {
    siteProfileId,
    username,
    accessToken,
    authSessionId: typeof value.authSessionId === 'string' && value.authSessionId.trim() ? value.authSessionId.trim() : undefined,
    accessTokenExpiresAt: normalizeApiBalanceUpdatedAt(value.accessTokenExpiresAt),
    userId: typeof value.userId === 'string' || typeof value.userId === 'number' ? value.userId : undefined,
    email: typeof value.email === 'string' && value.email.trim() ? value.email.trim() : undefined,
    displayName: typeof value.displayName === 'string' && value.displayName.trim() ? value.displayName.trim() : undefined,
    inviteCode: typeof value.inviteCode === 'string' && value.inviteCode.trim() ? value.inviteCode.trim() : undefined,
    registrationInviteCode: typeof value.registrationInviteCode === 'string' && value.registrationInviteCode.trim() ? value.registrationInviteCode.trim() : undefined,
    inviter: typeof value.inviter === 'string' && value.inviter.trim() ? value.inviter.trim() : undefined,
    inviterId: typeof value.inviterId === 'string' || typeof value.inviterId === 'number' ? value.inviterId : undefined,
    boundApiKey: typeof value.boundApiKey === 'string' ? value.boundApiKey.trim() : undefined,
    boundApiKeyId: typeof value.boundApiKeyId === 'string' || typeof value.boundApiKeyId === 'number' ? value.boundApiKeyId : undefined,
    boundApiKeyName: typeof value.boundApiKeyName === 'string' && value.boundApiKeyName.trim() ? value.boundApiKeyName.trim() : undefined,
    lastKeyRefreshAt: normalizeApiBalanceUpdatedAt(value.lastKeyRefreshAt),
    balanceText: typeof value.balanceText === 'string' && value.balanceText.trim() ? normalizeApiBalanceText(value.balanceText) : undefined,
    balanceSource: value.balanceSource === 'user' ? 'user' : undefined,
    balanceUpdatedAt: normalizeApiBalanceUpdatedAt(value.balanceUpdatedAt),
  }
}

function normalizeNewApiAccountSessions(input: unknown, profileIds: Set<string>): Record<string, NewApiAccountSession> {
  if (!isRecord(input)) return {}
  const sessions: Record<string, NewApiAccountSession> = {}
  for (const [profileId, value] of Object.entries(input)) {
    if (!profileIds.has(profileId)) continue
    const session = normalizeNewApiAccountSession(value, profileId)
    if (session) sessions[profileId] = session
  }
  return sessions
}

function normalizeRequestMethod(value: unknown, fallback: CustomProviderRequestMethod = 'POST'): CustomProviderRequestMethod {
  return value === 'GET' || value === 'POST' ? value : fallback
}

function normalizeContentType(value: unknown, fallback: CustomProviderContentType = 'json'): CustomProviderContentType {
  return value === 'multipart' ? 'multipart' : fallback
}

function normalizeBodyTemplate(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  return isRecord(value) ? value : fallback
}

function normalizeFileMappings(value: unknown, fallback: CustomProviderFileMapping[] = []): CustomProviderFileMapping[] {
  if (!Array.isArray(value)) return fallback
  const files = value
    .map((item): CustomProviderFileMapping | null => {
      if (!isRecord(item) || typeof item.field !== 'string' || !item.field.trim()) return null
      if (item.source !== 'inputImages' && item.source !== 'mask') return null
      return {
        field: item.field.trim(),
        source: item.source,
        array: Boolean(item.array),
      }
    })
    .filter((item): item is CustomProviderFileMapping => Boolean(item))
  return files.length ? files : fallback
}

function normalizeResultMapping(value: unknown, fallback: CustomProviderResultMapping = DEFAULT_OPENAI_RESULT): CustomProviderResultMapping {
  const record = isRecord(value) ? value : {}
  const imageUrlPaths = normalizeStringArray(record.imageUrlPaths, fallback.imageUrlPaths ?? [])
  const b64JsonPaths = normalizeStringArray(record.b64JsonPaths, fallback.b64JsonPaths ?? [])
  return {
    imageUrlPaths,
    b64JsonPaths,
  }
}

function normalizeSubmitMapping(value: unknown, fallback: CustomProviderSubmitMapping): CustomProviderSubmitMapping {
  const record = isRecord(value) ? value : {}
  const contentType = normalizeContentType(record.contentType, fallback.contentType ?? 'json')
  return {
    path: normalizeProviderPath(record.path, fallback.path),
    method: normalizeRequestMethod(record.method, fallback.method ?? 'POST'),
    contentType,
    query: normalizeStringRecord(record.query) ?? fallback.query,
    body: normalizeBodyTemplate(record.body, fallback.body ?? (contentType === 'multipart' ? DEFAULT_EDIT_BODY : DEFAULT_GENERATE_BODY)),
    files: contentType === 'multipart' ? normalizeFileMappings(record.files, fallback.files) : undefined,
    taskIdPath: typeof record.taskIdPath === 'string' && record.taskIdPath.trim() ? record.taskIdPath.trim() : fallback.taskIdPath,
    result: normalizeResultMapping(record.result, fallback.result ?? DEFAULT_OPENAI_RESULT),
  }
}

function normalizePollMapping(value: unknown, fallback?: CustomProviderPollMapping): CustomProviderPollMapping | undefined {
  if (!isRecord(value) && !fallback) return undefined
  const record = isRecord(value) ? value : {}
  const path = normalizeProviderPath(record.path, fallback?.path ?? DEFAULT_CUSTOM_PROVIDER_PATHS.taskPath)
  const statusPath = typeof record.statusPath === 'string' && record.statusPath.trim() ? record.statusPath.trim() : fallback?.statusPath
  if (!statusPath) return undefined

  return {
    path,
    method: normalizeRequestMethod(record.method, fallback?.method ?? 'GET'),
    query: normalizeStringRecord(record.query) ?? fallback?.query,
    intervalSeconds: typeof record.intervalSeconds === 'number' && Number.isFinite(record.intervalSeconds)
      ? Math.max(1, record.intervalSeconds)
      : fallback?.intervalSeconds ?? 5,
    statusPath,
    successValues: normalizeStringArray(record.successValues, fallback?.successValues ?? ['SUCCESS', 'succeeded', 'completed', 'COMPLETED']),
    failureValues: normalizeStringArray(record.failureValues, fallback?.failureValues ?? ['FAILURE', 'failed', 'error', 'FAILED', 'cancelled']),
    errorPath: typeof record.errorPath === 'string' && record.errorPath.trim() ? record.errorPath.trim() : fallback?.errorPath,
    result: normalizeResultMapping(record.result, fallback?.result ?? DEFAULT_OPENAI_RESULT),
  }
}

function legacyCustomProviderToManifest(record: Record<string, unknown>): Record<string, unknown> | null {
  if (record.template !== 'openai-compatible' && record.template !== 'openai-compatible-async') return null
  const isAsync = record.template === 'openai-compatible-async'
  const taskResultPath = typeof record.taskResultPath === 'string' && record.taskResultPath.trim() ? record.taskResultPath.trim() : 'data.data'
  return {
    id: record.id,
    name: record.name,
    template: 'http-image',
    submit: {
      path: record.generationPath ?? DEFAULT_CUSTOM_PROVIDER_PATHS.generationPath,
      method: 'POST',
      contentType: 'json',
      query: isAsync ? normalizeStringRecord(record.submitQuery) ?? { async: 'true' } : undefined,
      body: DEFAULT_GENERATE_BODY,
      taskIdPath: isAsync ? (record.taskIdPath ?? 'data') : undefined,
      result: DEFAULT_OPENAI_RESULT,
    },
    editSubmit: {
      path: record.editPath ?? DEFAULT_CUSTOM_PROVIDER_PATHS.editPath,
      method: 'POST',
      contentType: 'multipart',
      query: isAsync ? normalizeStringRecord(record.submitQuery) ?? { async: 'true' } : undefined,
      body: DEFAULT_EDIT_BODY,
      files: DEFAULT_EDIT_FILES,
      taskIdPath: isAsync ? (record.taskIdPath ?? 'data') : undefined,
      result: DEFAULT_OPENAI_RESULT,
    },
    poll: isAsync ? {
      path: record.taskPath ?? DEFAULT_CUSTOM_PROVIDER_PATHS.taskPath,
      method: 'GET',
      statusPath: record.taskStatusPath ?? 'data.status',
      successValues: normalizeStringArray(record.taskSuccessValues, ['SUCCESS', 'succeeded', 'completed', 'COMPLETED']),
      failureValues: normalizeStringArray(record.taskFailureValues, ['FAILURE', 'failed', 'error', 'FAILED']),
      errorPath: 'data.fail_reason',
      intervalSeconds: typeof record.pollIntervalSeconds === 'number' ? record.pollIntervalSeconds : 5,
      result: {
        imageUrlPaths: [`${taskResultPath}.data.*.url`],
        b64JsonPaths: [`${taskResultPath}.data.*.b64_json`],
      },
    } : undefined,
  }
}

function createCustomProviderId(name: string, usedIds: Set<string>): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom'
  let id = `custom-${slug}`
  let index = 2
  while (usedIds.has(id) || BUILT_IN_PROVIDER_IDS.has(id)) {
    id = `custom-${slug}-${index}`
    index += 1
  }
  usedIds.add(id)
  return id
}

export function normalizeCustomProviderDefinition(input: unknown, usedIds = new Set<string>()): CustomProviderDefinition | null {
  if (!input || typeof input !== 'object') return null
  const rawRecord = input as Record<string, unknown>
  const record = legacyCustomProviderToManifest(rawRecord) ?? rawRecord
  const template = record.template == null ? 'http-image' : isCustomProviderTemplate(record.template) ? record.template : null
  if (!template || !isRecord(record.submit)) return null

  const rawName = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : '自定义服务商'
  const id = typeof record.id === 'string' && record.id.trim() && !BUILT_IN_PROVIDER_IDS.has(record.id.trim()) && !usedIds.has(record.id.trim())
    ? record.id.trim()
    : createCustomProviderId(rawName, usedIds)
  usedIds.add(id)

  return {
    id,
    name: rawName,
    template,
    submit: normalizeSubmitMapping(record.submit, {
      path: DEFAULT_CUSTOM_PROVIDER_PATHS.generationPath,
      method: 'POST',
      contentType: 'json',
      body: DEFAULT_GENERATE_BODY,
      result: DEFAULT_OPENAI_RESULT,
    }),
    editSubmit: isRecord(record.editSubmit) ? normalizeSubmitMapping(record.editSubmit, {
      path: DEFAULT_CUSTOM_PROVIDER_PATHS.editPath,
      method: 'POST',
      contentType: 'multipart',
      body: DEFAULT_EDIT_BODY,
      files: DEFAULT_EDIT_FILES,
      result: DEFAULT_OPENAI_RESULT,
    }) : undefined,
    poll: normalizePollMapping(record.poll),
  }
}

export function normalizeCustomProviderDefinitions(input: unknown): CustomProviderDefinition[] {
  const usedIds = new Set<string>()
  const list = Array.isArray(input) ? input : []
  return list
    .map((item) => normalizeCustomProviderDefinition(item, usedIds))
    .filter((item): item is CustomProviderDefinition => Boolean(item))
}

export function createDefaultOpenAIProfile(overrides: Partial<ApiProfile> = {}): ApiProfile {
  const definition = getLockedOpenAIProfileDefinition({
    id: overrides.id ?? DEFAULT_OPENAI_PROFILE_ID,
    baseUrl: overrides.baseUrl ?? DEFAULT_BASE_URL,
  })
  return createLockedOpenAIProfile(definition, {
    apiProxy: DEFAULT_OPENAI_API_PROXY,
    ...overrides,
  })
}

export function createDefaultFalProfile(overrides: Partial<ApiProfile> = {}): ApiProfile {
  return {
    id: `fal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: '新配置',
    provider: 'fal',
    baseUrl: DEFAULT_FAL_BASE_URL,
    apiKey: '',
    model: DEFAULT_FAL_MODEL,
    timeout: DEFAULT_API_TIMEOUT,
    apiMode: 'images',
    codexCli: false,
    apiProxy: false,
    streamImages: false,
    streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES,
    ...overrides,
  }
}

export function switchApiProfileProvider(profile: ApiProfile, provider: ApiProvider, customProvider?: CustomProviderDefinition): ApiProfile {
  const providerDrafts = {
    ...profile.providerDrafts,
    [profile.provider]: {
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiMode: profile.apiMode,
      codexCli: profile.codexCli,
      apiProxy: profile.apiProxy,
      responseFormatB64Json: profile.responseFormatB64Json,
      streamImages: profile.streamImages,
      streamPartialImages: profile.streamPartialImages,
    },
  }
  const savedDraft = providerDrafts[provider]

  if (provider === 'fal') {
    return {
      ...profile,
      provider,
      baseUrl: savedDraft?.baseUrl ?? DEFAULT_FAL_BASE_URL,
      model: savedDraft?.model ?? DEFAULT_FAL_MODEL,
      apiMode: savedDraft?.apiMode ?? 'images',
      codexCli: false,
      apiProxy: false,
      responseFormatB64Json: savedDraft?.responseFormatB64Json,
      streamImages: false,
      streamPartialImages: savedDraft?.streamPartialImages ?? DEFAULT_STREAM_PARTIAL_IMAGES,
      providerDrafts,
    }
  }

  if (customProvider) {
    const shouldUseOpenAIDefaults = profile.provider === 'fal'
    return {
      ...profile,
      provider: customProvider.id,
      baseUrl: savedDraft?.baseUrl ?? (shouldUseOpenAIDefaults ? DEFAULT_BASE_URL : profile.baseUrl || DEFAULT_BASE_URL),
      model: savedDraft?.model ?? (shouldUseOpenAIDefaults ? DEFAULT_IMAGES_MODEL : profile.model || DEFAULT_IMAGES_MODEL),
      apiMode: savedDraft?.apiMode ?? 'images',
      codexCli: false,
      apiProxy: false,
      responseFormatB64Json: savedDraft?.responseFormatB64Json,
      streamImages: false,
      streamPartialImages: savedDraft?.streamPartialImages ?? DEFAULT_STREAM_PARTIAL_IMAGES,
      providerDrafts,
    }
  }

  return {
    ...profile,
    provider,
    baseUrl: savedDraft?.baseUrl ?? DEFAULT_BASE_URL,
    model: savedDraft?.model ?? DEFAULT_IMAGES_MODEL,
    apiMode: savedDraft?.apiMode ?? profile.apiMode,
    codexCli: false,
    apiProxy: savedDraft?.apiProxy ?? DEFAULT_OPENAI_API_PROXY,
    responseFormatB64Json: savedDraft?.responseFormatB64Json,
    streamImages: IMAGE_STREAMING_ENABLED,
    streamPartialImages: savedDraft?.streamPartialImages ?? (profile.provider === 'openai' ? profile.streamPartialImages : DEFAULT_STREAM_PARTIAL_IMAGES),
    providerDrafts,
  }
}

function normalizeProviderDraft(input: unknown, provider: ApiProvider, customProviderIds: Set<string>): ApiProfileProviderDraft {
  if (!isRecord(input)) return undefined
  const fallback = provider === 'fal' ? createDefaultFalProfile() : createDefaultOpenAIProfile()
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl : undefined
  const model = typeof input.model === 'string' && input.model.trim() ? input.model : undefined
  const apiMode = input.apiMode === 'responses' ? 'responses' : input.apiMode === 'images' ? 'images' : undefined
  const knownProvider = provider === 'fal' || provider === 'openai' || customProviderIds.has(provider)
  if (!knownProvider) return undefined

  return {
    baseUrl: provider === 'fal'
      ? baseUrl?.trim().replace(/\/+$/, '') || DEFAULT_FAL_BASE_URL
      : baseUrl,
    model,
    apiMode,
    codexCli: false,
    apiProxy: typeof input.apiProxy === 'boolean' ? input.apiProxy : fallback.apiProxy,
    responseFormatB64Json: input.responseFormatB64Json === true ? true : undefined,
    streamImages: IMAGE_STREAMING_ENABLED,
    streamPartialImages: normalizeStreamPartialImages(input.streamPartialImages, fallback.streamPartialImages),
  }
}

function normalizeProviderDrafts(input: unknown, customProviderIds: Set<string>): ApiProfile['providerDrafts'] {
  if (!isRecord(input)) return undefined
  const entries = Object.entries(input)
    .map(([provider, draft]) => [provider, normalizeProviderDraft(draft, provider, customProviderIds)] as const)
    .filter((entry): entry is [ApiProvider, NonNullable<ApiProfileProviderDraft>] => Boolean(entry[1]))

  return entries.length ? Object.fromEntries(entries) : undefined
}

export function normalizeApiProfile(input: unknown, fallback?: Partial<ApiProfile>, customProviderIds = new Set<string>()): ApiProfile {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const definition = getLockedOpenAIProfileDefinition({
    id: typeof record.id === 'string' ? record.id : fallback?.id,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : fallback?.baseUrl,
  })
  return createLockedOpenAIProfile(definition, {
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : fallback?.apiKey,
    model: typeof record.model === 'string' ? record.model : fallback?.model,
    timeout: normalizeApiTimeout(record.timeout, fallback?.timeout ?? DEFAULT_API_TIMEOUT),
    apiProxy: typeof record.apiProxy === 'boolean' ? record.apiProxy : fallback?.apiProxy,
    responseFormatB64Json: record.responseFormatB64Json === true ? true : fallback?.responseFormatB64Json,
    streamImages: IMAGE_STREAMING_ENABLED,
    streamPartialImages: normalizeStreamPartialImages(record.streamPartialImages, fallback?.streamPartialImages),
  })
}

function validateImportedProfileRecord(input: unknown) {
  if (!isRecord(input)) return

  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : ''
  if (baseUrl && (baseUrl.startsWith('[') || baseUrl.includes(']('))) {
    throw new Error('JSON 包含 Markdown 链接，请粘贴纯文本')
  }

  if (typeof input.apiMode === 'string' && input.apiMode !== 'images' && input.apiMode !== 'responses') {
    throw new Error('apiMode 格式无效，应为 images 或 responses')
  }
}

export function normalizeSettings(input: Partial<AppSettings> | unknown): AppSettings {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const customProviders = normalizeCustomProviderDefinitions(record.customProviders)
  const legacyProfile = createDefaultOpenAIProfile({
    baseUrl: LOCKED_OPENAI_BASE_URL,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    model: DEFAULT_IMAGES_MODEL,
    timeout: typeof record.timeout === 'number' && Number.isFinite(record.timeout) ? record.timeout : DEFAULT_API_TIMEOUT,
    apiMode: 'images',
    codexCli: false,
    apiProxy: typeof record.apiProxy === 'boolean' ? record.apiProxy : DEFAULT_OPENAI_API_PROXY,
    responseFormatB64Json: undefined,
    streamImages: IMAGE_STREAMING_ENABLED,
    streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES,
  })
  const profiles = createLockedOpenAIProfiles(record.profiles, legacyProfile)
  const profileIds = new Set(profiles.map((profile) => profile.id))
  const apiBalanceByProfileId = normalizeApiBalanceByProfileId(record, profileIds)
  const apiPriceByProfileId = normalizeApiPriceByProfileId(record, profileIds)
  const newApiAccountSessions = normalizeNewApiAccountSessions(record.newApiAccountSessions, profileIds)
  const activeProfileId = typeof record.activeProfileId === 'string' && profiles.some((p) => p.id === record.activeProfileId)
    ? record.activeProfileId
    : profiles[0].id
  const active = profiles.find((p) => p.id === activeProfileId) ?? profiles[0]
  const legacyTextVideoBaseUrl = normalizeBaseUrl(typeof record.textVideoBaseUrl === 'string' ? record.textVideoBaseUrl : '')
  const legacyTextVideoApiKey = typeof record.textVideoApiKey === 'string' ? record.textVideoApiKey : ''
  const legacyTextVideoModel = typeof record.textVideoModel === 'string' ? record.textVideoModel.trim() : ''
  const legacyTextVideoTimeout = normalizeApiTimeout(record.textVideoTimeout, DEFAULT_API_TIMEOUT)
  const legacyTextVideoApiProxy = typeof record.textVideoApiProxy === 'boolean' ? record.textVideoApiProxy : false
  const textBaseUrl = normalizeBaseUrl(typeof record.textBaseUrl === 'string' ? record.textBaseUrl : legacyTextVideoBaseUrl)
  const textApiKey = typeof record.textApiKey === 'string' ? record.textApiKey : legacyTextVideoApiKey
  const textModel = typeof record.textModel === 'string' ? record.textModel.trim() : legacyTextVideoModel
  const textTimeout = normalizeApiTimeout(record.textTimeout, legacyTextVideoTimeout)
  const textApiProxy = typeof record.textApiProxy === 'boolean' ? record.textApiProxy : legacyTextVideoApiProxy
  const videoBaseUrl = normalizeBaseUrl(typeof record.videoBaseUrl === 'string' ? record.videoBaseUrl : legacyTextVideoBaseUrl)
  const videoApiKey = typeof record.videoApiKey === 'string' ? record.videoApiKey : legacyTextVideoApiKey
  // 画布视频节点只保留 Seedance 2.0，旧配置在读取时直接迁移。
  const videoModel = CANVAS_VIDEO_MODEL
  const videoTimeout = normalizeApiTimeout(record.videoTimeout, legacyTextVideoTimeout)
  const videoApiProxy = typeof record.videoApiProxy === 'boolean' ? record.videoApiProxy : legacyTextVideoApiProxy

  return {
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: normalizeFixedImageModel(active.model),
    timeout: active.timeout,
    apiMode: 'images',
    codexCli: false,
    apiProxy: active.apiProxy,
    streamImages: IMAGE_STREAMING_ENABLED,
    streamPartialImages: active.streamPartialImages ?? DEFAULT_STREAM_PARTIAL_IMAGES,
    customProviders,
    providerOrder: Array.isArray(record.providerOrder) ? record.providerOrder.map(String) : undefined,
    clearInputAfterSubmit: typeof record.clearInputAfterSubmit === 'boolean' ? record.clearInputAfterSubmit : false,
    persistInputOnRestart: typeof record.persistInputOnRestart === 'boolean' ? record.persistInputOnRestart : true,
    reuseTaskApiProfileTemporarily: typeof record.reuseTaskApiProfileTemporarily === 'boolean' ? record.reuseTaskApiProfileTemporarily : false,
    alwaysShowRetryButton: typeof record.alwaysShowRetryButton === 'boolean' ? record.alwaysShowRetryButton : false,
    enterSubmit: typeof record.enterSubmit === 'boolean' ? record.enterSubmit : false,
    referenceImageEditAction: normalizeReferenceImageEditAction(record.referenceImageEditAction),
    appearanceBackgroundApiUrl: PIXIV_RANDOM_BACKGROUND_API_URL,
    appearanceBackgroundImageUrl: normalizeAppearanceUrl(record.appearanceBackgroundImageUrl),
    appearanceBackgroundOpacity: normalizeAppearanceOpacity(record.appearanceBackgroundOpacity),
    appearanceBackgroundBlur: normalizeAppearanceBlur(record.appearanceBackgroundBlur),
    appearanceNightMode: typeof record.appearanceNightMode === 'boolean' ? record.appearanceNightMode : false,
    textVideoBaseUrl: legacyTextVideoBaseUrl,
    textVideoApiKey: legacyTextVideoApiKey,
    textVideoModel: legacyTextVideoModel,
    textVideoTimeout: legacyTextVideoTimeout,
    textVideoApiProxy: legacyTextVideoApiProxy,
    textBaseUrl,
    textApiKey,
    textModel,
    textTimeout,
    textApiProxy,
    videoBaseUrl,
    videoApiKey,
    videoModel,
    videoTimeout,
    videoApiProxy,
    apiBalanceText: normalizeApiBalanceText(record.apiBalanceText),
    apiBalanceCurrency: typeof record.apiBalanceCurrency === 'string' ? record.apiBalanceCurrency : undefined,
    apiBalanceUpdatedAt: normalizeApiBalanceUpdatedAt(record.apiBalanceUpdatedAt),
    apiBalanceProfileId: typeof record.apiBalanceProfileId === 'string' ? record.apiBalanceProfileId : undefined,
    apiBalanceByProfileId,
    apiPriceByProfileId,
    accountApiKeyMode: normalizeAccountApiKeyMode(record.accountApiKeyMode),
    newApiAccountSessions,
    announcementDismissedDate: typeof record.announcementDismissedDate === 'string' ? record.announcementDismissedDate : undefined,
    announcementDismissedHash: typeof record.announcementDismissedHash === 'string' ? record.announcementDismissedHash : undefined,
    announcementDismissedForever: typeof record.announcementDismissedForever === 'boolean' ? record.announcementDismissedForever : false,
    agentScrollToBottomAfterSubmit: typeof record.agentScrollToBottomAfterSubmit === 'boolean' ? record.agentScrollToBottomAfterSubmit : true,
    agentMaxToolRounds: normalizeAgentMaxToolRounds(record.agentMaxToolRounds),
    agentWebSearch: typeof record.agentWebSearch === 'boolean' ? record.agentWebSearch : false,
    cloudSync: normalizeCloudSyncSettings(record.cloudSync),
    profiles,
    activeProfileId,
  }
}

export function getCustomProviderDefinition(settings: Partial<AppSettings> | unknown, provider: ApiProvider): CustomProviderDefinition | null {
  const normalized = normalizeSettings(settings)
  return normalized.customProviders.find((item) => item.id === provider) ?? null
}

export function getApiProviderLabel(settings: Partial<AppSettings> | unknown, provider: ApiProvider): string {
  if (provider === 'fal') return 'fal.ai'
  if (provider === 'openai') return 'OpenAI'
  return getCustomProviderDefinition(settings, provider)?.name ?? provider
}

export function isOpenAICompatibleProvider(settings: Partial<AppSettings> | unknown, provider: ApiProvider): boolean {
  return provider === 'openai' || Boolean(getCustomProviderDefinition(settings, provider))
}

export interface ImportedProviderSettings {
  customProviders: CustomProviderDefinition[]
  profiles: ApiProfile[]
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```$/)
  return match ? match[1].trim() : trimmed
}

export function importCustomProviderSettingsFromJson(
  jsonText: string,
  existingProviders: CustomProviderDefinition[] = [],
): ImportedProviderSettings {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripMarkdownCodeFence(jsonText))
  } catch {
    throw new Error('JSON 格式无效')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 根节点必须是对象')
  }

  const record = parsed as Record<string, unknown>

  // 包裹结构：{customProviders: [...], profiles: [...]}
  if (Array.isArray(record.customProviders)) {
    const customProviders = normalizeCustomProviderDefinitions(record.customProviders)
    if (customProviders.length === 0) {
      throw new Error('customProviders 数组中没有有效的服务商配置')
    }
    const customProviderIds = new Set(customProviders.map((provider) => provider.id))
    const profiles = Array.isArray(record.profiles)
      ? record.profiles
        .map((item) => {
          validateImportedProfileRecord(item)
          return item
        })
        .map((item) => normalizeApiProfile(item, undefined, customProviderIds))
        .filter((profile) => customProviderIds.has(profile.provider))
      : []
    return { customProviders, profiles }
  }

  // 单个 Manifest 对象：{name, submit, ...}
  const usedIds = new Set(existingProviders.map((provider) => provider.id))
  const direct = normalizeCustomProviderDefinition(parsed, usedIds)
  if (direct) return { customProviders: [direct], profiles: [] }

  throw new Error('无法识别该 JSON。请粘贴自定义服务商配置。')
}

export function importCustomProviderDefinitionFromJson(jsonText: string, existingProviders: CustomProviderDefinition[] = []): CustomProviderDefinition {
  const result = importCustomProviderSettingsFromJson(jsonText, existingProviders)
  return result.customProviders[0]
}

export function getActiveApiProfile(settings: Partial<AppSettings> | unknown): ApiProfile {
  const record = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {}
  const normalized = normalizeSettings(settings)
  const profile = normalized.profiles.find((p) => p.id === normalized.activeProfileId) ?? normalized.profiles[0] ?? createDefaultOpenAIProfile()

  return lockOpenAIProfile({
    ...profile,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : profile.apiKey,
    model: typeof record.model === 'string' ? record.model : profile.model,
    timeout: typeof record.timeout === 'number' && Number.isFinite(record.timeout) ? record.timeout : profile.timeout,
    apiMode: 'images',
    codexCli: false,
    apiProxy: record.apiProxy === true ? true : profile.apiProxy,
    responseFormatB64Json: profile.responseFormatB64Json,
    streamImages: profile.streamImages,
    streamPartialImages: profile.streamPartialImages,
  })
}

export function validateApiProfile(profile: ApiProfile): string | null {
  if (!profile.name.trim()) return '缺少名称'
  if (profile.provider !== 'fal' && !profile.baseUrl.trim() && !shouldUseApiProxyForBaseUrl(profile.apiProxy, profile.baseUrl)) return '缺少 API URL'
  if (!profile.apiKey.trim()) return '缺少 API Key'
  if (!profile.model.trim()) return '缺少模型 ID'
  return null
}

function isDefaultOpenAIProfile(profile: ApiProfile): boolean {
  return profile.id === DEFAULT_OPENAI_PROFILE_ID &&
    profile.name === '默认' &&
    profile.provider === 'openai' &&
    profile.baseUrl === LOCKED_OPENAI_BASE_URL &&
    profile.apiKey === '' &&
    profile.model === DEFAULT_IMAGES_MODEL &&
    profile.timeout === DEFAULT_API_TIMEOUT &&
    profile.apiMode === 'images' &&
    profile.codexCli === false &&
    profile.apiProxy === false &&
    profile.streamImages === IMAGE_STREAMING_ENABLED &&
    profile.streamPartialImages === DEFAULT_STREAM_PARTIAL_IMAGES
}

function hasOnlyDefaultProfiles(settings: AppSettings): boolean {
  return settings.customProviders.length === 0 &&
    settings.profiles.length === 1 &&
    settings.activeProfileId === DEFAULT_OPENAI_PROFILE_ID &&
    isDefaultOpenAIProfile(settings.profiles[0])
}

function createImportedProfileId(provider: ApiProvider, usedIds: Set<string>): string {
  let id = `${provider}-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  while (usedIds.has(id)) {
    id = `${provider}-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }
  usedIds.add(id)
  return id
}

function getApiProfileDedupKey(profile: ApiProfile): string {
  return JSON.stringify([
    profile.provider,
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    profile.apiKey.trim(),
    profile.model.trim(),
    profile.apiMode,
  ])
}

function getApiProfileConnectionKey(profile: ApiProfile): string {
  return JSON.stringify([
    profile.provider,
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    profile.model.trim(),
    profile.apiMode,
  ])
}

function hasEquivalentApiProfile(existingProfiles: ApiProfile[], importedProfile: ApiProfile): boolean {
  const dedupKey = getApiProfileDedupKey(importedProfile)
  if (existingProfiles.some((profile) => getApiProfileDedupKey(profile) === dedupKey)) return true

  // LLM-generated imports intentionally omit API Key. Reuse an existing keyed profile
  // when the provider, URL, model, and mode are otherwise identical.
  if (importedProfile.apiKey.trim()) return false
  const connectionKey = getApiProfileConnectionKey(importedProfile)
  return existingProfiles.some((profile) => getApiProfileConnectionKey(profile) === connectionKey)
}

function dedupeApiProfiles(profiles: ApiProfile[]): ApiProfile[] {
  const seen = new Set<string>()
  return profiles.filter((profile) => {
    const key = getApiProfileDedupKey(profile)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getCustomProviderDedupKey(provider: CustomProviderDefinition): string {
  return JSON.stringify([
    provider.name,
    provider.template ?? 'http-image',
    provider.submit,
    provider.editSubmit ?? null,
    provider.poll ?? null,
  ])
}

function mergeImportedCustomProviders(currentProviders: CustomProviderDefinition[], importedProviders: CustomProviderDefinition[]) {
  const providers = [...currentProviders]
  const providerIdMap = new Map<string, string>()
  const usedIds = new Set(providers.map((provider) => provider.id))
  const existingKeys = new Map(providers.map((provider) => [getCustomProviderDedupKey(provider), provider.id] as const))

  for (const provider of importedProviders) {
    const existingId = existingKeys.get(getCustomProviderDedupKey(provider))
    if (existingId) {
      providerIdMap.set(provider.id, existingId)
      continue
    }

    const normalized = normalizeCustomProviderDefinition(provider, usedIds)
    if (!normalized) continue
    providerIdMap.set(provider.id, normalized.id)
    providers.push(normalized)
    existingKeys.set(getCustomProviderDedupKey(normalized), normalized.id)
  }

  return { providers, providerIdMap }
}

export function findEquivalentApiProfile(
  settings: Partial<AppSettings> | unknown,
  importedProfile: ApiProfile,
  importedProviders: CustomProviderDefinition[] = [],
): ApiProfile | null {
  const normalized = normalizeSettings(settings)
  const importedProvider = importedProviders.find((provider) => provider.id === importedProfile.provider)
  const provider = importedProvider
    ? normalized.customProviders.find((provider) => getCustomProviderDedupKey(provider) === getCustomProviderDedupKey(importedProvider))?.id ?? importedProfile.provider
    : importedProfile.provider
  const profile = { ...importedProfile, provider }
  const dedupKey = getApiProfileDedupKey(profile)
  const exact = normalized.profiles.find((item) => getApiProfileDedupKey(item) === dedupKey)
  if (exact) return exact

  if (profile.apiKey.trim()) return null
  const connectionKey = getApiProfileConnectionKey(profile)
  return normalized.profiles.find((item) => getApiProfileConnectionKey(item) === connectionKey) ?? null
}

export function mergeImportedSettings(currentSettings: Partial<AppSettings> | unknown, importedSettings: Partial<AppSettings> | unknown): AppSettings {
  const current = normalizeSettings(currentSettings)
  const normalizedImported = normalizeSettings(importedSettings)
  const imported = normalizeSettings({
    ...normalizedImported,
    profiles: dedupeApiProfiles(normalizedImported.profiles),
  })

  if (hasOnlyDefaultProfiles(current)) {
    return imported
  }

  const usedIds = new Set(current.profiles.map((profile) => profile.id))
  const existingKeys = new Set(current.profiles.map(getApiProfileDedupKey))
  const { providers: customProviders, providerIdMap } = mergeImportedCustomProviders(current.customProviders, imported.customProviders)
  const importedProfiles = imported.profiles
    .map((profile) => providerIdMap.has(profile.provider)
      ? { ...profile, provider: providerIdMap.get(profile.provider) ?? profile.provider }
      : profile,
    )
    .filter((profile) => !existingKeys.has(getApiProfileDedupKey(profile)) && !hasEquivalentApiProfile(current.profiles, profile))
    .map((profile) => ({
      ...profile,
      id: createImportedProfileId(profile.provider, usedIds),
    }))
  const profiles = [...current.profiles, ...importedProfiles]

  return normalizeSettings({
    ...current,
    customProviders,
    profiles,
    activeProfileId: current.activeProfileId,
  })
}

export const DEFAULT_SETTINGS: AppSettings = normalizeSettings({
  baseUrl: LOCKED_OPENAI_BASE_URL,
  apiKey: '',
  model: DEFAULT_IMAGES_MODEL,
  timeout: DEFAULT_API_TIMEOUT,
  apiMode: 'images',
  codexCli: false,
  apiProxy: false,
  streamImages: IMAGE_STREAMING_ENABLED,
  streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES,
  customProviders: [],
  clearInputAfterSubmit: false,
  persistInputOnRestart: true,
  reuseTaskApiProfileTemporarily: false,
  alwaysShowRetryButton: false,
  enterSubmit: false,
  referenceImageEditAction: 'ask',
  appearanceBackgroundApiUrl: PIXIV_RANDOM_BACKGROUND_API_URL,
  appearanceBackgroundImageUrl: '',
  appearanceBackgroundOpacity: 0.28,
  appearanceBackgroundBlur: 18,
  appearanceNightMode: false,
  textVideoBaseUrl: '',
  textVideoApiKey: '',
  textVideoModel: '',
  textVideoTimeout: DEFAULT_API_TIMEOUT,
  textVideoApiProxy: false,
  textBaseUrl: '',
  textApiKey: '',
  textModel: '',
  textTimeout: DEFAULT_API_TIMEOUT,
  textApiProxy: false,
  videoBaseUrl: '',
  videoApiKey: '',
  videoModel: CANVAS_VIDEO_MODEL,
  videoTimeout: DEFAULT_API_TIMEOUT,
  videoApiProxy: false,
  agentScrollToBottomAfterSubmit: true,
  agentMaxToolRounds: DEFAULT_AGENT_MAX_TOOL_ROUNDS,
  agentWebSearch: false,
  apiPriceByProfileId: {},
  accountApiKeyMode: 'manual',
  newApiAccountSessions: {},
  cloudSync: DEFAULT_CLOUD_SYNC_SETTINGS,
})
