import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterEach, test } from 'node:test'
import { createImageRelayServer, IMAGE_RELAY_FRAME_TYPE } from './image-relay.mjs'

// 该文件使用 Node 原生测试器运行，避免与浏览器侧 Vitest 环境混用。

const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  servers.push(server)
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

function decodeFrames(bytes) {
  const frames = []
  let offset = 0
  while (offset < bytes.byteLength) {
    assert.ok(bytes.byteLength - offset >= 5, '帧头不完整')
    const length = bytes.readUInt32BE(offset + 1)
    assert.ok(bytes.byteLength - offset - 5 >= length, '帧正文不完整')
    frames.push({
      type: bytes[offset],
      payload: bytes.subarray(offset + 5, offset + 5 + length),
    })
    offset += 5 + length
  }
  return frames
}

function jsonPayload(frame) {
  return JSON.parse(frame.payload.toString('utf8'))
}

test('等待上游期间发送心跳并完整转发 JSON 请求和响应', async () => {
  const upstreamRequests = []
  const upstream = createServer(async (req, res) => {
    const body = []
    for await (const chunk of req) body.push(chunk)
    upstreamRequests.push({
      url: req.url,
      authorization: req.headers.authorization,
      contentType: req.headers['content-type'],
      body: Buffer.concat(body).toString('utf8'),
    })
    await new Promise((resolve) => setTimeout(resolve, 85))
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Request-Id': 'upstream-request' })
    res.write('{"data":[')
    await new Promise((resolve) => setTimeout(resolve, 10))
    res.end('{"b64_json":"aW1hZ2U="}]}')
  })
  const upstreamUrl = await listen(upstream)
  const logs = []
  const relay = createImageRelayServer({
    upstreamBaseUrl: `${upstreamUrl}/v1`,
    heartbeatMs: 25,
    timeoutMs: 1_000,
    logger: (entry) => logs.push(entry),
  })
  const relayUrl = await listen(relay)

  const response = await fetch(`${relayUrl}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'gpt-image-test', prompt: 'test' }),
  })
  const frames = decodeFrames(Buffer.from(await response.arrayBuffer()))

  assert.equal(upstreamRequests.length, 1)
  assert.deepEqual(upstreamRequests[0], {
    url: '/v1/images/generations',
    authorization: 'Bearer test-key',
    contentType: 'application/json',
    body: JSON.stringify({ model: 'gpt-image-test', prompt: 'test' }),
  })
  assert.equal(frames[0].type, IMAGE_RELAY_FRAME_TYPE.accepted)
  assert.ok(frames.some((frame) => frame.type === IMAGE_RELAY_FRAME_TYPE.heartbeat))
  const responseFrameIndex = frames.findIndex((frame) => frame.type === IMAGE_RELAY_FRAME_TYPE.upstreamResponse)
  const heartbeatFrameIndex = frames.findIndex((frame) => frame.type === IMAGE_RELAY_FRAME_TYPE.heartbeat)
  assert.ok(heartbeatFrameIndex > 0 && heartbeatFrameIndex < responseFrameIndex)
  const metadata = jsonPayload(frames[responseFrameIndex])
  assert.equal(metadata.status, 200)
  assert.equal(metadata.headers['content-type'], 'application/json')
  assert.equal(metadata.headers['x-request-id'], 'upstream-request')
  const body = Buffer.concat(
    frames.filter((frame) => frame.type === IMAGE_RELAY_FRAME_TYPE.bodyChunk).map((frame) => frame.payload),
  )
  assert.equal(body.toString('utf8'), '{"data":[{"b64_json":"aW1hZ2U="}]}')
  assert.equal(frames.at(-1).type, IMAGE_RELAY_FRAME_TYPE.complete)
  assert.ok(logs.some((entry) => entry.status === 'generation_succeeded'))
  assert.ok(logs.some((entry) => entry.status === 'transfer_succeeded'))
})

test('multipart 编辑请求保持原始正文和边界', async () => {
  let captured
  const upstream = createServer(async (req, res) => {
    const body = []
    for await (const chunk of req) body.push(chunk)
    captured = {
      url: req.url,
      contentType: req.headers['content-type'],
      body: Buffer.concat(body),
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"data":[{"b64_json":"ZWRpdGVk"}]}')
  })
  const upstreamUrl = await listen(upstream)
  const relayUrl = await listen(createImageRelayServer({
    upstreamBaseUrl: `${upstreamUrl}/v1`,
    heartbeatMs: 25,
    timeoutMs: 1_000,
    logger: () => {},
  }))
  const boundary = '----wenyun-test-boundary'
  const requestBody = Buffer.from([
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="model"\r\n\r\n',
    'gpt-image-test\r\n',
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="image[]"; filename="input.png"\r\n',
    'Content-Type: image/png\r\n\r\n',
    'binary-image-data\r\n',
    `--${boundary}--\r\n`,
  ].join(''))

  const response = await fetch(`${relayUrl}/images/edits`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: requestBody,
  })
  await response.arrayBuffer()

  assert.equal(captured.url, '/v1/images/edits')
  assert.equal(captured.contentType, `multipart/form-data; boundary=${boundary}`)
  assert.deepEqual(captured.body, requestBody)
})

test('总超时只请求上游一次并返回独立错误帧', async () => {
  let requestCount = 0
  const upstream = createServer((_req, _res) => {
    requestCount += 1
  })
  const upstreamUrl = await listen(upstream)
  const relayUrl = await listen(createImageRelayServer({
    upstreamBaseUrl: `${upstreamUrl}/v1`,
    heartbeatMs: 15,
    timeoutMs: 60,
    logger: () => {},
  }))

  const response = await fetch(`${relayUrl}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const frames = decodeFrames(Buffer.from(await response.arrayBuffer()))
  const errorFrame = frames.find((frame) => frame.type === IMAGE_RELAY_FRAME_TYPE.relayError)

  assert.equal(requestCount, 1)
  assert.ok(errorFrame)
  assert.equal(jsonPayload(errorFrame).kind, 'total_timeout')
})

test('上游成功后客户断开时记录传输中断并释放请求', async () => {
  const upstream = createServer(async (req, res) => {
    for await (const _chunk of req) {
      // 必须先读完请求，再模拟持续返回大图片。
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write('{"data":[{"b64_json":"')
    const timer = setInterval(() => {
      if (res.destroyed) {
        clearInterval(timer)
        return
      }
      res.write('a'.repeat(64 * 1024))
    }, 5)
    res.once('close', () => clearInterval(timer))
  })
  const upstreamUrl = await listen(upstream)
  const logs = []
  const relayUrl = await listen(createImageRelayServer({
    upstreamBaseUrl: `${upstreamUrl}/v1`,
    heartbeatMs: 25,
    timeoutMs: 2_000,
    logger: (entry) => logs.push(entry),
  }))
  const controller = new AbortController()
  const response = await fetch(`${relayUrl}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: controller.signal,
  })
  const reader = response.body.getReader()
  let buffer = Buffer.alloc(0)
  let sawUpstreamResponse = false

  while (!sawUpstreamResponse) {
    const { value, done } = await reader.read()
    assert.equal(done, false)
    buffer = Buffer.concat([buffer, Buffer.from(value)])
    while (buffer.length >= 5) {
      const length = buffer.readUInt32BE(1)
      if (buffer.length < 5 + length) break
      const type = buffer[0]
      buffer = buffer.subarray(5 + length)
      if (type === IMAGE_RELAY_FRAME_TYPE.upstreamResponse) {
        sawUpstreamResponse = true
        break
      }
    }
  }

  controller.abort()
  await assert.rejects(reader.read())
  await assert.doesNotReject(async () => {
    const deadline = Date.now() + 1_000
    while (!logs.some((entry) => entry.status === 'transfer_interrupted')) {
      if (Date.now() >= deadline) throw new Error('没有记录传输中断')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  })
  assert.ok(logs.some((entry) => entry.status === 'generation_succeeded'))
  assert.ok(logs.some((entry) => entry.status === 'transfer_interrupted' && entry.upstreamResponded === true))
})
