import { describe, expect, it } from 'vitest'
import {
  IMAGE_RELAY_FRAME_TYPE,
  createImageRelayResponse,
  getImageRelayRequestUrl,
  shouldUseImageRelay,
} from './imageRelay'

const encoder = new TextEncoder()

function encodeFrame(type: number, payload: Uint8Array | string = new Uint8Array()): Uint8Array {
  const body = typeof payload === 'string' ? encoder.encode(payload) : payload
  const frame = new Uint8Array(5 + body.byteLength)
  const view = new DataView(frame.buffer)
  frame[0] = type
  view.setUint32(1, body.byteLength)
  frame.set(body, 5)
  return frame
}

function encodeJsonFrame(type: number, payload: unknown): Uint8Array {
  return encodeFrame(type, JSON.stringify(payload))
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function createChunkedResponse(bytes: Uint8Array, splitPoints: number[]): Response {
  const chunks: Uint8Array[] = []
  let offset = 0
  for (const point of splitPoints) {
    chunks.push(bytes.slice(offset, point))
    offset = point
  }
  chunks.push(bytes.slice(offset))

  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  }), {
    headers: { 'Content-Type': 'application/vnd.wenyun.image-relay.v1' },
  })
}

describe('image relay client protocol', () => {
  it('只对文运站内置地址启用保活通道', () => {
    expect(shouldUseImageRelay('https://api.zzlye.xyz/v1')).toBe(true)
    expect(shouldUseImageRelay('https://1520635.xyz:3901/v1')).toBe(false)
    expect(shouldUseImageRelay('https://custom.example.com/v1')).toBe(false)
    expect(getImageRelayRequestUrl('images/edits')).toBe('/image-relay/images/edits')
  })

  it('在帧头和正文被任意拆分时完整还原上游响应', async () => {
    const upstreamBody = encoder.encode(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }))
    const bytes = concatBytes(
      encodeJsonFrame(IMAGE_RELAY_FRAME_TYPE.accepted, { requestId: 'request-1' }),
      encodeFrame(IMAGE_RELAY_FRAME_TYPE.heartbeat),
      encodeJsonFrame(IMAGE_RELAY_FRAME_TYPE.upstreamResponse, {
        status: 201,
        statusText: 'Created',
        headers: { 'content-type': 'application/json', 'x-request-id': 'upstream-1' },
      }),
      encodeFrame(IMAGE_RELAY_FRAME_TYPE.bodyChunk, upstreamBody.slice(0, 7)),
      encodeFrame(IMAGE_RELAY_FRAME_TYPE.bodyChunk, upstreamBody.slice(7)),
      encodeJsonFrame(IMAGE_RELAY_FRAME_TYPE.complete, { bytes: upstreamBody.byteLength }),
    )

    const relayResponse = createChunkedResponse(bytes, [1, 4, 9, 27, 53, 91])
    const response = await createImageRelayResponse(relayResponse)

    expect(response.status).toBe(201)
    expect(response.statusText).toBe('Created')
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('x-request-id')).toBe('upstream-1')
    await expect(response.json()).resolves.toEqual({ data: [{ b64_json: 'aW1hZ2U=' }] })
  })

  it('上游成功后连接提前结束时提示图片传输中断', async () => {
    const bytes = concatBytes(
      encodeJsonFrame(IMAGE_RELAY_FRAME_TYPE.accepted, { requestId: 'request-2' }),
      encodeJsonFrame(IMAGE_RELAY_FRAME_TYPE.upstreamResponse, {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      }),
      encodeFrame(IMAGE_RELAY_FRAME_TYPE.bodyChunk, encoder.encode('{"data":')),
    )

    await expect(createImageRelayResponse(createChunkedResponse(bytes, [3, 15])))
      .rejects.toThrow('图片已生成，但传输连接中断')
  })

  it('中转服务总超时时显示独立错误且不伪装成普通等待超时', async () => {
    const bytes = concatBytes(
      encodeJsonFrame(IMAGE_RELAY_FRAME_TYPE.accepted, { requestId: 'request-3' }),
      encodeJsonFrame(IMAGE_RELAY_FRAME_TYPE.relayError, {
        kind: 'total_timeout',
        message: '图片生成超过总时间限制',
      }),
    )

    await expect(createImageRelayResponse(createChunkedResponse(bytes, [2, 17])))
      .rejects.toThrow('图片生成超过总时间限制')
  })
})
