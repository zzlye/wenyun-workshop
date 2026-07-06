import type { CanvasProjectExportItem } from './infiniteCanvasSource/app/(user)/canvas/export-types'
import type { Asset } from './infiniteCanvasSource/stores/use-asset-store'

// ===== 设置 =====

export type ApiMode = 'images' | 'responses'
export type AppMode = 'gallery' | 'agent'
export type ReferenceImageEditAction = 'ask' | 'replace-reference' | 'add-mask'
export type BuiltInApiProvider = 'openai' | 'fal'
export type ApiProvider = BuiltInApiProvider | string
export type CustomProviderTemplate = 'http-image'
export type CloudSyncProvider =
  | 'local-file'
  | 'webdav'
  | 'google-drive'
  | 'onedrive'
  | 'dropbox'
  | 'custom-api'
  | 'baidu-netdisk'
  | 'quark-drive'
  | 'aliyundrive'
  | 'alist'
  | 'nextcloud'
  | 'jianguoyun'
  | 'synology'
  | 'cloudreve'
  | 'koofr'
  | 'yandex-disk'
  | 'box'
  | 'pcloud'
export const DEFAULT_STREAM_PARTIAL_IMAGES = 1
export const DEFAULT_AGENT_MAX_TOOL_ROUNDS = 15

export type CustomProviderRequestMethod = 'GET' | 'POST'
export type CustomProviderContentType = 'json' | 'multipart'
export type CustomProviderFileSource = 'inputImages' | 'mask'

export interface CustomProviderFileMapping {
  field: string
  source: CustomProviderFileSource
  array?: boolean
}

export interface CustomProviderResultMapping {
  imageUrlPaths?: string[]
  b64JsonPaths?: string[]
}

export interface CustomProviderSubmitMapping {
  path: string
  method?: CustomProviderRequestMethod
  contentType?: CustomProviderContentType
  query?: Record<string, string>
  body?: Record<string, unknown>
  files?: CustomProviderFileMapping[]
  taskIdPath?: string
  result?: CustomProviderResultMapping
}

export interface CustomProviderPollMapping {
  path: string
  method?: CustomProviderRequestMethod
  query?: Record<string, string>
  intervalSeconds?: number
  statusPath: string
  successValues: string[]
  failureValues: string[]
  errorPath?: string
  result: CustomProviderResultMapping
}

export interface CustomProviderDefinition {
  id: string
  name: string
  template?: CustomProviderTemplate
  submit: CustomProviderSubmitMapping
  editSubmit?: CustomProviderSubmitMapping
  poll?: CustomProviderPollMapping
}

export interface ApiProfile {
  id: string
  name: string
  provider: ApiProvider
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
  responseFormatB64Json?: boolean
  streamImages?: boolean
  streamPartialImages?: number
  providerDrafts?: Partial<Record<ApiProvider, Partial<Pick<ApiProfile, 'baseUrl' | 'model' | 'apiMode' | 'codexCli' | 'apiProxy' | 'responseFormatB64Json' | 'streamImages' | 'streamPartialImages'>>>>
}

export interface ApiBalanceSnapshot {
  text: string
  currency?: string
  updatedAt?: number
}

export interface ApiPriceSnapshotItem {
  model: string
  rawPrice: number
  text: string
}

export interface ApiPriceSnapshot {
  items: ApiPriceSnapshotItem[]
  updatedAt?: number
  found?: boolean
}

export type AccountApiKeyMode = 'manual' | 'account'

export interface NewApiAccountSession {
  siteProfileId: string
  username: string
  accessToken: string
  userId?: number | string
  email?: string
  displayName?: string
  inviteCode?: string
  /** 注册这个账号时填写的邀请码，和账号自己的 aff_code 不是同一个东西。 */
  registrationInviteCode?: string
  inviter?: string
  inviterId?: number | string
  boundApiKey?: string
  boundApiKeyId?: number | string
  boundApiKeyName?: string
  lastKeyRefreshAt?: number
  balanceText?: string
  balanceSource?: 'user'
  balanceUpdatedAt?: number
}

export interface CloudSyncSettings {
  /** 是否启用数据同步 */
  enabled: boolean
  /** 自动同步只做上传，避免导入时重复合并数据 */
  autoSync: boolean
  /** 自动同步间隔，最小 5 分钟 */
  autoSyncIntervalMinutes: number
  /** 上传/自动同步是否包含文运生成记录和图片 */
  uploadTasks: boolean
  /** 上传/自动同步是否包含画布工坊 */
  uploadCanvasProjects: boolean
  /** 上传/自动同步是否包含我的素材 */
  uploadAssets: boolean
  /** 手动拉取是否导入文运生成记录和图片 */
  pullTasks: boolean
  /** 手动拉取是否导入画布工坊 */
  pullCanvasProjects: boolean
  /** 手动拉取是否导入我的素材 */
  pullAssets: boolean
  /** 网盘或同步协议 */
  provider: CloudSyncProvider
  /** WebDAV 根地址或自定义同步接口地址 */
  endpoint: string
  /** WebDAV 用户名 */
  username: string
  /** WebDAV 密码或应用密码 */
  password: string
  /** OAuth access token 或自定义接口 Bearer Token */
  token: string
  /** Google Drive 文件夹 ID，可选 */
  folderId: string
  /** 远端目录，WebDAV/OneDrive/Dropbox/自定义接口会使用 */
  remotePath: string
  /** 远端固定备份文件名 */
  fileName: string
  /** 本地硬盘备份文件名 */
  localFileName?: string
  /** 最近一次上传成功时间 */
  lastUploadAt?: number
  /** 最近一次拉取成功时间 */
  lastPullAt?: number
  /** 最近一次自动同步检查时间 */
  lastAutoSyncAt?: number
  /** 最近一次同步错误 */
  lastError?: string
}

export interface AppSettings {
  /** 旧版单配置字段：保留用于导入/查询参数兼容，实际请求以 active profile 为准 */
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
  streamImages?: boolean
  streamPartialImages?: number
  customProviders: CustomProviderDefinition[]
  providerOrder?: string[]
  clearInputAfterSubmit: boolean
  persistInputOnRestart: boolean
  reuseTaskApiProfileTemporarily: boolean
  alwaysShowRetryButton: boolean
  enterSubmit: boolean
  referenceImageEditAction: ReferenceImageEditAction
  /** 背景随机图 API 地址，可接入 P站随机图接口 */
  appearanceBackgroundApiUrl: string
  /** 当前展示的背景图片地址 */
  appearanceBackgroundImageUrl: string
  /** 背景图片透明度，范围 0 到 1 */
  appearanceBackgroundOpacity: number
  /** 背景毛玻璃强度，单位 px */
  appearanceBackgroundBlur: number
  /** 夜间外观模式，开启后使用深色界面配色 */
  appearanceNightMode: boolean
  /** 旧版文字/视频混合 API 地址：保留用于历史配置迁移 */
  textVideoBaseUrl: string
  /** 旧版文字/视频混合 API Key：保留用于历史配置迁移 */
  textVideoApiKey: string
  /** 旧版文字/视频混合默认模型 ID：保留用于历史配置迁移 */
  textVideoModel: string
  /** 旧版文字/视频混合请求超时，单位秒：保留用于历史配置迁移 */
  textVideoTimeout: number
  /** 旧版文字/视频是否使用本地代理：保留用于历史配置迁移 */
  textVideoApiProxy: boolean
  /** 文字 API 地址，用于画布工坊文字问答 */
  textBaseUrl: string
  /** 文字 API Key */
  textApiKey: string
  /** 文字模型 ID */
  textModel: string
  /** 文字请求超时，单位秒 */
  textTimeout: number
  /** 文字 API 是否使用本地代理 */
  textApiProxy: boolean
  /** 视频 API 地址，用于画布工坊视频生成 */
  videoBaseUrl: string
  /** 视频 API Key */
  videoApiKey: string
  /** 视频模型 ID */
  videoModel: string
  /** 视频请求超时，单位秒 */
  videoTimeout: number
  /** 视频 API 是否使用本地代理 */
  videoApiProxy: boolean
  /** 最近一次查询到的 Key 余额展示文本 */
  apiBalanceText: string
  /** 最近一次余额展示使用的货币符号 */
  apiBalanceCurrency?: string
  /** 最近一次查询 Key 余额的时间戳 */
  apiBalanceUpdatedAt?: number
  /** 最近一次查询余额对应的固定配置 ID */
  apiBalanceProfileId?: string
  /** 各固定站点最近一次查询到的 Key 余额 */
  apiBalanceByProfileId: Record<string, ApiBalanceSnapshot>
  /** 各固定站点最近一次查询到的价格表 */
  apiPriceByProfileId: Record<string, ApiPriceSnapshot>
  /** 图片生成优先使用手动填写 Key，还是登录账号绑定 Key */
  accountApiKeyMode: AccountApiKeyMode
  /** 每个固定站点对应的 NewAPI 登录账号和绑定 Key */
  newApiAccountSessions: Record<string, NewApiAccountSession>
  /** 公告当天不再提醒日期，格式为 YYYY-MM-DD */
  announcementDismissedDate?: string
  /** 当天不再提醒对应的公告内容指纹，公告更新后会重新弹出 */
  announcementDismissedHash?: string
  /** 公告永久不再提醒 */
  announcementDismissedForever: boolean
  agentScrollToBottomAfterSubmit: boolean
  agentMaxToolRounds: number
  agentWebSearch: boolean
  cloudSync: CloudSyncSettings
  profiles: ApiProfile[]
  activeProfileId: string
}

// ===== 任务参数 =====

export interface TaskParams {
  size: string
  quality: 'auto' | 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  moderation: 'auto' | 'low'
  n: number
}

export const DEFAULT_PARAMS: TaskParams = {
  size: '1024x1024',
  quality: 'auto',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 1,
}

// ===== 输入图片（UI 层面） =====

export interface InputImage {
  /** IndexedDB image store 的 id（SHA-256 hash） */
  id: string
  /** data URL，用于预览 */
  dataUrl: string
}

export interface MaskDraft {
  targetImageId: string
  maskDataUrl: string
  updatedAt: number
}

// ===== 任务记录 =====

export type TaskStatus = 'running' | 'done' | 'error'

export interface TaskRecord {
  id: string
  prompt: string
  params: TaskParams
  /** 生成时使用的 Provider 类型 */
  apiProvider?: ApiProvider
  /** 生成时使用的 API 配置 ID */
  apiProfileId?: string
  /** 生成时使用的 Provider 名称 */
  apiProfileName?: string
  /** 生成时使用的 API 模式 */
  apiMode?: ApiMode
  /** 生成时使用的模型 ID */
  apiModel?: string
  /** fal.ai 队列请求 ID，用于连接断开后的结果恢复 */
  falRequestId?: string
  /** fal.ai 队列 endpoint，用于连接断开后的状态和结果查询 */
  falEndpoint?: string
  /** fal.ai 任务连接断开后是否等待自动恢复 */
  falRecoverable?: boolean
  /** 自定义异步服务商任务 ID，用于重启后继续查询结果 */
  customTaskId?: string
  /** 自定义异步任务是否等待自动恢复 */
  customRecoverable?: boolean
  /** API 返回的实际生效参数，用于标记与请求值不一致的情况 */
  actualParams?: Partial<TaskParams>
  /** 输出图片对应的实际生效参数，key 为 outputImages 中的图片 id */
  actualParamsByImage?: Record<string, Partial<TaskParams>>
  /** 输出图片对应的 API 改写提示词，key 为 outputImages 中的图片 id */
  revisedPromptByImage?: Record<string, string>
  /** 输入图片的 image store id 列表 */
  inputImageIds: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  /** 输出图片的 image store id 列表 */
  outputImages: string[]
  /** 流式生成的中间步骤图片 id 列表，仅失败时保留供排查/下载 */
  streamPartialImageIds?: string[]
  /** API 返回的原始图片 HTTP URL（非 base64 时记录） */
  rawImageUrls?: string[]
  /** 发生解析错误时的原始响应 JSON */
  rawResponsePayload?: string
  status: TaskStatus
  error: string | null
  createdAt: number
  finishedAt: number | null
  /** 总耗时毫秒 */
  elapsed: number | null
  /** 是否收藏 */
  isFavorite?: boolean
  /** 来源模式：画廊 / Agent */
  sourceMode?: AppMode
  /** Agent 对话 ID */
  agentConversationId?: string
  /** Agent 轮次 ID */
  agentRoundId?: string
  /** Agent 消息 ID */
  agentMessageId?: string
  /** Agent 图像工具调用 ID */
  agentToolCallId?: string
  /** Agent 批量图像工具调用 ID */
  agentBatchCallId?: string
  /** Agent 图像工具实际动作 */
  agentToolAction?: 'generate' | 'edit' | 'auto' | string
}

// ===== Agent 模式 =====

export type AgentMessageRole = 'user' | 'assistant'
export type AgentRoundStatus = 'running' | 'done' | 'error'

export interface AgentMessage {
  id: string
  role: AgentMessageRole
  content: string
  roundId: string
  inputImageIds?: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  outputTaskIds?: string[]
  createdAt: number
}

export interface AgentRound {
  id: string
  index: number
  parentRoundId?: string | null
  userMessageId: string
  assistantMessageId?: string
  prompt: string
  inputImageIds: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  outputTaskIds: string[]
  responseId?: string
  responseOutput?: ResponsesOutputItem[]
  status: AgentRoundStatus
  error: string | null
  createdAt: number
  finishedAt: number | null
}

export interface AgentConversation {
  id: string
  title: string
  activeRoundId?: string | null
  createdAt: number
  updatedAt: number
  rounds: AgentRound[]
  messages: AgentMessage[]
}

// ===== IndexedDB 存储的图片 =====

export interface StoredImage {
  id: string
  dataUrl: string
  /** 图片首次存储时间（ms） */
  createdAt?: number
  /** 图片来源：用户上传 / API 生成 / 遮罩 */
  source?: 'upload' | 'generated' | 'mask'
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
}

export interface StoredImageThumbnail {
  id: string
  /** 列表缩略图，用于避免卡片页解码完整 4K 原图 */
  thumbnailDataUrl: string
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
  /** 缩略图生成参数版本 */
  thumbnailVersion?: number
}

// ===== API 请求体 =====

export interface ImageGenerationRequest {
  model: string
  prompt: string
  size: string
  quality: string
  output_format: string
  moderation: string
  output_compression?: number
  n?: number
}

// ===== API 响应 =====

export interface ImageResponseItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
}

export interface ImageApiResponse {
  data?: ImageResponseItem[]
  results?: ImageResponseItem[]
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  n?: number
}

export interface ResponsesOutputItem {
  id?: string
  type?: string
  status?: string
  action?: string | Record<string, unknown>
  /** function_call: unique call id for sending back function_call_output */
  call_id?: string
  /** function_call: function name */
  name?: string
  /** function_call: JSON-encoded arguments string */
  arguments?: string
  /** function_call_output: JSON/text output string */
  output?: string
  annotations?: Array<{
    type?: string
    start_index?: number
    end_index?: number
    url?: string
    title?: string
  }>
  content?: Array<{
    type?: string
    text?: string
    annotations?: Array<{
      type?: string
      start_index?: number
      end_index?: number
      url?: string
      title?: string
    }>
  }>
  result?: string | {
    b64_json?: string
    base64?: string
    image?: string
    data?: string
  }
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  revised_prompt?: string
}

export interface ResponsesApiResponse {
  id?: string
  output?: ResponsesOutputItem[]
  tools?: Array<{
    type?: string
    size?: string
    quality?: string
    output_format?: string
    output_compression?: number
    moderation?: string
    n?: number
  }>
}

export interface FalImageFile {
  url?: string
  content_type?: string
  file_name?: string
  width?: number
  height?: number
  b64_json?: string
  base64?: string
  data?: string
}

export interface FalApiResponse {
  images?: FalImageFile[]
  image?: FalImageFile | string
  url?: string
  seed?: number
}

// ===== 导出数据 =====

/** ZIP manifest.json 格式 */
export interface ExportData {
  version: number
  exportedAt: string
  settings?: AppSettings
  tasks?: TaskRecord[]
  agentConversations?: AgentConversation[]
  canvasProjects?: CanvasProjectExportItem[]
  assets?: Asset[]
  assetFiles?: Array<{
    storageKey: string
    path: string
    mimeType: string
    bytes: number
  }>
  /** imageId → 图片信息 */
  imageFiles?: Record<string, {
    path: string
    createdAt?: number
    source?: 'upload' | 'generated' | 'mask'
    width?: number
    height?: number
  }>
  /** imageId → 缩略图信息 */
  thumbnailFiles?: Record<string, {
    path: string
    width?: number
    height?: number
    thumbnailVersion?: number
  }>
}
