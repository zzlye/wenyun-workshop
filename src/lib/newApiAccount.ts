import type { ApiProfile, NewApiAccountSession } from '../types'
import { getLockedNewApiProxyUrl } from './devProxy'
import { queryNewApiBalance } from './newApi'

export const ACCOUNT_KEY_REFRESH_COOLDOWN_MS = 30 * 60 * 1000
const ACCOUNT_BOUND_TOKEN_PREFIX = '文运工坊绑定 Key'

export interface NewApiLoginPayload {
  username: string
  password: string
}

export interface NewApiRegisterPayload extends NewApiLoginPayload {
  email: string
  verificationCode: string
  inviteCode: string
}

export interface NewApiBoundKeyResult {
  key: string
  id?: number | string
  name?: string
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

function readErrorMessage(payload: unknown): string {
  const record = getRecord(payload)
  if (!record) return typeof payload === 'string' ? payload : ''
  return getString(record.message) || getString(record.msg) || getString(record.error) || readErrorMessage(record.error)
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
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`

  const response = await fetch(proxiedNewApiUrl(profile, path), {
    method: options.method ?? 'GET',
    cache: 'no-store',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const payload = await readJsonSafely(response)
  const record = getRecord(payload)
  const code = record && typeof record.code === 'number' ? record.code : undefined
  const success = record && typeof record.success === 'boolean' ? record.success : undefined

  if (!response.ok || code !== undefined && code !== 0 || success === false) {
    throw new Error(readErrorMessage(payload) || `请求失败：${response.status}`)
  }

  return getPayloadData(payload) as T
}

export function readAccessToken(payload: unknown): string {
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

function pickLatestBoundToken(tokens: Record<string, unknown>[], expectedName?: string): NewApiBoundKeyResult | null {
  const candidates = tokens.filter((token) => isBoundToken(token, expectedName))
  const token = candidates[candidates.length - 1] ?? tokens[tokens.length - 1]
  const key = token ? readTokenKey(token) : ''
  if (!token || !key) return null
  return { key, id: readTokenId(token), name: readTokenName(token) }
}

function makeBoundTokenName(username: string) {
  return `${ACCOUNT_BOUND_TOKEN_PREFIX}-${username}-${Date.now()}`
}

export async function sendNewApiEmailVerification(profile: ApiProfile, email: string): Promise<void> {
  await newApiRequest(profile, `/api/verification?email=${encodeURIComponent(email.trim())}`)
}

export async function loginNewApiAccount(profile: ApiProfile, payload: NewApiLoginPayload): Promise<NewApiAccountSession> {
  const result = await newApiRequest<unknown>(profile, '/api/user/login', {
    method: 'POST',
    body: {
      username: payload.username.trim(),
      password: payload.password,
    },
  })
  const accessToken = readAccessToken(result)
  if (!accessToken) throw new Error('登录成功但没有返回登录凭证')

  const session: NewApiAccountSession = {
    siteProfileId: profile.id,
    username: payload.username.trim(),
    accessToken,
    userId: readUserId(result),
    email: readEmail(result),
    displayName: readDisplayName(result),
  }
  return ensureNewApiBoundKey(profile, session)
}

export async function registerNewApiAccount(profile: ApiProfile, payload: NewApiRegisterPayload): Promise<NewApiAccountSession> {
  await newApiRequest(profile, '/api/user/register', {
    method: 'POST',
    body: {
      username: payload.username.trim(),
      password: payload.password,
      email: payload.email.trim(),
      verification_code: payload.verificationCode.trim(),
      aff_code: payload.inviteCode.trim(),
    },
  })
  return loginNewApiAccount(profile, payload)
}

export async function fetchNewApiAccountBalance(profile: ApiProfile, session: NewApiAccountSession): Promise<NewApiAccountSession> {
  const balance = await queryNewApiBalance({ ...profile, apiKey: session.boundApiKey || profile.apiKey })
  return {
    ...session,
    balanceText: balance.text,
    balanceUpdatedAt: balance.updatedAt,
  }
}

export async function fetchNewApiTokens(profile: ApiProfile, accessToken: string): Promise<Record<string, unknown>[]> {
  const payload = await newApiRequest<unknown>(profile, '/api/token/?p=0&page_size=100', { accessToken })
  return normalizeTokenList(payload)
}

export async function createNewApiBoundToken(profile: ApiProfile, session: NewApiAccountSession): Promise<NewApiBoundKeyResult> {
  const name = makeBoundTokenName(session.username)
  const result = await newApiRequest<unknown>(profile, '/api/token/', {
    method: 'POST',
    accessToken: session.accessToken,
    body: { name },
  })
  const directKey = readTokenKey(result)
  if (directKey) return { key: directKey, id: readTokenId(result), name: readTokenName(result) ?? name }

  const tokens = await fetchNewApiTokens(profile, session.accessToken)
  const created = pickLatestBoundToken(tokens, name)
  if (!created) throw new Error('已创建账号 Key，但无法读取 Key 内容')
  return created
}

export async function deleteNewApiToken(profile: ApiProfile, accessToken: string, tokenId: number | string | undefined): Promise<void> {
  if (tokenId === undefined || tokenId === '') return
  await newApiRequest(profile, `/api/token/${encodeURIComponent(String(tokenId))}`, {
    method: 'DELETE',
    accessToken,
  })
}

export async function ensureNewApiBoundKey(profile: ApiProfile, session: NewApiAccountSession): Promise<NewApiAccountSession> {
  if (session.boundApiKey) return session

  const tokens = await fetchNewApiTokens(profile, session.accessToken)
  const existing = pickLatestBoundToken(tokens)
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
      await deleteNewApiToken(profile, session.accessToken, previousId)
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
    body: { key: code.trim() },
  })
  return fetchNewApiAccountBalance(profile, session)
}

export function maskApiKey(key?: string): string {
  const value = key?.trim() ?? ''
  if (!value) return '未创建'
  if (value.length <= 12) return `${value.slice(0, 4)}****`
  return `${value.slice(0, 6)}****${value.slice(-4)}`
}
