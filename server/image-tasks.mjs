import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const ALLOWED_ENDPOINTS = new Set(['/images/generations', '/images/edits'])
const BLOCKED_REQUEST_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'cookie',
  'host',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-wenyun-idempotency-key',
  'x-wenyun-task-client-version',
  'x-wenyun-task-timeout-ms',
])
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'openai-request-id',
  'retry-after',
  'x-request-id',
]

const DEFAULT_MAX_REQUEST_BODY_BYTES = 600 * 1024 * 1024
const DEFAULT_MAX_RESPONSE_BODY_BYTES = 600 * 1024 * 1024
const DEFAULT_TASK_TTL_MS = 30 * 60 * 1000
const DEFAULT_RESULT_READ_TTL_MS = 2 * 60 * 1000
const DEFAULT_IDEMPOTENCY_TTL_MS = 30 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000
const REQUIRED_CLIENT_VERSION = '2'

function normalizeUpstreamBaseUrl(value) {
  const parsed = new URL(value)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('IMAGE_TASK_UPSTREAM 只允许 http 或 https 地址')
  }
  return parsed.href.replace(/\/+$/, '')
}

function createUpstreamHeaders(requestHeaders) {
  const headers = new Headers()
  for (const [name, rawValue] of Object.entries(requestHeaders)) {
    const lowerName = name.toLowerCase()
    if (BLOCKED_REQUEST_HEADERS.has(lowerName) || lowerName.startsWith('sec-')) continue
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) headers.append(name, value)
    } else if (typeof rawValue === 'string') {
      headers.set(name, rawValue)
    }
  }
  // Base64 图片本身压缩收益很低，明确关闭压缩可避开大响应解压流被代理提前截断。
  headers.set('accept-encoding', 'identity')
  return headers
}

function createResponseMetadata(response) {
  const headers = {}
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(name)
    if (value) headers[name] = value
  }
  return {
    status: response.status,
    statusText: response.statusText,
    headers,
  }
}

async function readBody(request, maxBytes) {
  const chunks = []
  let totalBytes = 0
  for await (const chunk of request) {
    totalBytes += chunk.byteLength
    if (totalBytes > maxBytes) {
      const error = new Error('图片任务请求体过大')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, totalBytes)
}

async function readResponseBody(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0)

  const chunks = []
  let totalBytes = 0
  try {
    for await (const chunk of response.body) {
      totalBytes += chunk.byteLength
      if (totalBytes > maxBytes) {
        throw new Error('图片任务响应体过大')
      }
      chunks.push(chunk)
    }
  } catch (error) {
    // 将断流前已读取的字节数附加到错误，便于区分空响应与大图片传输中断。
    if (error && typeof error === 'object') error.responseBytesRead = totalBytes
    throw error
  }
  return Buffer.concat(chunks, totalBytes)
}

function getErrorDetail(error) {
  const cause = error && typeof error === 'object' ? error.cause : null
  const errorCode = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
  const causeCode = cause && typeof cause === 'object' && typeof cause.code === 'string' ? cause.code : ''
  const causeMessage = cause instanceof Error ? cause.message : ''
  const responseBytesRead = error && typeof error === 'object' && Number.isFinite(error.responseBytesRead)
    ? error.responseBytesRead
    : 0
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorCode: errorCode || causeCode || undefined,
    cause: causeMessage ? causeMessage.slice(0, 160) : undefined,
    responseBytesRead,
  }
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  response.end(JSON.stringify(payload))
}

function sendEmpty(response, statusCode, headers = {}) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    ...headers,
  })
  response.end()
}

function defaultLogger(entry) {
  process.stdout.write(`[image-tasks] ${JSON.stringify(entry)}\n`)
}

function getElapsedMs(startedAt) {
  return Math.round(performance.now() - startedAt)
}

function getRequestedTimeoutMs(request, maxTimeoutMs) {
  const requested = Number(request.headers['x-wenyun-task-timeout-ms'])
  if (!Number.isFinite(requested) || requested <= 0) return maxTimeoutMs
  return Math.max(1_000, Math.min(Math.round(requested), maxTimeoutMs))
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  if (!normalized || normalized.length > 200) return ''
  return normalized
}

function createIdempotencyScope(request, endpoint, idempotencyKey) {
  const authorization = typeof request.headers.authorization === 'string' ? request.headers.authorization : ''
  // 幂等键同时绑定上游接口和用户 Key，避免不同客户或不同任务类型互相认领。
  return createHash('sha256')
    .update(endpoint)
    .update('\0')
    .update(authorization)
    .update('\0')
    .update(idempotencyKey)
    .digest('base64url')
}

function createAccessToken() {
  return randomBytes(32).toString('base64url')
}

function tokensEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes)
}

function createTaskSnapshot(task) {
  return {
    taskId: task.id,
    status: task.status,
    endpoint: task.endpoint,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    expiresAt: task.expiresAt,
    error: task.error,
    upstream: task.upstreamMetadata,
  }
}

function parseTaskRoute(requestUrl) {
  const parsed = new URL(requestUrl, 'http://image-tasks.local')
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments[0] !== 'image-tasks' || !segments[1]) return null
  return {
    taskId: segments[1],
    action: segments[2] || 'status',
  }
}

export function createImageTaskServer(options = {}) {
  const upstreamBaseUrl = normalizeUpstreamBaseUrl(
    options.upstreamBaseUrl ?? process.env.IMAGE_TASK_UPSTREAM ?? 'http://new-api:3000/v1',
  )
  const maxRequestBodyBytes = options.maxRequestBodyBytes ?? Number(process.env.IMAGE_TASK_MAX_REQUEST_BYTES || DEFAULT_MAX_REQUEST_BODY_BYTES)
  const maxResponseBodyBytes = options.maxResponseBodyBytes ?? Number(process.env.IMAGE_TASK_MAX_RESPONSE_BYTES || DEFAULT_MAX_RESPONSE_BODY_BYTES)
  const taskTtlMs = options.taskTtlMs ?? Number(process.env.IMAGE_TASK_TTL_MS || DEFAULT_TASK_TTL_MS)
  const resultReadTtlMs = options.resultReadTtlMs ?? Number(process.env.IMAGE_TASK_RESULT_READ_TTL_MS || DEFAULT_RESULT_READ_TTL_MS)
  const idempotencyTtlMs = options.idempotencyTtlMs ?? Number(process.env.IMAGE_TASK_IDEMPOTENCY_TTL_MS || DEFAULT_IDEMPOTENCY_TTL_MS)
  const timeoutMs = options.timeoutMs ?? Number(process.env.IMAGE_TASK_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  const cleanupIntervalMs = options.cleanupIntervalMs ?? Number(process.env.IMAGE_TASK_CLEANUP_INTERVAL_MS || DEFAULT_CLEANUP_INTERVAL_MS)
  const logger = options.logger ?? defaultLogger
  const tasks = new Map()
  const idempotencyTasks = new Map()

  const cleanupExpiredTasks = () => {
    const now = Date.now()
    for (const [taskId, task] of tasks) {
      if (task.expiresAt > now) continue
      tasks.delete(taskId)
      if (task.idempotencyScope && idempotencyTasks.get(task.idempotencyScope)?.taskId === taskId) {
        idempotencyTasks.delete(task.idempotencyScope)
      }
    }
    for (const [key, entry] of idempotencyTasks) {
      if (entry.expiresAt <= now || !tasks.has(entry.taskId)) idempotencyTasks.delete(key)
    }
  }

  const cleanupTimer = setInterval(cleanupExpiredTasks, Math.max(1_000, cleanupIntervalMs))
  cleanupTimer.unref?.()

  const runTask = async (task) => {
    const startedAt = performance.now()
    let upstreamStatus
    let upstreamContentLength
    let upstreamContentEncoding
    task.status = 'running'
    task.startedAt = Date.now()
    const abortController = new AbortController()
    const timeoutTimer = setTimeout(() => abortController.abort(new Error('图片生成超过总时间限制')), task.timeoutMs)

    const log = (status, detail = {}) => {
      // 日志只记录任务状态与性能信息，不写入 Key、提示词、请求体和图片内容。
      logger({ taskId: task.id, endpoint: task.endpoint, status, elapsedMs: getElapsedMs(startedAt), ...detail })
    }

    try {
      log('upstream_started')
      const upstreamResponse = await fetch(`${upstreamBaseUrl}${task.endpoint}`, {
        method: 'POST',
        headers: task.headers,
        body: task.requestBody,
        cache: 'no-store',
        signal: abortController.signal,
      })
      upstreamStatus = upstreamResponse.status
      upstreamContentLength = upstreamResponse.headers.get('content-length') || undefined
      upstreamContentEncoding = upstreamResponse.headers.get('content-encoding') || 'identity'
      const upstreamMetadata = createResponseMetadata(upstreamResponse)
      const responseBody = await readResponseBody(upstreamResponse, maxResponseBodyBytes)
      task.upstreamMetadata = upstreamMetadata
      task.responseBody = responseBody
      task.status = 'succeeded'
      task.finishedAt = Date.now()
      task.expiresAt = task.finishedAt + taskTtlMs
      // 请求数据在上游接收后不再需要，及时释放参考图和提示词占用的内存。
      task.requestBody = null
      task.headers = null
      log('upstream_completed', {
        upstreamStatus,
        upstreamContentLength,
        upstreamContentEncoding,
        bytes: responseBody.byteLength,
      })
    } catch (error) {
      const timedOut = abortController.signal.aborted
      const message = timedOut
        ? '图片生成超过总时间限制'
        : error instanceof Error
          ? error.message
          : String(error)
      task.status = 'failed'
      task.error = {
        kind: timedOut ? 'total_timeout' : 'upstream_request',
        message,
      }
      task.finishedAt = Date.now()
      task.expiresAt = task.finishedAt + taskTtlMs
      task.requestBody = null
      task.headers = null
      log(timedOut ? 'upstream_timeout' : 'upstream_failed', {
        error: message.slice(0, 160),
        upstreamStatus,
        upstreamContentLength,
        upstreamContentEncoding,
        ...getErrorDetail(error),
      })
    } finally {
      clearTimeout(timeoutTimer)
    }
  }

  const server = createServer(async (request, response) => {
    cleanupExpiredTasks()

    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { ok: true, tasks: tasks.size })
      return
    }

    const requestUrl = new URL(request.url ?? '/', 'http://image-tasks.local')
    if (request.method === 'OPTIONS' && (requestUrl.pathname === '/image-tasks' || requestUrl.pathname.startsWith('/image-tasks/'))) {
      sendEmpty(response, 204, { Allow: 'POST, GET, DELETE, OPTIONS' })
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/image-tasks') {
      if (request.headers['x-wenyun-task-client-version'] !== REQUIRED_CLIENT_VERSION) {
        request.resume()
        // 拦住仍开着的旧页面，避免它把历史失败记录重新提交成新的付费任务。
        sendJson(response, 409, { error: { message: '页面版本已更新，请刷新页面后重新生成' } })
        return
      }

      const endpoint = requestUrl.searchParams.get('endpoint') || ''
      if (!ALLOWED_ENDPOINTS.has(endpoint)) {
        sendJson(response, 400, { error: { message: '图片任务接口不支持该上游路径' } })
        return
      }

      const idempotencyKey = normalizeIdempotencyKey(request.headers['x-wenyun-idempotency-key'])
      if (!idempotencyKey) {
        sendJson(response, 400, { error: { message: '缺少有效的图片任务幂等键' } })
        return
      }

      const idempotencyScope = createIdempotencyScope(request, endpoint, idempotencyKey)
      const existingEntry = idempotencyTasks.get(idempotencyScope)
      const existingTask = existingEntry && existingEntry.expiresAt > Date.now() ? tasks.get(existingEntry.taskId) : null
      if (existingTask) {
        request.resume()
        sendJson(response, 202, {
          ...createTaskSnapshot(existingTask),
          accessToken: existingTask.accessToken,
          reused: true,
        })
        return
      }

      const taskId = randomUUID()
      const accessToken = createAccessToken()
      const createdAt = Date.now()
      const task = {
          id: taskId,
          accessToken,
          idempotencyScope,
          endpoint,
          status: 'pending',
          requestBody: null,
          headers: null,
          responseBody: null,
          upstreamMetadata: null,
          error: null,
          timeoutMs: getRequestedTimeoutMs(request, timeoutMs),
          createdAt,
          startedAt: null,
          finishedAt: null,
          expiresAt: createdAt + Math.max(taskTtlMs, idempotencyTtlMs),
      }
      // 必须先占用幂等键再读取大请求体，两个同时到达的相同提交才不会穿透成两次上游调用。
      tasks.set(taskId, task)
      idempotencyTasks.set(idempotencyScope, { taskId, expiresAt: createdAt + idempotencyTtlMs })

      try {
        task.requestBody = await readBody(request, maxRequestBodyBytes)
        task.headers = createUpstreamHeaders(request.headers)
        void runTask(task)
        sendJson(response, 202, {
          ...createTaskSnapshot(task),
          accessToken,
          reused: false,
        })
      } catch (error) {
        const statusCode = Number(error?.statusCode) || 500
        const message = error instanceof Error ? error.message : String(error)
        task.status = 'failed'
        task.error = { kind: 'invalid_request', message }
        task.finishedAt = Date.now()
        task.expiresAt = task.finishedAt + taskTtlMs
        task.requestBody = null
        task.headers = null
        sendJson(response, statusCode, { error: { message } })
      }
      return
    }

    const route = parseTaskRoute(request.url ?? '/')
    if (!route) {
      sendJson(response, 404, { error: { message: 'Not Found' } })
      return
    }

    const task = tasks.get(route.taskId)
    const accessToken = request.headers.authorization?.replace(/^Bearer\s+/i, '') || ''
    if (!task || !tokensEqual(task.accessToken, accessToken)) {
      sendJson(response, 404, { error: { message: '图片任务不存在或已过期' } })
      return
    }

    if (request.method === 'GET' && route.action === 'status') {
      sendJson(response, 200, createTaskSnapshot(task))
      return
    }

    if (request.method === 'GET' && route.action === 'result') {
      if (task.status === 'pending' || task.status === 'running') {
        sendJson(response, 409, { error: { message: '图片任务仍在处理中' }, ...createTaskSnapshot(task) })
        return
      }
      if (task.status === 'failed') {
        sendJson(response, 422, { error: task.error, ...createTaskSnapshot(task) })
        return
      }

      const metadata = task.upstreamMetadata
      const headers = {
        ...(metadata?.headers || {}),
        'Cache-Control': 'no-store',
        'X-Wenyun-Upstream-Status': String(metadata?.status || 200),
        'X-Wenyun-Upstream-Status-Text': encodeURIComponent(metadata?.statusText || ''),
      }
      response.writeHead(200, headers)
      response.end(task.responseBody, () => {
        // 浏览器完整收到结果后只短暂保留复取窗口，降低多张 4K 并发完成时的内存占用。
        task.resultReadAt = Date.now()
        task.expiresAt = Math.min(task.expiresAt, task.resultReadAt + resultReadTtlMs)
      })
      return
    }

    if (request.method === 'DELETE' && route.action === 'status') {
      // 删除只清理已经结束的结果；运行中的上游请求继续完成，避免产生结果状态歧义。
      if (task.status === 'pending' || task.status === 'running') {
        sendJson(response, 409, { error: { message: '图片任务正在处理中，当前只停止前端查询' } })
        return
      }
      tasks.delete(task.id)
      if (idempotencyTasks.get(task.idempotencyScope)?.taskId === task.id) idempotencyTasks.delete(task.idempotencyScope)
      sendEmpty(response, 204)
      return
    }

    sendJson(response, 405, { error: { message: 'Method Not Allowed' } }, { Allow: 'GET, DELETE, OPTIONS' })
  })

  server.once('close', () => clearInterval(cleanupTimer))
  return server
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
}

if (isDirectRun()) {
  const port = Number(process.env.IMAGE_TASK_PORT || 8787)
  const host = process.env.IMAGE_TASK_HOST || '127.0.0.1'
  const server = createImageTaskServer()
  server.listen(port, host, () => {
    process.stdout.write(`[image-tasks] listening on ${host}:${port}\n`)
  })
}
