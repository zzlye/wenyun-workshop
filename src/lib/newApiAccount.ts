import type { ApiProfile, NewApiAccountSession } from '../types'
import { getLockedNewApiProxyUrl } from './devProxy'
import { parseNewApiUserBalance, type NewApiStatusInfo } from './newApi'

export const ACCOUNT_KEY_REFRESH_COOLDOWN_MS = 30 * 60 * 1000
const ACCOUNT_BOUND_TOKEN_PREFIX = '文运工坊绑定 Key'

export interface NewApiLoginPayload {
  username: string
  password: string
}

export interface NewApiRegisterPayload extends NewApiLoginPayload {
  inviteCode: string
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

type RequestMethod = 'GET' | 'POST' | 'DELETE'

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
    returnEnvelope?: boolean
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`
  if (options.userId !== undefined && options.userId !== '') headers['New-Api-User'] = String(options.userId)

  const response = await fetch(proxiedNewApiUrl(profile, path), {
    method: options.method ?? 'GET',
    cache: 'no-store',
    credentials: 'include',
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
    throw new Error(readErrorMessage(payload) || `请求失败：${response.status}`)
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
  if (expectedName && name === expectedName) return true
  return name.startsWith(ACCOUNT_BOUND_TOKEN_PREFIX)
}

function pickLatestBoundTokenRecord(tokens: Record<string, unknown>[], expectedName?: string): Record<string, unknown> | null {
  const candidates = tokens.filter((token) => isBoundToken(token, expectedName))
  return candidates[candidates.length - 1] ?? null
}

function makeBoundTokenName(username: string) {
  return `${ACCOUNT_BOUND_TOKEN_PREFIX}-${username}-${Date.now()}`
}

export async function fetchNewApiUserAccessToken(
  profile: Pick<ApiProfile, 'baseUrl'>,
  userId: number | string | undefined,
): Promise<string> {
  if (userId === undefined || userId === '') throw new Error('登录成功，但没有返回用户 ID')
  const result = await newApiRequest<unknown>(profile, '/api/user/token', { userId })
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
  const accessToken = readAccessToken(result) || await fetchNewApiUserAccessToken(profile, userId)

  const session: NewApiAccountSession = {
    siteProfileId: profile.id,
    username: payload.username.trim(),
    accessToken,
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

export async function registerNewApiAccount(profile: ApiProfile, payload: NewApiRegisterPayload): Promise<NewApiAccountSession> {
  const registrationInviteCode = payload.inviteCode.trim()
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
  if (!hasConfirmedInviter(verifiedSession)) throw new Error('邀请码无效')
  return ensureNewApiBoundKey(profile, {
    ...verifiedSession,
    registrationInviteCode,
  })
}

export async function fetchNewApiAccountBalance(profile: ApiProfile, session: NewApiAccountSession): Promise<NewApiAccountSession> {
  const fetchSelf = (accessToken: string) => newApiRequest<unknown>(profile, '/api/user/self', {
    accessToken,
    userId: session.userId,
  })
  let accessToken = session.accessToken
  let payload: unknown
  try {
    payload = await fetchSelf(accessToken)
  } catch (err) {
    try {
      // 迁移域名或重复登录后，本地保存的账号管理 Token 可能过期；优先用当前登录态静默刷新一次。
      accessToken = await fetchNewApiUserAccessToken(profile, session.userId)
      payload = await fetchSelf(accessToken)
    } catch {
      throw err
    }
  }
  const text = parseNewApiUserBalance(payload, ACCOUNT_DEFAULT_STATUS)
  if (!text) throw new Error('账号余额查询失败')
  return {
    ...session,
    accessToken,
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
): Promise<Record<string, unknown>[]> {
  const payload = await newApiRequest<unknown>(profile, '/api/token/?p=1&size=100', { accessToken, userId })
  return normalizeTokenList(payload)
}

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
  const name = makeBoundTokenName(session.username)
  const result = await newApiRequest<unknown>(profile, '/api/token/', {
    method: 'POST',
    accessToken: session.accessToken,
    userId: session.userId,
    body: {
      name,
      expired_time: -1,
      unlimited_quota: true,
    },
  })
  const directKey = readTokenKey(result)
  if (directKey && !isMaskedTokenKey(directKey)) return { key: directKey, id: readTokenId(result), name: readTokenName(result) ?? name }

  const tokens = await fetchNewApiTokens(profile, session.accessToken, session.userId)
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

export async function refreshNewApiBoundKey(profile: ApiProfile, session: NewApiAccountSession): Promise<NewApiAccountSession> {
  const now = Date.now()
  if (session.lastKeyRefreshAt && now - session.lastKeyRefreshAt < ACCOUNT_KEY_REFRESH_COOLDOWN_MS) {
    const remainingMinutes = Math.ceil((ACCOUNT_KEY_REFRESH_COOLDOWN_MS - (now - session.lastKeyRefreshAt)) / 60_000)
    throw new Error(`刷新太频繁，请 ${remainingMinutes} 分钟后再试`)
  }

  const previousId = session.boundApiKeyId
  const created = await createNewApiBoundToken(profile, session)
  if (previousId !== undefined && previousId !== created.id) {
    try {
      await deleteNewApiToken(profile, session.accessToken, previousId, session.userId)
    } catch {
      // 新 Key 已经创建成功，删除旧 Key 失败时不要影响用户继续生成。
    }
  }

  return {
    ...session,
    boundApiKey: created.key,
    boundApiKeyId: created.id,
    boundApiKeyName: created.name,
    lastKeyRefreshAt: now,
  }
}

export async function redeemNewApiCode(profile: ApiProfile, session: NewApiAccountSession, code: string): Promise<NewApiAccountSession> {
  await newApiRequest(profile, '/api/user/topup', {
    method: 'POST',
    accessToken: session.accessToken,
    userId: session.userId,
    body: { key: code.trim() },
  })
  return fetchNewApiAccountBalance(profile, session)
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
): Promise<NewApiTopupInfo> {
  const payload = await newApiRequest<unknown>(profile, '/api/user/topup/info', {
    accessToken: session.accessToken,
    userId: session.userId,
  })
  const record = getRecord(payload)
  if (!record) throw new Error('在线支付配置无效')

  const paymentMethods = readTopupPaymentMethods(record.pay_methods)
  const enabled = readBoolean(record, 'enable_online_topup')
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
): Promise<number> {
  const payload = await newApiRequest<unknown>(profile, getTopupEndpoint(paymentMethod, 'amount'), {
    method: 'POST',
    accessToken: session.accessToken,
    userId: session.userId,
    body: { amount: Math.floor(amount) },
  })
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
): Promise<NewApiPaymentOrder> {
  const normalizedAmount = Math.floor(amount)
  const body = paymentMethod === 'stripe'
    ? { amount: normalizedAmount, payment_method: 'stripe' }
    : { amount: normalizedAmount, payment_method: paymentMethod }
  const payload = await newApiRequest<unknown>(profile, getTopupEndpoint(paymentMethod, 'pay'), {
    method: 'POST',
    accessToken: session.accessToken,
    userId: session.userId,
    body,
    returnEnvelope: true,
  })
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
