import { getLockedApiProxyPrefix } from './devProxy'

export const IMAGE_RELAY_CONTENT_TYPE = 'application/vnd.wenyun.image-relay.v1'

export const IMAGE_RELAY_FRAME_TYPE = {
  accepted: 1,
  heartbeat: 2,
  upstreamResponse: 3,
  bodyChunk: 4,
  complete: 5,
  relayError: 6,
} as const

const FRAME_HEADER_BYTES = 5
const MAX_FRAME_PAYLOAD_BYTES = 64 * 1024 * 1024
const MAX_RESPONSE_BODY_BYTES = 600 * 1024 * 1024
const decoder = new TextDecoder()

interface RelayResponseMetadata {
  status: number
  statusText?: string
  headers?: Record<string, string>
}

interface RelayErrorMetadata {
  kind?: string
  message?: string
}

function concatBytes(left: Uint8Array<ArrayBufferLike>, right: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  if (!left.byteLength) return right
  if (!right.byteLength) return left

  const result = new Uint8Array(left.byteLength + right.byteLength)
  result.set(left)
  result.set(right, left.byteLength)
  return result
}

function parseJsonFrame<T>(payload: Uint8Array, label: string): T {
  try {
    return JSON.parse(decoder.decode(payload)) as T
  } catch {
    throw new Error(`图片保活通道返回了无效的${label}`)
  }
}

function getRelayErrorMessage(metadata: RelayErrorMetadata): string {
  const message = metadata.message?.trim()
  if (message) return message

  if (metadata.kind === 'total_timeout') return '图片生成超过总时间限制'
  if (metadata.kind === 'upstream_transfer') return '图片已生成，但服务器接收图片时中断'
  return '图片生成服务连接失败，请先查询调用记录后再决定是否重试'
}

function createInterruptedError(metadata: RelayResponseMetadata | null): Error {
  if (metadata && metadata.status >= 200 && metadata.status < 300) {
    return new Error('图片已生成，但传输连接中断，请勿立即重试，避免重复扣费')
  }
  return new Error('图片生成连接中断，无法确认上游结果，请先查询调用记录后再决定是否重试')
}

function normalizeRelayHeaders(input: unknown): Headers {
  const headers = new Headers()
  if (!input || typeof input !== 'object' || Array.isArray(input)) return headers

  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string') headers.set(name, value)
  }
  return headers
}

export function shouldUseImageRelay(baseUrl: string): boolean {
  // 只代理文运站内置 NewAPI，自定义接口和公益站必须保持原调用路径。
  return getLockedApiProxyPrefix(baseUrl) === '/api-proxy/wenyun'
}

export function getImageRelayRequestUrl(path: string): string {
  const endpoint = path.replace(/^\/+/, '')
  if (endpoint !== 'images/generations' && endpoint !== 'images/edits') {
    throw new Error('图片保活通道不支持该接口')
  }
  return `/image-relay/${endpoint}`
}

export async function createImageRelayResponse(relayResponse: Response): Promise<Response> {
  const relayContentType = relayResponse.headers.get('content-type')?.toLowerCase() ?? ''
  if (!relayResponse.ok || !relayContentType.includes(IMAGE_RELAY_CONTENT_TYPE)) {
    let detail = ''
    try {
      detail = (await relayResponse.text()).trim()
    } catch {
      // 中转入口不可读时使用统一提示，不暴露 Nginx 的内部错误页面。
    }
    const suffix = relayResponse.status ? `（HTTP ${relayResponse.status}）` : ''
    throw new Error(detail && detail.length < 200
      ? `图片保活通道不可用${suffix}：${detail}`
      : `图片保活通道不可用${suffix}`)
  }
  if (!relayResponse.body) throw new Error('图片保活通道没有返回可读取的数据')

  const reader = relayResponse.body.getReader()
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array()
  let upstreamMetadata: RelayResponseMetadata | null = null
  let completed = false
  let bodyBytes = 0
  const bodyChunks: ArrayBuffer[] = []

  const processFrame = (type: number, payload: Uint8Array) => {
    if (type === IMAGE_RELAY_FRAME_TYPE.accepted || type === IMAGE_RELAY_FRAME_TYPE.heartbeat) return

    if (type === IMAGE_RELAY_FRAME_TYPE.upstreamResponse) {
      const metadata = parseJsonFrame<RelayResponseMetadata>(payload, '上游响应信息')
      if (!Number.isInteger(metadata.status) || metadata.status < 100 || metadata.status > 599) {
        throw new Error('图片保活通道返回了无效的上游状态码')
      }
      upstreamMetadata = metadata
      return
    }

    if (type === IMAGE_RELAY_FRAME_TYPE.bodyChunk) {
      if (!upstreamMetadata) throw new Error('图片保活通道在上游响应前返回了图片数据')
      bodyBytes += payload.byteLength
      if (bodyBytes > MAX_RESPONSE_BODY_BYTES) throw new Error('图片响应过大，已停止接收')
      // 显式复制为普通 ArrayBuffer，避免长期持有浏览器网络层的共享缓冲区。
      const bodyChunk = new Uint8Array(payload.byteLength)
      bodyChunk.set(payload)
      bodyChunks.push(bodyChunk.buffer)
      return
    }

    if (type === IMAGE_RELAY_FRAME_TYPE.complete) {
      if (!upstreamMetadata) throw new Error('图片保活通道缺少上游响应信息')
      const metadata = parseJsonFrame<{ bytes?: number }>(payload, '完成信息')
      if (typeof metadata.bytes === 'number' && metadata.bytes !== bodyBytes) {
        throw new Error('图片传输字节数不完整')
      }
      completed = true
      return
    }

    if (type === IMAGE_RELAY_FRAME_TYPE.relayError) {
      throw new Error(getRelayErrorMessage(parseJsonFrame<RelayErrorMetadata>(payload, '错误信息')))
    }

    throw new Error('图片保活通道返回了未知数据帧')
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value?.byteLength) buffer = concatBytes(buffer, value)

      while (buffer.byteLength >= FRAME_HEADER_BYTES) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        const payloadLength = view.getUint32(1)
        if (payloadLength > MAX_FRAME_PAYLOAD_BYTES) throw new Error('图片保活通道单帧数据过大')

        const frameLength = FRAME_HEADER_BYTES + payloadLength
        if (buffer.byteLength < frameLength) break

        const type = buffer[0]
        const payload = buffer.slice(FRAME_HEADER_BYTES, frameLength)
        buffer = buffer.slice(frameLength)
        processFrame(type, payload)
      }
    }
  } catch (error) {
    if (error instanceof Error && !/network|fetch|stream|terminated|aborted/i.test(error.message)) throw error
    throw createInterruptedError(upstreamMetadata)
  } finally {
    reader.releaseLock()
  }

  if (buffer.byteLength || !completed || !upstreamMetadata) throw createInterruptedError(upstreamMetadata)
  const metadata = upstreamMetadata as RelayResponseMetadata

  return new Response(new Blob(bodyChunks), {
    status: metadata.status,
    statusText: metadata.statusText ?? '',
    headers: normalizeRelayHeaders(metadata.headers),
  })
}

export async function fetchImageRelay(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(getImageRelayRequestUrl(path), {
    ...init,
    cache: 'no-store',
  })
  return createImageRelayResponse(response)
}
