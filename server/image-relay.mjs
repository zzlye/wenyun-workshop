import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

export const IMAGE_RELAY_FRAME_TYPE = Object.freeze({
  accepted: 1,
  heartbeat: 2,
  upstreamResponse: 3,
  bodyChunk: 4,
  complete: 5,
  relayError: 6,
})

const IMAGE_RELAY_CONTENT_TYPE = 'application/vnd.wenyun.image-relay.v1'
const ALLOWED_ENDPOINTS = new Set(['/images/generations', '/images/edits'])
const BLOCKED_REQUEST_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'cookie',
  'host',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-wenyun-relay-timeout-ms',
])
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'openai-request-id',
  'retry-after',
  'x-request-id',
]
const MAX_BODY_FRAME_BYTES = 64 * 1024
const encoder = new TextEncoder()
// 首帧稍作填充，避免 CDN 或公司网关把极小响应块继续攒在缓冲区里。
const ACCEPTED_PADDING = ' '.repeat(2 * 1024)
const HEARTBEAT_PAYLOAD = encoder.encode(JSON.stringify({ status: 'processing', padding: ' '.repeat(512) }))

function normalizeUpstreamBaseUrl(value) {
  const parsed = new URL(value)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('IMAGE_RELAY_UPSTREAM 只允许 http 或 https 地址')
  }
  return parsed.href.replace(/\/+$/, '')
}

function createTargetUrl(upstreamBaseUrl, requestUrl) {
  const parsed = new URL(requestUrl, 'http://image-relay.local')
  if (!ALLOWED_ENDPOINTS.has(parsed.pathname)) return null
  return `${upstreamBaseUrl}${parsed.pathname}${parsed.search}`
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

function encodeJson(value) {
  return encoder.encode(JSON.stringify(value))
}

function createFrameHeader(type, payloadLength) {
  const header = Buffer.allocUnsafe(5)
  header[0] = type
  header.writeUInt32BE(payloadLength, 1)
  return header
}

async function writeBuffer(response, bytes) {
  if (response.destroyed || response.writableEnded) throw new Error('客户端连接已关闭')
  if (response.write(bytes)) return

  await new Promise((resolve, reject) => {
    const cleanup = () => {
      response.removeListener('drain', handleDrain)
      response.removeListener('close', handleClose)
      response.removeListener('error', handleError)
    }
    const handleDrain = () => {
      cleanup()
      resolve()
    }
    const handleClose = () => {
      cleanup()
      reject(new Error('客户端连接已关闭'))
    }
    const handleError = (error) => {
      cleanup()
      reject(error)
    }

    response.once('drain', handleDrain)
    response.once('close', handleClose)
    response.once('error', handleError)
  })
}

async function writeFrame(response, type, payload = new Uint8Array()) {
  await writeBuffer(response, createFrameHeader(type, payload.byteLength))
  if (payload.byteLength) await writeBuffer(response, payload)
}

function defaultLogger(entry) {
  process.stdout.write(`[image-relay] ${JSON.stringify(entry)}\n`)
}

function sendPlainResponse(response, status, message) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(message)
}

function getElapsedMs(startedAt) {
  return Math.round(performance.now() - startedAt)
}

function getRequestTimeoutMs(request, maxTimeoutMs) {
  const requested = Number(request.headers['x-wenyun-relay-timeout-ms'])
  if (!Number.isFinite(requested) || requested <= 0) return maxTimeoutMs
  return Math.max(1_000, Math.min(Math.round(requested), maxTimeoutMs))
}

export function createImageRelayServer(options = {}) {
  const upstreamBaseUrl = normalizeUpstreamBaseUrl(
    options.upstreamBaseUrl ?? process.env.IMAGE_RELAY_UPSTREAM ?? 'http://new-api:3000/v1',
  )
  const heartbeatMs = options.heartbeatMs ?? Number(process.env.IMAGE_RELAY_HEARTBEAT_MS || 10_000)
  const timeoutMs = options.timeoutMs ?? Number(process.env.IMAGE_RELAY_TIMEOUT_MS || 900_000)
  const logger = options.logger ?? defaultLogger

  return createServer(async (request, response) => {
    const targetUrl = createTargetUrl(upstreamBaseUrl, request.url ?? '/')
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify({ ok: true }))
      return
    }
    if (request.method === 'OPTIONS' && targetUrl) {
      response.writeHead(204, { Allow: 'POST, OPTIONS' })
      response.end()
      return
    }
    if (!targetUrl) {
      sendPlainResponse(response, 404, 'Not Found')
      return
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST, OPTIONS')
      sendPlainResponse(response, 405, 'Method Not Allowed')
      return
    }

    const requestId = randomUUID()
    const startedAt = performance.now()
    const endpoint = new URL(request.url, 'http://image-relay.local').pathname
    const abortController = new AbortController()
    let heartbeatTimer
    let timeoutTriggered = false
    let upstreamResponseReceived = false
    let completed = false
    let clientDisconnected = false
    let transferredBytes = 0
    let writeQueue = Promise.resolve()

    const log = (status, detail = {}) => {
      // 日志只记录状态和性能信息，禁止写入 Key、提示词、请求体或图片内容。
      logger({ requestId, endpoint, status, elapsedMs: getElapsedMs(startedAt), ...detail })
    }
    const queueFrame = (type, payload) => {
      writeQueue = writeQueue.then(() => writeFrame(response, type, payload))
      return writeQueue
    }
    const stopHeartbeat = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      heartbeatTimer = undefined
    }
    const abortForClientDisconnect = () => {
      if (completed || clientDisconnected) return
      clientDisconnected = true
      abortController.abort(new Error('客户端连接已关闭'))
    }

    response.socket?.setNoDelay(true)
    response.writeHead(200, {
      'Content-Type': IMAGE_RELAY_CONTENT_TYPE,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    })
    response.flushHeaders()
    response.once('close', abortForClientDisconnect)
    request.once('aborted', abortForClientDisconnect)

    const requestTimeoutMs = getRequestTimeoutMs(request, timeoutMs)
    const timeoutTimer = setTimeout(() => {
      timeoutTriggered = true
      abortController.abort(new Error('图片生成超过总时间限制'))
    }, requestTimeoutMs)

    try {
      await queueFrame(IMAGE_RELAY_FRAME_TYPE.accepted, encodeJson({ requestId, padding: ACCEPTED_PADDING }))
      log('request_accepted')
      heartbeatTimer = setInterval(() => {
        void queueFrame(IMAGE_RELAY_FRAME_TYPE.heartbeat, HEARTBEAT_PAYLOAD).catch(() => {})
      }, heartbeatMs)

      const upstreamResponse = await fetch(targetUrl, {
        method: 'POST',
        headers: createUpstreamHeaders(request.headers),
        body: request,
        duplex: 'half',
        cache: 'no-store',
        signal: abortController.signal,
      })
      upstreamResponseReceived = true
      stopHeartbeat()

      await queueFrame(
        IMAGE_RELAY_FRAME_TYPE.upstreamResponse,
        encodeJson(createResponseMetadata(upstreamResponse)),
      )
      log(upstreamResponse.ok ? 'generation_succeeded' : 'generation_failed', {
        upstreamStatus: upstreamResponse.status,
      })

      if (upstreamResponse.body) {
        const reader = upstreamResponse.body.getReader()
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            for (let offset = 0; offset < value.byteLength; offset += MAX_BODY_FRAME_BYTES) {
              const chunk = value.subarray(offset, Math.min(offset + MAX_BODY_FRAME_BYTES, value.byteLength))
              transferredBytes += chunk.byteLength
              await queueFrame(IMAGE_RELAY_FRAME_TYPE.bodyChunk, chunk)
            }
          }
        } finally {
          reader.releaseLock()
        }
      }

      await queueFrame(IMAGE_RELAY_FRAME_TYPE.complete, encodeJson({ bytes: transferredBytes }))
      completed = true
      response.end()
      log('transfer_succeeded', { upstreamStatus: upstreamResponse.status, bytes: transferredBytes })
    } catch (error) {
      stopHeartbeat()
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (clientDisconnected || response.destroyed || response.writableEnded) {
        log('transfer_interrupted', {
          upstreamResponded: upstreamResponseReceived,
          bytes: transferredBytes,
        })
        return
      }

      const kind = timeoutTriggered
        ? 'total_timeout'
        : upstreamResponseReceived
          ? 'upstream_transfer'
          : 'upstream_connection'
      const message = timeoutTriggered
        ? '图片生成超过总时间限制'
        : upstreamResponseReceived
          ? '图片已生成，但服务器接收图片时中断'
          : '图片生成服务连接失败，请先查询调用记录后再决定是否重试'

      try {
        await queueFrame(IMAGE_RELAY_FRAME_TYPE.relayError, encodeJson({ kind, message }))
        response.end()
      } catch {
        response.destroy()
      }
      log(timeoutTriggered ? 'total_timeout' : upstreamResponseReceived ? 'upstream_transfer_failed' : 'upstream_connection_failed', {
        bytes: transferredBytes,
        error: errorMessage.slice(0, 160),
      })
    } finally {
      clearTimeout(timeoutTimer)
      stopHeartbeat()
      response.removeListener('close', abortForClientDisconnect)
      request.removeListener('aborted', abortForClientDisconnect)
    }
  })
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
}

if (isDirectRun()) {
  const port = Number(process.env.IMAGE_RELAY_PORT || 8787)
  const host = process.env.IMAGE_RELAY_HOST || '127.0.0.1'
  const server = createImageRelayServer()
  server.listen(port, host, () => {
    process.stdout.write(`[image-relay] listening on ${host}:${port}\n`)
  })
}
