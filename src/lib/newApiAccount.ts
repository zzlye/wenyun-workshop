import type { ApiProfile, NewApiAccountSession } from '../types'
import { getLockedNewApiProxyUrl } from './devProxy'
import { parseNewApiUserBalance, type NewApiStatusInfo } from './newApi'
import { hasBoundMediaApiKey } from './videoAccount'

export const ACCOUNT_KEY_REFRESH_COOLDOWN_MS = 30 * 60 * 1000
const ACCOUNT_BOUND_TOKEN_PREFIX = 'wy-bound'
// 使用独立前缀，图片令牌查找和刷新不会误选或删除视频令牌。
const VIDEO_BOUND_TOKEN_PREFIX = 'wy-video-'
const mediaKeyRequests = new Map<string, Promise<NewApiAccountSession>>()
// 保留旧品牌的绑定名称，已有账号仍能找回原来的生成密钥。
const LEGACY_ACCOUNT_BOUND_TOKEN_PREFIX = '文运工坊绑定 Key'

export interface NewApiLoginPayload {
  username: string
  password: string
}

export interface NewApiRegisterPayload extends NewApiLoginPayload {
  inviteCode?: string
}

export interface NewApiRegistrationSettings {
  inviteCodeRequired: boolean
}

export interface NewApiBoundKeyResult {
  key: string
  id?: number | string
  name?: string
}

export interface NewApiTopupPaymentMethod {
  name: string
  type: string
  minTopup: number
}

export interface NewApiTopupInfo {
  enabled: boolean
  minTopup: number
  amountOptions: number[]
  paymentMethods: NewApiTopupPaymentMethod[]
}

export type NewApiPaymentOrder =
  | { kind: 'redirect'; url: string }
  | { kind: 'form'; url: string; fields: Record<string, string> }

const ACCOUNT_DEFAULT_STATUS: NewApiStatusInfo = {
  currencySymbol: 'HUHN',
  quotaPerUnit: 500_000,
  raw: null,
}

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'
type NewApiSessionUpdated = (session: NewApiAccountSession) => void

const accountRefreshRequests = new Map<string, Promise<NewApiAccountSession>>()
// 失效状态绑定原访问令牌，其他账号和重新登录获得的新令牌不受影响。
const accountRefreshFailures = new Map<string, { error: Error; until: number }>()

function accountRefreshKey(profile: ApiProfile, session: NewApiAccountSession): string {
  return JSON.stringify([getApiRoot(profile), session.userId ?? session.username, session.authSessionId, session.accessToken])
}

function getAccountRefreshFailure(key: string): Error | undefined {
  const failure = accountRefreshFailures.get(key)
  if (!failure) return undefined
  if (performance.now() < failure.until) return failure.error
  accountRefreshFailures.delete(key)
  return undefined
}

// 保留服务端状态，区分临时网络故障与需要用户处理的账号权限错误。
class NewApiAccountRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs?: number) {
    super(message)
    this.name = 'NewApiAccountRequestError'
  }
}

export function isRetryableNewApiAccountError(error: unknown): boolean {
  if (error instanceof NewApiAccountRequestError) {
    return [408, 429, 500, 502, 503, 504].includes(error.status)
  }
  // fetch 在断网、连接中断等场景抛出 TypeError，不重试普通业务错误。
  return error instanceof TypeError || error instanceof Error && error.name === 'TimeoutError'
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function getApiRoot(profile: Pick<ApiProfile, 'baseUrl'>): string {
  return trimTrailingSlash(profile.baseUrl).replace(/\/v1$/i, '')
}

function buildNewApiUrl(profile: Pick<ApiProfile, 'baseUrl'>, path: string): string {
  const root = getApiRoot(profile)
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${root}${normalizedPath}`
}

function proxiedNewApiUrl(profile: Pick<ApiProfile, 'baseUrl'>, path: string): string {
  const url = buildNewApiUrl(profile, path)
  return getLockedNewApiProxyUrl(url) ?? url
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function getPayloadData(payload: unknown): unknown {
  const record = getRecord(payload)
  if (!record) return payload
  if ('data' in record) return record.data
  return payload
}

export function normalizeNewApiAccountErrorMessage(message: string): string {
  const value = message.trim()
  if (!value) return ''
  if (/Password.+failed on the 'min' tag/i.test(value)) return '密码至少 8 位'
  if (/Password.+failed on the 'max' tag/i.test(value)) return '密码太长，请换短一点的密码'
  if (/Username.+failed on the 'min' tag/i.test(value)) return '账号太短，请换一个更长的账号'
  if (/Username.+failed on the 'max' tag/i.test(value)) return '账号太长，请换短一点的账号'
  if (/Email.+failed/i.test(value)) return '邮箱格式不正确'
  if (/Invite|AffCode|aff_code|邀请码/i.test(value) && /invalid|failed|无效|错误/i.test(value)) return '邀请码无效'
  return value
}

function readErrorMessage(payload: unknown): string {
  if (Array.isArray(payload)) return normalizeNewApiAccountErrorMessage(payload.map(readErrorMessage).filter(Boolean).join('；'))
  const record = getRecord(payload)
  if (!record) return typeof payload === 'string' ? normalizeNewApiAccountErrorMessage(payload) : ''
  const nested = readErrorMessage(record.details) || readErrorMessage(record.errors) || readErrorMessage(record.data) || (typeof record.error === 'object' ? readErrorMessage(record.error) : '')
  const direct = getString(record.message) || getString(record.msg) || (typeof record.error === 'string' ? getString(record.error) : '')
  // NewAPI 校验失败时外层常见提示是“操作失败，请查看详情”，真正原因放在 details/data 里。
  if (nested && (!direct || /^error$/i.test(direct) || /查看详情|details/i.test(direct))) return normalizeNewApiAccountErrorMessage(nested)
  return normalizeNewApiAccountErrorMessage(direct || nested)
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function newApiRequest<T>(
  profile: Pick<ApiProfile, 'baseUrl'>,
  path: string,
  options: {
    method?: RequestMethod
    body?: unknown
    accessToken?: string
    userId?: number | string
    authSessionId?: string
    returnEnvelope?: boolean
    signal?: AbortSignal
    onServerClock?: (clock: { timestamp: number; receivedAt: number } | undefined) => void
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`
  if (options.userId !== undefined && options.userId !== '') headers['New-Api-User'] = String(options.userId)
  if (options.authSessionId) headers['X-Auth-Session'] = options.authSessionId

  const requestStartedAt = performance.now()
  const response = await fetch(proxiedNewApiUrl(profile, path), {
    method: options.method ?? 'GET',
    cache: 'no-store',
    credentials: 'include',
    ...(options.signal ? { signal: options.signal } : {}),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const payload = await readJsonSafely(response)
  const record = getRecord(payload)
  const code = record && typeof record.code === 'number' ? record.code : undefined
  const success = record && typeof record.success === 'boolean' ? record.success : undefined
  const message = record ? getString(record.message) : ''
  const businessError = /^error$/i.test(message)

  if (!response.ok || code !== undefined && code !== 0 || success === false || businessError) {
    const retryAfter = response.headers.get('Retry-After')
    const retryAfterMs = retryAfter?.trim()
      ? (/^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now())
      : NaN
    throw new NewApiAccountRequestError(
      response.status === 429 ? '请求过于频繁，请稍后再试' : readErrorMessage(payload) || `请求失败：${response.status}`,
      response.status,
      Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : undefined,
    )
  }

  if (options.onServerClock) {
    const receivedAt = performance.now()
    const serverTime = Date.parse(response.headers.get('Date') || '')
    // HTTP 时间精度为秒；保守计入一秒及请求耗时，避免慢请求延长付款窗口。
    options.onServerClock(Number.isFinite(serverTime)
      ? { timestamp: serverTime + 1000 + Math.max(0, receivedAt - requestStartedAt), receivedAt }
      : undefined)
  }

  return (options.returnEnvelope ? payload : getPayloadData(payload)) as T
}

export function readAccessToken(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim()
  const record = getRecord(payload)
  if (!record) return ''
  const direct =
    getString(record.access_token) ||
    getString(record.accessToken) ||
    getString(record.access_token_value) ||
    getString(record.accessTokenValue) ||
    getString(record.token) ||
    getString(record.session_token)
  if (direct) return direct
  for (const value of Object.values(record)) {
    const nested = getRecord(value)
    if (!nested) continue
    const token = readAccessToken(nested)
    if (token) return token
  }
  return ''
}

function readAuthSessionId(payload: unknown): string | undefined {
  const record = getRecord(payload)
  if (!record) return undefined
  const direct = getString(record.sid) || getString(record.session_id) || getString(record.sessionId)
  if (direct) return direct
  for (const key of ['session', 'data']) {
    const nested = getRecord(record[key])
    const value = nested ? readAuthSessionId(nested) : undefined
    if (value) return value
  }
  return undefined
}

function readAccessTokenExpiresAt(payload: unknown): number | undefined {
  const record = getRecord(payload)
  if (!record) return undefined
  const direct = Number(record.access_expires_at ?? record.accessExpiresAt)
  if (Number.isFinite(direct) && direct > 0) return direct
  const nested = getRecord(record.data)
  return nested ? readAccessTokenExpiresAt(nested) : undefined
}

export function isNewApiAuthenticationError(error: unknown): boolean {
  return error instanceof NewApiAccountRequestError && error.status === 401
    || error instanceof Error && /access token|unauthorized|not logged in|未登录|登录状态|AUTH_(?:TOKEN|SESSION|UNAUTHORIZED)|401/i.test(error.message)
}

async function refreshNewApiAccountSession(
  profile: ApiProfile,
  session: NewApiAccountSession,
): Promise<NewApiAccountSession> {
  const refreshKey = accountRefreshKey(profile, session)
  const previousFailure = getAccountRefreshFailure(refreshKey)
  if (previousFailure) throw previousFailure
  const existing = accountRefreshRequests.get(refreshKey)
  if (existing) return existing

  const request = (async () => {
    try {
      const payload = await newApiRequest<unknown>(profile, '/api/user/auth/refresh', {
        method: 'POST',
        authSessionId: session.authSessionId,
        returnEnvelope: true,
      })
      const accessToken = readAccessToken(payload)
      if (!accessToken) throw new Error('登录状态刷新后没有返回访问令牌')
      const refreshedPayload = getPayloadData(payload)
      const refreshedUserId = readUserId(refreshedPayload)
      const refreshedUsername = readUsername(refreshedPayload)
      if (!session.authSessionId) {
        // 历史记录没有会话 ID，只在刷新 Cookie 明确属于同一账号时自动迁移，避免串号充值。
        const sameAccount = session.userId !== undefined && refreshedUserId !== undefined
          ? String(session.userId) === String(refreshedUserId)
          : Boolean(refreshedUsername) && refreshedUsername === session.username
        if (!sameAccount) throw new Error('刷新 Cookie 与当前账号不匹配')
      }
      return {
        ...session,
        username: refreshedUsername ?? session.username,
        accessToken,
        authSessionId: readAuthSessionId(payload) ?? session.authSessionId,
        accessTokenExpiresAt: readAccessTokenExpiresAt(payload),
        userId: refreshedUserId ?? session.userId,
        email: readEmail(refreshedPayload) ?? session.email,
        displayName: readDisplayName(refreshedPayload) ?? session.displayName,
      }
    } catch (error) {
      const retryable = isRetryableNewApiAccountError(error)
      const failure = retryable && error instanceof Error ? error : new Error('登录状态已过期，请退出账号后重新登录')
      // 明确失效后停止自动续期；429 按服务端剩余窗口退避，不能靠持续轮询耗尽登录额度。
      if (!retryable || error instanceof NewApiAccountRequestError && error.status === 429) {
        if (accountRefreshFailures.size >= 128) accountRefreshFailures.delete(accountRefreshFailures.keys().next().value!)
        accountRefreshFailures.set(refreshKey, {
          error: failure,
          until: retryable ? performance.now() + (error instanceof NewApiAccountRequestError ? error.retryAfterMs ?? 60000 : 60000) : Infinity,
        })
      }
      throw failure
    }
  })()
  accountRefreshRequests.set(refreshKey, request)
  try {
    return await request
  } finally {
    if (accountRefreshRequests.get(refreshKey) === request) accountRefreshRequests.delete(refreshKey)
  }
}

async function requestWithNewApiSession<T>(
  profile: ApiProfile,
  session: NewApiAccountSession,
  request: (activeSession: NewApiAccountSession) => Promise<T>,
  onSessionUpdated?: NewApiSessionUpdated,
): Promise<T> {
  const failure = getAccountRefreshFailure(accountRefreshKey(profile, session))
  if (failure) throw failure
  try {
    return await request(session)
  } catch (error) {
    if (!isNewApiAuthenticationError(error)) throw error
    const refreshedSession = await refreshNewApiAccountSession(profile, session)
    onSessionUpdated?.(refreshedSession)
    // 只在明确鉴权失败且刷新成功后重放一次，避免支付订单被重复创建。
    return request(refreshedSession)
  }
}

// 账号功能统一沿用登录会话和续期逻辑，绝不降级为生图 Key 执行写操作。
export function requestNewApiAccountResource<T>(
  profile: ApiProfile, session: NewApiAccountSession, path: string,
  options: { method?: RequestMethod; body?: unknown; signal?: AbortSignal } = {},
  onSessionUpdated?: NewApiSessionUpdated,
): Promise<T> {
  return requestWithNewApiSession(profile, session, active => newApiRequest<T>(profile, path, {
    ...options, accessToken: active.accessToken, userId: active.userId,
  }), onSessionUpdated)
}

export function isNewApiBusinessRejection(error: unknown): boolean {
  return error instanceof NewApiAccountRequestError && error.status < 500 && ![408, 429].includes(error.status)
}

export function fetchNewApiSiteStatus(profile: ApiProfile, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const timeout = AbortSignal.timeout(30000)
  return newApiRequest(profile, '/api/status', { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
}

// 管理入口使用账号会话，绝不使用绑定的生成 Key 代替根用户登录状态。
export async function fetchNewApiAccountRole(profile: ApiProfile, session: NewApiAccountSession): Promise<number> {
  return requestWithNewApiSession(profile, session, async current => {
    const user = await newApiRequest<{ role?: number }>(profile, '/api/user/self', { accessToken: current.accessToken, userId: current.userId })
    return user.role ?? 0
  })
}

export async function fetchNewApiAccountModelCatalog(
  profile: ApiProfile,
  session: NewApiAccountSession,
  resource: 'pricing' | 'performance',
  signal?: AbortSignal,
): Promise<unknown> {
  // 价格可能包含账号专属配置，使用当前用户会话而非服务器公共代理的管理凭据。
  const path = resource === 'pricing' ? '/api/pricing' : '/api/perf-metrics/summary?hours=24'
  return requestWithNewApiSession(profile, session, current => newApiRequest(profile, path, {
    accessToken: current.accessToken, userId: current.userId, returnEnvelope: true, signal,
  }))
}

export async function requestNewApiVideoProtocol<T>(profile: ApiProfile, session: NewApiAccountSession, channelId?: number, value?: unknown): Promise<T> {
  if (channelId !== undefined && (!Number.isInteger(channelId) || channelId <= 0)) throw new Error('渠道编号无效')
  return requestWithNewApiSession(profile, session, current => newApiRequest<T>(profile, `/api/video-protocol/${channelId ?? ''}`, {
    method: value === undefined ? 'GET' : 'PUT', body: value, accessToken: current.accessToken, userId: current.userId,
  }))
}

function hasConfirmedInviter(session: Pick<NewApiAccountSession, 'inviter' | 'inviterId'>): boolean {
  if (typeof session.inviterId === 'number') return session.inviterId > 0
  if (typeof session.inviterId === 'string') {
    const value = session.inviterId.trim()
    return Boolean(value) && value !== '0'
  }
  return Boolean(session.inviter?.trim())
}

function readUserId(payload: unknown): number | string | undefined {
  const record = getRecord(payload)
  if (!record) return undefined
  const direct = record.id ?? record.user_id ?? record.userId
  if (typeof direct === 'number' || typeof direct === 'string') return direct
  const nested = getRecord(record.user)
  return nested ? readUserId(nested) : undefined
}

function readEmail(payload: unknown): string | undefined {
  const record = getRecord(payload)
  if (!record) return undefined
  const direct = getString(record.email)
  if (direct) return direct
  const nested = getRecord(record.user)
  return nested ? readEmail(nested) : undefined
}

function readDisplayName(payload: unknown): string | undefined {
  const record = getRecord(payload)
  if (!record) return undefined
  const direct = getString(record.display_name) || getString(record.displayName) || getString(record.name)
  if (direct) return direct
  const nested = getRecord(record.user)
  return nested ? readDisplayName(nested) : undefined
}

function readInviteCode(payload: unknown): string | undefined {
  const record = getRecord(payload)
  if (!record) return undefined
  const direct = getString(record.aff_code) || getString(record.affCode) || getString(record.invite_code) || getString(record.inviteCode) || getString(record.referral_code) || getString(record.referralCode)
  if (direct) return direct
  const nested = getRecord(record.user)
  return nested ? readInviteCode(nested) : undefined
}

function readInviterId(payload: unknown): number | string | undefined {
  const record = getRecord(payload)
  if (!record) return undefined
  const direct = record.inviter_id ?? record.inviterId ?? record.referrer_id ?? record.referrerId ?? record.aff_inviter_id ?? record.affInviterId
  if (typeof direct === 'number' || typeof direct === 'string') return direct
  const nested = getRecord(record.user)
  return nested ? readInviterId(nested) : undefined
}

function readInviter(payload: unknown): string | undefined {
  const record = getRecord(payload)
  if (!record) return undefined
  const direct = getString(record.inviter) || getString(record.inviter_name) || getString(record.inviterName) || getString(record.referrer) || getString(record.referrer_name) || getString(record.referrerName)
  if (direct) return direct
  const inviterRecord = getRecord(record.inviter) || getRecord(record.referrer)
  if (inviterRecord) {
    const name = getString(inviterRecord.username) || getString(inviterRecord.name) || getString(inviterRecord.display_name) || getString(inviterRecord.displayName)
    if (name) return name
  }
  const nested = getRecord(record.user)
  return nested ? readInviter(nested) : undefined
}

function readTokenKey(payload: unknown): string {
  const record = getRecord(payload)
  if (!record) return ''
  return getString(record.key) || getString(record.token) || getString(record.value)
}

function readTokenId(payload: unknown): number | string | undefined {
  const record = getRecord(payload)
  if (!record) return undefined
  const value = record.id ?? record.token_id ?? record.tokenId
  return typeof value === 'number' || typeof value === 'string' ? value : undefined
}

function readTokenName(payload: unknown): string | undefined {
  const record = getRecord(payload)
  if (!record) return undefined
  return getString(record.name) || getString(record.token_name) || getString(record.tokenName) || undefined
}

function isMaskedTokenKey(key: string): boolean {
  return key.includes('*')
}

function normalizeTokenList(payload: unknown): Record<string, unknown>[] {
  const data = getPayloadData(payload)
  const record = getRecord(data)
  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.tokens)
        ? record.tokens
        : Array.isArray(record?.data)
          ? record.data
          : []
  return list.filter((item): item is Record<string, unknown> => Boolean(getRecord(item)))
}

function isBoundToken(token: Record<string, unknown>, expectedName?: string) {
  const name = readTokenName(token) ?? ''
  if (expectedName) return name === expectedName
  // 兼容旧版中文名称，避免老用户登录时重复创建 Key。
  return name.startsWith(ACCOUNT_BOUND_TOKEN_PREFIX) || name.startsWith(LEGACY_ACCOUNT_BOUND_TOKEN_PREFIX)
}

function pickLatestBoundTokenRecord(tokens: Record<string, unknown>[], expectedName?: string): Record<string, unknown> | null {
  const candidates = tokens.filter((token) => isBoundToken(token, expectedName))
  return candidates[candidates.length - 1] ?? null
}

function makeBoundTokenName() {
  // NewAPI 按 UTF-8 字节限制名称长度，不再把可变长度的账号写入名称。
  return `${ACCOUNT_BOUND_TOKEN_PREFIX}-${Date.now().toString(36)}`
}

export async function fetchNewApiUserAccessToken(
  profile: Pick<ApiProfile, 'baseUrl'>,
  userId: number | string | undefined,
  loginAccessToken?: string,
): Promise<string> {
  if (userId === undefined || userId === '') throw new Error('登录成功，但没有返回用户 ID')
  const result = await newApiRequest<unknown>(profile, '/api/user/token', {
    accessToken: loginAccessToken,
    userId,
  })
  const accessToken = readAccessToken(result)
  if (!accessToken) throw new Error('登录成功，但没有获取到账号管理 Token')
  return accessToken
}

async function loginNewApiAccountSession(profile: ApiProfile, payload: NewApiLoginPayload): Promise<NewApiAccountSession> {
  const result = await newApiRequest<unknown>(profile, '/api/user/login', {
    method: 'POST',
    body: {
      username: payload.username.trim(),
      password: payload.password,
    },
  })
  const userId = readUserId(result)
  const loginAccessToken = readAccessToken(result)
  // 新版 NewAPI 每台设备都有独立登录会话；保留短期令牌并按 Cookie 刷新，避免登录时重置全账号管理 Token。
  const accessToken = loginAccessToken || await fetchNewApiUserAccessToken(profile, userId)

  const session: NewApiAccountSession = {
    siteProfileId: profile.id,
    username: payload.username.trim(),
    accessToken,
    authSessionId: readAuthSessionId(result),
    accessTokenExpiresAt: readAccessTokenExpiresAt(result),
    userId,
    email: readEmail(result),
    displayName: readDisplayName(result),
    inviteCode: readInviteCode(result),
    inviter: readInviter(result),
    inviterId: readInviterId(result),
  }
  return session
}

export async function loginNewApiAccount(profile: ApiProfile, payload: NewApiLoginPayload): Promise<NewApiAccountSession> {
  const session = await loginNewApiAccountSession(profile, payload)
  const boundSession = await ensureNewApiBoundKey(profile, session)
  try {
    return await fetchNewApiAccountBalance(profile, boundSession)
  } catch {
    // 登录和绑定 Key 已经成功，余额临时查询失败时保留账号可用状态。
    return boundSession
  }
}

export async function fetchNewApiRegistrationSettings(profile: Pick<ApiProfile, 'baseUrl'>): Promise<NewApiRegistrationSettings> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    // 注册规则不落本地缓存，避免后台关闭必填后客户端仍使用旧设置。
    const data = getRecord(await newApiRequest<unknown>(profile, `/api/status?_t=${Date.now()}`, { signal: controller.signal }))
    if (!data) throw new Error('注册设置无效')
    // 旧版 NewAPI 未返回开关时继续按必填处理，只有明确关闭才允许留空。
    return { inviteCodeRequired: data.register_invite_code_required !== false }
  } catch {
    throw new Error('暂时无法获取注册设置，请稍后重试')
  } finally {
    clearTimeout(timer)
  }
}

export async function registerNewApiAccount(profile: ApiProfile, payload: NewApiRegisterPayload): Promise<NewApiAccountSession> {
  const registrationInviteCode = payload.inviteCode?.trim() || undefined
  await newApiRequest(profile, '/api/user/register', {
    method: 'POST',
    body: {
      username: payload.username.trim(),
      password: payload.password,
      aff_code: registrationInviteCode,
    },
  })
  const session = await loginNewApiAccountSession(profile, payload)
  const verifiedSession = await fetchNewApiAccountBalance(profile, session)
  // 选填留空的账号没有邀请人；填写了邀请码仍核对关联，不能把邀请码丢失误报为注册成功。
  if (registrationInviteCode && !hasConfirmedInviter(verifiedSession)) throw new Error('邀请码无效')
  return ensureNewApiBoundKey(profile, {
    ...verifiedSession,
    registrationInviteCode,
  })
}

export async function fetchNewApiAccountBalance(
  profile: ApiProfile,
  session: NewApiAccountSession,
  onSessionUpdated?: NewApiSessionUpdated,
): Promise<NewApiAccountSession> {
  let activeSession = session
  let payload: unknown
  try {
    payload = await requestWithNewApiSession(profile, session, (currentSession) =>
      newApiRequest<unknown>(profile, '/api/user/self', {
        accessToken: currentSession.accessToken,
        userId: currentSession.userId,
      }), (refreshedSession) => {
      activeSession = refreshedSession
      onSessionUpdated?.(refreshedSession)
    })
  } catch (err) {
    const boundApiKey = session.boundApiKey?.trim()
    if (!boundApiKey) throw err
    // 账号登录状态彻底失效时，只用绑定 Key 查询余额，不把图片 Key 用于充值等账号写操作。
    const usage = await newApiRequest<unknown>(profile, '/api/usage/token/', { accessToken: boundApiKey })
    const usageRecord = getRecord(usage)
    const account = usageRecord ? getRecord(usageRecord.account) : null
    const text = parseNewApiUserBalance(account, ACCOUNT_DEFAULT_STATUS)
    if (!text) throw new Error('绑定 Key 未返回账号余额，请先更新 NewAPI')
    return {
      ...session,
      balanceText: text,
      balanceSource: 'user',
      balanceUpdatedAt: Date.now(),
    }
  }
  const text = parseNewApiUserBalance(payload, ACCOUNT_DEFAULT_STATUS)
  if (!text) throw new Error('账号余额查询失败')
  return {
    ...activeSession,
    inviteCode: readInviteCode(payload) ?? session.inviteCode,
    registrationInviteCode: session.registrationInviteCode,
    inviter: readInviter(payload) ?? session.inviter,
    inviterId: readInviterId(payload) ?? session.inviterId,
    balanceText: text,
    balanceSource: 'user',
    balanceUpdatedAt: Date.now(),
  }
}

export async function fetchNewApiTokens(
  profile: ApiProfile,
  accessToken: string,
  userId?: number | string,
  purpose?: 'media',
): Promise<Record<string, unknown>[]> {
  const tokens: Record<string, unknown>[] = []
  for (let page = 1; ; page++) {
    const payload = await newApiRequest<unknown>(profile, `/api/token/?p=${page}&size=100${purpose ? `&purpose=${purpose}` : ""}`, { accessToken, userId })
    const items = normalizeTokenList(payload)
    tokens.push(...items)
    const total = Number(getRecord(payload)?.total)
    // 完整读取分页，避免已有的视频令牌在下一页时重复创建。
    if (!items.length || (Number.isFinite(total) ? tokens.length >= total : items.length < 100)) return tokens
  }
}

// 新版 NewAPI 为账号预建默认媒体密钥，图片与视频绑定同一把，不改动旧令牌。
export async function ensureNewApiMediaBoundKey(profile: ApiProfile, session: NewApiAccountSession): Promise<NewApiAccountSession> {
  if (hasBoundMediaApiKey(session)) return session
  const requestId = JSON.stringify([getApiRoot(profile), session.userId, session.accessToken])
  const pending = mediaKeyRequests.get(requestId)
  if (pending) return pending
  const ensureKey = async () => {
    let activeSession = session
    const bound = await requestWithNewApiSession(profile, session, async current => {
      const tokens = await fetchNewApiTokens(profile, current.accessToken, current.userId, 'media')
      const media = tokens.filter(token => token.purpose === 'media')
      const isUsable = (token: Record<string, unknown>) => Number(token.status) === 1
        && (Number(token.expired_time) === -1 || Number(token.expired_time) > Date.now() / 1000)
      // 默认密钥被停用时直接报错，不能通过另建密钥绕过管理员的停用操作。
      const defaultToken = media.find(token => token.is_default === true)
      if (defaultToken && !isUsable(defaultToken)) throw new Error('账号默认生图和视频 Key 已停用或过期')
      const existing = defaultToken ?? media.filter(token => isUsable(token) && token.unlimited_quota === true
        && token.model_limits_enabled !== true && !getString(token.allow_ips)).sort((a, b) => Number(b.id) - Number(a.id))[0]
      if (existing) {
        const result = await toUsableBoundToken(profile, current, existing)
        if (!result) throw new Error('账号生图和视频 Key 读取失败')
        return result
      }
      return createNewApiBoundToken(profile, current)
    }, refreshed => { activeSession = refreshed })
    return bindMediaKey(activeSession, bound)
  }
  // 同页请求合并，跨标签页通过浏览器锁复用服务端已经创建的媒体密钥。
  const request = (async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(`media-account-key:${getApiRoot(profile)}:${session.userId ?? session.username}`, ensureKey)
    }
    return ensureKey()
  })()
  mediaKeyRequests.set(requestId, request)
  try { return await request } finally { mediaKeyRequests.delete(requestId) }
}

function bindMediaKey(session: NewApiAccountSession, bound: NewApiBoundKeyResult): NewApiAccountSession {
  return {
    ...session, boundApiKeyPurpose: 'media',
    boundApiKey: bound.key, boundApiKeyId: bound.id, boundApiKeyName: bound.name,
    boundVideoApiKey: bound.key, boundVideoApiKeyId: bound.id, boundVideoApiKeyName: bound.name, boundVideoApiKeyGroup: 'auto',
  }
}

// 保留原导出供设置和账号同步入口使用，内部统一为媒体凭据。
export const ensureNewApiVideoBoundKey = ensureNewApiMediaBoundKey

export async function fetchNewApiTokenFullKey(
  profile: ApiProfile,
  session: NewApiAccountSession,
  tokenId: number | string | undefined,
): Promise<string> {
  if (tokenId === undefined || tokenId === '') return ''
  const result = await newApiRequest<unknown>(profile, `/api/token/${encodeURIComponent(String(tokenId))}/key`, {
    method: 'POST',
    accessToken: session.accessToken,
    userId: session.userId,
  })
  return readTokenKey(result)
}

async function toUsableBoundToken(
  profile: ApiProfile,
  session: NewApiAccountSession,
  token: Record<string, unknown> | null,
): Promise<NewApiBoundKeyResult | null> {
  if (!token) return null
  const id = readTokenId(token)
  const name = readTokenName(token)
  const listedKey = readTokenKey(token)
  const fullKey = !listedKey || isMaskedTokenKey(listedKey)
    ? await fetchNewApiTokenFullKey(profile, session, id)
    : listedKey
  if (!fullKey || isMaskedTokenKey(fullKey)) return null
  return { key: fullKey, id, name }
}

export async function createNewApiBoundToken(profile: ApiProfile, session: NewApiAccountSession): Promise<NewApiBoundKeyResult> {
  const name = makeBoundTokenName()
  const result = await newApiRequest<unknown>(profile, '/api/token/', {
    method: 'POST',
    accessToken: session.accessToken,
    userId: session.userId,
    body: {
      name,
      ...(profile.id === 'wenyun-site' ? { purpose: 'media' } : {}),
      expired_time: -1,
      unlimited_quota: true,
    },
  })
  const directKey = readTokenKey(result)
  if (directKey && !isMaskedTokenKey(directKey)) return { key: directKey, id: readTokenId(result), name: readTokenName(result) ?? name }

  const tokens = await fetchNewApiTokens(profile, session.accessToken, session.userId, profile.id === 'wenyun-site' ? 'media' : undefined)
  const created = await toUsableBoundToken(profile, session, pickLatestBoundTokenRecord(tokens, name))
  if (!created) throw new Error('已创建账号 Key，但无法读取 Key 内容')
  return created
}

export async function deleteNewApiToken(
  profile: ApiProfile,
  accessToken: string,
  tokenId: number | string | undefined,
  userId?: number | string,
): Promise<void> {
  if (tokenId === undefined || tokenId === '') return
  await newApiRequest(profile, `/api/token/${encodeURIComponent(String(tokenId))}/`, {
    method: 'DELETE',
    accessToken,
    userId,
  })
}

export async function ensureNewApiBoundKey(profile: ApiProfile, session: NewApiAccountSession): Promise<NewApiAccountSession> {
  if (profile.id === 'wenyun-site') return ensureNewApiMediaBoundKey(profile, session)
  if (session.boundApiKey) return session

  const tokens = await fetchNewApiTokens(profile, session.accessToken, session.userId)
  const existing = await toUsableBoundToken(profile, session, pickLatestBoundTokenRecord(tokens))
  const bound = existing ?? await createNewApiBoundToken(profile, session)
  return {
    ...session,
    boundApiKey: bound.key,
    boundApiKeyId: bound.id,
    boundApiKeyName: bound.name,
  }
}

export async function refreshNewApiBoundKey(
  profile: ApiProfile,
  session: NewApiAccountSession,
  onSessionUpdated?: NewApiSessionUpdated,
): Promise<NewApiAccountSession> {
  const now = Date.now()
  if (session.lastKeyRefreshAt && now - session.lastKeyRefreshAt < ACCOUNT_KEY_REFRESH_COOLDOWN_MS) {
    const remainingMinutes = Math.ceil((ACCOUNT_KEY_REFRESH_COOLDOWN_MS - (now - session.lastKeyRefreshAt)) / 60_000)
    throw new Error(`刷新太频繁，请 ${remainingMinutes} 分钟后再试`)
  }

  let activeSession = session
  const created = await requestWithNewApiSession(profile, session, async (currentSession) => {
    activeSession = currentSession
    return createNewApiBoundToken(profile, currentSession)
  }, (refreshedSession) => {
    activeSession = refreshedSession
    onSessionUpdated?.(refreshedSession)
  })
  const previousId = activeSession.boundApiKeyId
  if (previousId !== undefined && previousId !== created.id && activeSession.boundApiKeyName?.startsWith(ACCOUNT_BOUND_TOKEN_PREFIX)) {
    try {
      await deleteNewApiToken(profile, activeSession.accessToken, previousId, activeSession.userId)
    } catch {
      // 新 Key 已经创建成功，删除旧 Key 失败时不要影响用户继续生成。
    }
  }

  return {
    ...(profile.id === 'wenyun-site' ? bindMediaKey(activeSession, created) : activeSession),
    boundApiKey: created.key,
    boundApiKeyId: created.id,
    boundApiKeyName: created.name,
    lastKeyRefreshAt: now,
  }
}

export async function redeemNewApiCode(
  profile: ApiProfile,
  session: NewApiAccountSession,
  code: string,
  onSessionUpdated?: NewApiSessionUpdated,
): Promise<NewApiAccountSession> {
  let activeSession = session
  await requestWithNewApiSession(profile, session, (currentSession) =>
    newApiRequest(profile, '/api/user/topup', {
      method: 'POST',
      accessToken: currentSession.accessToken,
      userId: currentSession.userId,
      body: { key: code.trim() },
    }), (refreshedSession) => {
    activeSession = refreshedSession
    onSessionUpdated?.(refreshedSession)
  })
  return fetchNewApiAccountBalance(profile, activeSession, onSessionUpdated)
}

function readUsername(payload: unknown): string | undefined {
  const record = getRecord(payload)
  if (!record) return undefined
  const direct = getString(record.username)
  if (direct) return direct
  for (const key of ['user', 'data']) {
    const nested = getRecord(record[key])
    const value = nested ? readUsername(nested) : undefined
    if (value) return value
  }
  return undefined
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true
}

function readPositiveNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function readJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function readTopupPaymentMethods(value: unknown): NewApiTopupPaymentMethod[] {
  return readJsonArray(value)
    .map(getRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      name: getString(item.name),
      type: getString(item.type),
      minTopup: readPositiveNumber(item.min_topup),
    }))
    .filter((item) => item.name && item.type)
}

function uniquePositiveIntegers(value: unknown): number[] {
  return [...new Set(readJsonArray(value)
    .map((item) => Math.floor(Number(item)))
    .filter((item) => Number.isFinite(item) && item > 0))]
}

export async function fetchNewApiTopupInfo(
  profile: ApiProfile,
  session: NewApiAccountSession,
  onSessionUpdated?: NewApiSessionUpdated,
): Promise<NewApiTopupInfo> {
  const payload = await requestWithNewApiSession(profile, session, (activeSession) =>
    newApiRequest<unknown>(profile, '/api/user/topup/info', {
      accessToken: activeSession.accessToken,
      userId: activeSession.userId,
    }), onSessionUpdated)
  const record = getRecord(payload)
  if (!record) throw new Error('在线支付配置无效')

  const paymentMethods = readTopupPaymentMethods(record.pay_methods)
  const enabled = readBoolean(record, 'enable_online_topup')
    || readBoolean(record, 'enable_alipay_receipt_topup')
    || readBoolean(record, 'enable_stripe_topup')
    || readBoolean(record, 'enable_waffo_topup')
    || readBoolean(record, 'enable_waffo_pancake_topup')
  const configuredMinTopup = readPositiveNumber(record.min_topup)
  const methodMinimums = paymentMethods.map((item) => item.minTopup).filter((item) => item > 0)
  const minTopup = configuredMinTopup || (methodMinimums.length ? Math.min(...methodMinimums) : 1)
  const amountOptions = uniquePositiveIntegers(record.amount_options)

  return {
    enabled: enabled && paymentMethods.length > 0,
    minTopup,
    amountOptions: amountOptions.length ? amountOptions : [minTopup, minTopup * 2, minTopup * 5, minTopup * 10],
    paymentMethods,
  }
}

function getTopupEndpoint(paymentMethod: string, action: 'amount' | 'pay'): string {
  if (paymentMethod === 'stripe') return `/api/user/stripe/${action}`
  if (paymentMethod === 'waffo') return `/api/user/waffo/${action}`
  if (paymentMethod === 'waffo_pancake' || paymentMethod === 'waffo-pancake') return `/api/user/waffo-pancake/${action}`
  return action === 'amount' ? '/api/user/amount' : '/api/user/pay'
}

export async function calculateNewApiTopupAmount(
  profile: ApiProfile,
  session: NewApiAccountSession,
  amount: number,
  paymentMethod: string,
  onSessionUpdated?: NewApiSessionUpdated,
): Promise<number> {
  const payload = await requestWithNewApiSession(profile, session, (activeSession) =>
    newApiRequest<unknown>(profile, getTopupEndpoint(paymentMethod, 'amount'), {
      method: 'POST',
      accessToken: activeSession.accessToken,
      userId: activeSession.userId,
      body: { amount: Math.floor(amount) },
    }), onSessionUpdated)
  const paymentAmount = Number(payload)
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) throw new Error('支付金额计算失败')
  return paymentAmount
}

function requireSafePaymentUrl(value: unknown): string {
  const url = getString(value)
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString()
  } catch {
    // 支付地址由 NewAPI 返回，格式异常时禁止继续跳转。
  }
  throw new Error('支付地址无效')
}

export interface NewApiReceiptOrder {
  // 仅供当前页面倒计时使用，不发送给服务端，也不持久化到本地。
  serverClock?: { timestamp: number; receivedAt: number }
  trade_no: string
  status: string
  paid_time: number
  receipt: {
    amount_cents: number
    qr_code: string
    confirmed_at: number
    expires_at: number
  }
}

function readReceiptOrder(payload: unknown): NewApiReceiptOrder {
  const order = getRecord(payload)
  const receipt = getRecord(order?.receipt)
  const amount = Number(receipt?.amount_cents)
  const expires = Number(receipt?.expires_at)
  if (!order || !receipt || !getString(order.trade_no) || !getString(order.status)
    || !Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(expires) || expires <= 0) {
    throw new Error('收款码订单数据无效')
  }
  const qrCode = getString(receipt.qr_code)
  // 收款码只允许后台已验证的支付宝地址，不把任意链接编码成付款码。
  if (qrCode) {
    let url: URL
    try { url = new URL(qrCode) } catch { throw new Error('收款码地址无效') }
    if (url.protocol !== 'https:' || url.hostname !== 'qr.alipay.com' || url.port || url.username || url.password) {
      throw new Error('收款码地址无效')
    }
  }
  return {
    trade_no: getString(order.trade_no), status: getString(order.status),
    paid_time: Number(order.paid_time) || 0,
    receipt: { amount_cents: amount, expires_at: expires, qr_code: qrCode, confirmed_at: Number(receipt.confirmed_at) || 0 },
  }
}

export async function createNewApiReceiptOrder(
  profile: ApiProfile, session: NewApiAccountSession, amount: number, onSessionUpdated?: NewApiSessionUpdated,
): Promise<NewApiReceiptOrder> {
  let serverClock: NewApiReceiptOrder['serverClock']
  const order = readReceiptOrder(await requestWithNewApiSession(profile, session, (active) =>
    newApiRequest(profile, '/api/user/alipay-receipt/pay', {
      method: 'POST', accessToken: active.accessToken, userId: active.userId, body: { amount: Math.floor(amount) },
      onServerClock: (clock) => { serverClock = clock },
    }), onSessionUpdated))
  return { ...order, ...(serverClock ? { serverClock } : {}) }
}

export async function requestNewApiReceiptOrder(
  profile: ApiProfile, session: NewApiAccountSession, tradeNo: string,
  action?: 'confirm' | 'close', onSessionUpdated?: NewApiSessionUpdated,
): Promise<NewApiReceiptOrder> {
  const path = `/api/user/alipay-receipt/order/${encodeURIComponent(tradeNo)}${action ? `/${action}` : ''}`
  let serverClock: NewApiReceiptOrder['serverClock']
  const order = readReceiptOrder(await requestWithNewApiSession(profile, session, (active) =>
    newApiRequest(profile, path, {
      method: action ? 'POST' : 'GET', accessToken: active.accessToken, userId: active.userId,
      onServerClock: (clock) => { serverClock = clock },
    }), onSessionUpdated))
  if (order.trade_no !== tradeNo) throw new Error('收款码订单编号不匹配')
  return { ...order, ...(serverClock ? { serverClock } : {}) }
}

function readPaymentFormFields(value: unknown): Record<string, string> {
  const record = getRecord(value)
  if (!record) return {}
  return Object.fromEntries(Object.entries(record)
    .filter(([, fieldValue]) => ['string', 'number', 'boolean'].includes(typeof fieldValue))
    .map(([key, fieldValue]) => [key, String(fieldValue)]))
}

export async function createNewApiTopupOrder(
  profile: ApiProfile,
  session: NewApiAccountSession,
  amount: number,
  paymentMethod: string,
  onSessionUpdated?: NewApiSessionUpdated,
): Promise<NewApiPaymentOrder> {
  const normalizedAmount = Math.floor(amount)
  const body = paymentMethod === 'stripe'
    ? { amount: normalizedAmount, payment_method: 'stripe' }
    : { amount: normalizedAmount, payment_method: paymentMethod }
  const payload = await requestWithNewApiSession(profile, session, (activeSession) =>
    newApiRequest<unknown>(profile, getTopupEndpoint(paymentMethod, 'pay'), {
      method: 'POST',
      accessToken: activeSession.accessToken,
      userId: activeSession.userId,
      body,
      returnEnvelope: true,
    }), onSessionUpdated)
  const envelope = getRecord(payload)
  const data = envelope ? envelope.data : undefined
  const dataRecord = getRecord(data)

  if (paymentMethod === 'stripe') {
    return { kind: 'redirect', url: requireSafePaymentUrl(dataRecord?.pay_link) }
  }
  if (paymentMethod === 'waffo') {
    return { kind: 'redirect', url: requireSafePaymentUrl(dataRecord?.payment_url ?? data) }
  }
  if (paymentMethod === 'waffo_pancake' || paymentMethod === 'waffo-pancake') {
    return { kind: 'redirect', url: requireSafePaymentUrl(dataRecord?.checkout_url ?? data) }
  }

  return {
    kind: 'form',
    url: requireSafePaymentUrl(envelope?.url),
    fields: readPaymentFormFields(data),
  }
}

export function maskApiKey(key?: string): string {
  const value = key?.trim() ?? ''
  if (!value) return '未创建'
  if (value.length <= 12) return `${value.slice(0, 4)}****`
  return `${value.slice(0, 6)}****${value.slice(-4)}`
}
