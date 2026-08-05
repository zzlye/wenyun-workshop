import { getLockedApiProxyPrefix } from './devProxy'
import { readRuntimeEnv } from './runtimeEnv'

export type ImageTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface ImageTaskReference {
  taskId: string
  accessToken: string
  idempotencyKey: string
  apiProfileId?: string
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

const TASK_POLL_INTERVAL_MS = 2_000
const RECOVERABLE_POLL_RETRY_MS = 3_000
const CREATE_RETRY_COUNT = 3
const RESULT_RETRY_COUNT = 5

function createRandomKey(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}-${uuid}`
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRecoverableNetworkError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return false
  const message = error instanceof Error ? error.message : String(error)
  return /network|failed to fetch|fetch failed|load failed|timeout|连接|断开|中断/i.test(message)
}

async function readTaskError(response: Response, fallback: string): Promise<Error> {
  try {
    const payload = await response.json() as { error?: { message?: string } }
    const message = payload.error?.message?.trim()
    if (message) return new Error(message)
  } catch {
    // 服务端错误体不可读时使用当前阶段的统一提示。
  }
  return new Error(fallback)
}

function taskHeaders(reference: Pick<ImageTaskReference, 'accessToken'>): HeadersInit {
  return {
    Authorization: `Bearer ${reference.accessToken}`,
  }
}

export function shouldUseImageTasks(baseUrl: string): boolean {
  // 只让文运站内置 NewAPI 使用网站异步任务；公益站和自定义接口保持原调用路径。
  return readRuntimeEnv(import.meta.env.VITE_IMAGE_TASKS_AVAILABLE) === 'enabled'
    && getLockedApiProxyPrefix(baseUrl) === '/api-proxy/wenyun'
}

export function createImageTaskIdempotencyKey(scope = 'image'): string {
  return createRandomKey(scope.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48) || 'image')
}

export async function createImageTask(
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
  reference?: ImageTaskReference,
): Promise<ImageTaskReference> {
  if (reference?.taskId && reference.accessToken) return reference

  const idempotencyKey = reference?.idempotencyKey || createImageTaskIdempotencyKey()
  let response: Response | null = null
  let lastError: unknown
  for (let attempt = 0; attempt < CREATE_RETRY_COUNT; attempt += 1) {
    try {
      response = await fetch(`/image-tasks?endpoint=${encodeURIComponent(`/${endpoint.replace(/^\/+/, '')}`)}`, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers).entries()),
          'X-Wenyun-Idempotency-Key': idempotencyKey,
          'X-Wenyun-Task-Timeout-Ms': String(timeoutMs),
        },
        cache: 'no-store',
      })
      break
    } catch (error) {
      lastError = error
      if (!isRecoverableNetworkError(error) || attempt === CREATE_RETRY_COUNT - 1) throw error
      // 这里只重试同一个幂等任务，不会再次调用上游或重复扣费。
      await wait(500 * (attempt + 1))
    }
  }

  if (!response) throw lastError instanceof Error ? lastError : new Error('创建图片任务失败')
  if (!response.ok) throw await readTaskError(response, `创建图片任务失败（HTTP ${response.status}）`)
  const payload = await response.json() as CreateImageTaskPayload
  if (!payload.taskId || !payload.accessToken) throw new Error('图片任务服务没有返回有效任务凭据')
  return {
    taskId: payload.taskId,
    accessToken: payload.accessToken,
    idempotencyKey,
    ...(reference?.apiProfileId ? { apiProfileId: reference.apiProfileId } : {}),
  }
}

export async function getImageTaskSnapshot(reference: ImageTaskReference): Promise<ImageTaskSnapshot> {
  const response = await fetch(`/image-tasks/${encodeURIComponent(reference.taskId)}`, {
    headers: taskHeaders(reference),
    cache: 'no-store',
  })
  if (!response.ok) throw await readTaskError(response, `查询图片任务失败（HTTP ${response.status}）`)
  return response.json() as Promise<ImageTaskSnapshot>
}

export async function waitForImageTask(reference: ImageTaskReference): Promise<ImageTaskSnapshot> {
  while (true) {
    let snapshot: ImageTaskSnapshot
    try {
      snapshot = await getImageTaskSnapshot(reference)
    } catch (error) {
      if (!isRecoverableNetworkError(error)) throw error
      await wait(RECOVERABLE_POLL_RETRY_MS)
      continue
    }

    if (snapshot.status === 'succeeded') return snapshot
    if (snapshot.status === 'failed') {
      throw new Error(snapshot.error?.message?.trim() || '图片生成任务失败')
    }
    await wait(TASK_POLL_INTERVAL_MS)
  }
}

export async function getImageTaskResult(reference: ImageTaskReference): Promise<Response> {
  let result: { body: ArrayBuffer; status: number; statusText: string; headers: Headers } | null = null
  let lastError: unknown
  for (let attempt = 0; attempt < RESULT_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(`/image-tasks/${encodeURIComponent(reference.taskId)}/result`, {
        headers: taskHeaders(reference),
        cache: 'no-store',
      })
      if (!response.ok) throw await readTaskError(response, `读取图片任务结果失败（HTTP ${response.status}）`)
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
      lastError = error
      if (!isRecoverableNetworkError(error) || attempt === RESULT_RETRY_COUNT - 1) throw error
      // 图片已在任务内存中，下载中断时只重新读取结果，不会重新生成。
      await wait(RECOVERABLE_POLL_RETRY_MS)
    }
  }

  if (!result) throw lastError instanceof Error ? lastError : new Error('读取图片任务结果失败')
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
    onCreated?: (reference: ImageTaskReference) => void
  },
): Promise<Response> {
  const reference = await createImageTask(endpoint, init, options.timeoutMs, options.reference)
  options.onCreated?.(reference)
  await waitForImageTask(reference)
  return getImageTaskResult(reference)
}
