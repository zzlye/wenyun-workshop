import { getLockedApiProxyPrefix } from './devProxy'
import { readRuntimeEnv } from './runtimeEnv'
import { fetchResultResponse, ResultReadTimeoutError } from './resultRequest'
import { getDesktopBridge } from './desktop'

export type ImageTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface ImageTaskReference {
  taskId: string
  accessToken: string
  idempotencyKey: string
  apiProfileId?: string
  /** 恢复占位记录只能查询认领，绝不能补发生成请求。 */
  recoverOnly?: boolean
}

/** 已提交任务凭据齐全时只允许续查，不能再次进入生成或协议转换。 */
export function hasImageTaskCredentials(reference?: Partial<ImageTaskReference> | null): boolean {
  return Boolean(reference?.taskId?.trim() && reference.accessToken?.trim())
}

/** 查询临时故障与服务端生成失败必须分开，不能通过错误文字猜测终态。 */
export class ImageTaskError extends Error {
  constructor(message: string, readonly recoverable: boolean) {
    super(message)
    this.name = 'ImageTaskError'
  }
}

interface ImageTaskSnapshot {
  taskId: string
  status: ImageTaskStatus
  error?: {
    kind?: string
    message?: string
  } | null
}

interface CreateImageTaskPayload extends ImageTaskSnapshot {
  accessToken: string
  reused?: boolean
}

const TASK_POLL_INTERVAL_MS = 5_000
const RECOVERABLE_POLL_RETRY_MS = 3_000
const IMAGE_TASK_CLIENT_VERSION = '2'

function createRandomKey(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}-${uuid}`
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isRecoverableImageTaskError(error: unknown): boolean {
  if (error instanceof ImageTaskError) return error.recoverable
  if (error instanceof ResultReadTimeoutError) return true
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return false
  const message = error instanceof Error ? error.message : String(error)
  return /network|failed to fetch|fetch failed|load failed|timeout|连接|断开|中断/i.test(message)
}

async function readTaskError(response: Response, fallback: string, readingExistingTask = false): Promise<ImageTaskError> {
  const recoverable = readingExistingTask && [408, 429, 500, 502, 503, 504].includes(response.status)
  try {
    const payload = await response.json() as { error?: { message?: string } }
    const message = payload.error?.message?.trim()
    if (message) return new ImageTaskError(message, recoverable)
  } catch {
    // 服务端错误体不可读时使用当前阶段的统一提示。
  }
  return new ImageTaskError(fallback, recoverable)
}

function taskHeaders(reference: Pick<ImageTaskReference, 'accessToken'>): HeadersInit {
  return {
    Authorization: `Bearer ${reference.accessToken}`,
  }
}

export function shouldUseImageTasks(baseUrl: string): boolean {
  // 只让文运站内置 NewAPI 使用网站异步任务；公益站和自定义接口保持原调用路径。
  return (Boolean(getDesktopBridge()) || readRuntimeEnv(import.meta.env.VITE_IMAGE_TASKS_AVAILABLE) === 'enabled')
    && getLockedApiProxyPrefix(baseUrl) === '/api-proxy/wenyun'
}

export function createImageTaskIdempotencyKey(scope = 'image'): string {
  return createRandomKey(scope.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48) || 'image')
}

async function claimImageTask(reference: ImageTaskReference, init: RequestInit, submissionError?: string): Promise<ImageTaskReference> {
  for (;;) {
    try {
      const response = await fetchResultResponse('/image-tasks/recover', {
        headers: { Authorization: new Headers(init.headers).get('authorization') || '', 'X-Wenyun-Idempotency-Key': reference.idempotencyKey },
        cache: 'no-store',
      }, { timeoutMs: 30_000 })
      if (!response.ok) {
        const error = await readTaskError(response, `认领原任务失败（HTTP ${response.status}）`, true)
        // 认领失败不能遮住首次提交的原因，也不能据此重发可能已收费的生成请求。
        if (response.status === 404 && submissionError) throw new ImageTaskError(`${submissionError}；${error.message}`, false)
        throw error
      }
      const payload = await response.json() as CreateImageTaskPayload
      if (!payload.taskId || !payload.accessToken) throw new ImageTaskError('原任务凭据无效，不能重新生成', false)
      return { ...reference, taskId: payload.taskId, accessToken: payload.accessToken }
    } catch (error) {
      if (!isRecoverableImageTaskError(error)) throw error
      await wait(RECOVERABLE_POLL_RETRY_MS)
    }
  }
}

export async function createImageTask(
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
  reference?: ImageTaskReference,
): Promise<ImageTaskReference> {
  if (reference && hasImageTaskCredentials(reference)) return reference

  if (reference?.recoverOnly) {
    return claimImageTask(reference, init)
  }

  const idempotencyKey = reference?.idempotencyKey || createImageTaskIdempotencyKey()
  // 创建请求只发送一次；响应丢失后通过只读认领恢复，不再次上传生成请求。
  let response: Response
  try {
    response = await fetchResultResponse(`/image-tasks?endpoint=${encodeURIComponent(`/${endpoint.replace(/^\/+/, '')}`)}`, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        'X-Wenyun-Idempotency-Key': idempotencyKey,
        'X-Wenyun-Task-Timeout-Ms': String(timeoutMs),
        'X-Wenyun-Task-Client-Version': IMAGE_TASK_CLIENT_VERSION,
      },
      cache: 'no-store',
    }, { timeoutMs })
  } catch (error) {
    if (!isRecoverableImageTaskError(error) && !(error instanceof DOMException && error.name === 'AbortError')) throw error
    const reason = error instanceof ResultReadTimeoutError ? '首次提交超时，受理状态未确认' : '首次提交连接中断，受理状态未确认'
    return claimImageTask({ ...reference, taskId: '', accessToken: '', idempotencyKey }, init, reason)
  }

  if ([408, 500, 502, 503, 504].includes(response.status)) {
    const error = await readTaskError(response, '未收到有效提交回执')
    return claimImageTask({ ...reference, taskId: '', accessToken: '', idempotencyKey }, init, `首次提交失败（HTTP ${response.status}）：${error.message}`)
  }

  if (!response.ok) throw await readTaskError(response, `创建图片任务失败（HTTP ${response.status}）`)
  let payload: CreateImageTaskPayload
  try { payload = await response.json() as CreateImageTaskPayload } catch { return claimImageTask({ ...reference, taskId: '', accessToken: '', idempotencyKey }, init, '首次提交回执无法读取，受理状态未确认') }
  if (!payload.taskId || !payload.accessToken) throw new Error('图片任务服务没有返回有效任务凭据')
  return {
    taskId: payload.taskId,
    accessToken: payload.accessToken,
    idempotencyKey,
    ...(reference?.apiProfileId ? { apiProfileId: reference.apiProfileId } : {}),
  }
}

export async function getImageTaskSnapshot(reference: ImageTaskReference): Promise<ImageTaskSnapshot> {
  const response = await fetchResultResponse(`/image-tasks/${encodeURIComponent(reference.taskId)}`, {
    headers: taskHeaders(reference),
    cache: 'no-store',
  }, { timeoutMs: 30_000 })
  if (!response.ok) throw await readTaskError(response, `查询图片任务失败（HTTP ${response.status}）`, true)
  return response.json() as Promise<ImageTaskSnapshot>
}

export async function waitForImageTask(reference: ImageTaskReference): Promise<ImageTaskSnapshot> {
  while (true) {
    let snapshot: ImageTaskSnapshot
    try {
      snapshot = await getImageTaskSnapshot(reference)
    } catch (error) {
      if (!isRecoverableImageTaskError(error)) throw error
      await wait(RECOVERABLE_POLL_RETRY_MS)
      continue
    }

    if (snapshot.status === 'succeeded') return snapshot
    if (snapshot.status === 'failed') {
      throw new ImageTaskError(snapshot.error?.message?.trim() || '图片生成任务失败', false)
    }
    if (!['pending', 'running'].includes(snapshot.status)) throw new ImageTaskError('任务服务返回了无法识别的状态，请保留任务记录', false)
    await wait(TASK_POLL_INTERVAL_MS)
  }
}

export async function getImageTaskResult(reference: ImageTaskReference): Promise<Response> {
  let result: { body: ArrayBuffer; status: number; statusText: string; headers: Headers } | null = null
  // 结果已经生成，临时网络故障继续读取同一份结果；过期、鉴权失败等永久错误才结束。
  while (!result) {
    try {
      const response = await fetchResultResponse(`/image-tasks/${encodeURIComponent(reference.taskId)}/result`, {
        headers: taskHeaders(reference),
        cache: 'no-store',
      })
      // 服务重启后原任务可能正在恢复，结果接口的 409 只需稍后续取。
      if (response.status === 409) throw new ImageTaskError('原任务仍在处理中', true)
      if (!response.ok) throw await readTaskError(response, `读取图片任务结果失败（HTTP ${response.status}）`, true)
      const upstreamStatus = Number(response.headers.get('x-wenyun-upstream-status') || 200)
      const upstreamStatusText = decodeURIComponent(response.headers.get('x-wenyun-upstream-status-text') || '')
      const headers = new Headers(response.headers)
      headers.delete('x-wenyun-upstream-status')
      headers.delete('x-wenyun-upstream-status-text')
      result = {
        body: await response.arrayBuffer(),
        status: Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599 ? upstreamStatus : 200,
        statusText: upstreamStatusText,
        headers,
      }
      break
    } catch (error) {
      if (!isRecoverableImageTaskError(error)) throw error
      // 图片已在任务内存中，下载中断时只重新读取结果，不会重新生成。
      await wait(RECOVERABLE_POLL_RETRY_MS)
    }
  }

  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  })
}

export async function fetchImageTask(
  endpoint: string,
  init: RequestInit,
  options: {
    timeoutMs: number
    reference?: ImageTaskReference
    onCreated?: (reference: ImageTaskReference) => void | Promise<void>
  },
): Promise<Response> {
  const reference = await createImageTask(endpoint, init, options.timeoutMs, options.reference)
  await options.onCreated?.(reference)
  await waitForImageTask(reference)
  return getImageTaskResult(reference)
}
