import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterEach, test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { createImageTaskServer } from './image-tasks.mjs'

// 该文件使用 Node 原生测试器，专门验证服务端任务隔离、幂等与结果复取。

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

async function createTask(baseUrl, key, prompt) {
  const response = await fetch(`${baseUrl}/image-tasks?endpoint=/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
      'X-Wenyun-Idempotency-Key': key,
      'X-Wenyun-Task-Client-Version': '2',
    },
    body: JSON.stringify({ model: 'gpt-image-test', prompt }),
  })
  assert.equal(response.status, 202)
  return response.json()
}

async function waitForCompletion(baseUrl, task) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/image-tasks/${task.taskId}`, {
      headers: { Authorization: `Bearer ${task.accessToken}` },
    })
    const payload = await response.json()
    if (payload.status === 'succeeded' || payload.status === 'failed') return payload
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('等待图片任务完成超时')
}

test('同一个幂等键只提交一次上游请求', async () => {
  let upstreamCalls = 0
  const upstreamUrl = await listen(createServer(async (request, response) => {
    upstreamCalls += 1
    for await (const _chunk of request) {
      // 读取完整请求后再返回，模拟真实 NewAPI。
    }
    await new Promise((resolve) => setTimeout(resolve, 40))
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{"data":[{"b64_json":"b25jZQ=="}]}')
  }))
  const taskUrl = await listen(createImageTaskServer({
    upstreamBaseUrl: `${upstreamUrl}/v1`,
    logger: () => {},
    cleanupIntervalMs: 10_000,
  }))

  const first = await createTask(taskUrl, 'same-key', 'first')
  const second = await createTask(taskUrl, 'same-key', 'second')

  assert.equal(second.taskId, first.taskId)
  assert.equal(second.accessToken, first.accessToken)
  assert.equal(second.reused, true)
  await waitForCompletion(taskUrl, first)
  assert.equal(upstreamCalls, 1)
})

test('旧页面不能把历史失败记录重新提交', async () => {
  let upstreamCalls = 0
  const upstreamUrl = await listen(createServer((_request, response) => {
    upstreamCalls += 1
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{}')
  }))
  const taskUrl = await listen(createImageTaskServer({
    upstreamBaseUrl: `${upstreamUrl}/v1`,
    logger: () => {},
    cleanupIntervalMs: 10_000,
  }))

  const response = await fetch(`${taskUrl}/image-tasks?endpoint=/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
      'X-Wenyun-Idempotency-Key': 'legacy-task-key',
    },
    body: '{"prompt":"legacy"}',
  })

  assert.equal(response.status, 409)
  assert.match((await response.json()).error.message, /刷新页面/)
  assert.equal(upstreamCalls, 0)
})

test('相同幂等键并发提交时也只创建一个上游请求', async () => {
  let upstreamCalls = 0
  const upstreamUrl = await listen(createServer(async (request, response) => {
    upstreamCalls += 1
    for await (const _chunk of request) {
      // 等待两个创建请求重叠，验证服务端会在读取正文前占用幂等键。
    }
    await new Promise((resolve) => setTimeout(resolve, 40))
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{"data":[{"b64_json":"Y29uY3VycmVudA=="}]}')
  }))
  const taskUrl = await listen(createImageTaskServer({
    upstreamBaseUrl: `${upstreamUrl}/v1`,
    logger: () => {},
    cleanupIntervalMs: 10_000,
  }))

  const [first, second] = await Promise.all([
    createTask(taskUrl, 'concurrent-key', 'first'),
    createTask(taskUrl, 'concurrent-key', 'second'),
  ])

  assert.equal(first.taskId, second.taskId)
  assert.equal(first.accessToken, second.accessToken)
  await waitForCompletion(taskUrl, first)
  assert.equal(upstreamCalls, 1)
})

test('不同用户 Key 的相同幂等键互不复用', async () => {
  let upstreamCalls = 0
  const upstreamUrl = await listen(createServer(async (request, response) => {
    upstreamCalls += 1
    for await (const _chunk of request) {
      // 消费请求正文。
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{"data":[{"b64_json":"aXNvbGF0ZWQ="}]}')
  }))
  const taskUrl = await listen(createImageTaskServer({
    upstreamBaseUrl: `${upstreamUrl}/v1`,
    logger: () => {},
    cleanupIntervalMs: 10_000,
  }))

  const createForUser = (token) => fetch(`${taskUrl}/image-tasks?endpoint=/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Wenyun-Idempotency-Key': 'shared-client-key',
      'X-Wenyun-Task-Client-Version': '2',
    },
    body: '{"prompt":"same"}',
  }).then((response) => response.json())

  const [first, second] = await Promise.all([createForUser('user-a'), createForUser('user-b')])

  assert.notEqual(first.taskId, second.taskId)
  await Promise.all([waitForCompletion(taskUrl, first), waitForCompletion(taskUrl, second)])
  assert.equal(upstreamCalls, 2)
})

test('并发任务乱序完成时结果仍按任务隔离', async () => {
  const upstreamUrl = await listen(createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    await new Promise((resolve) => setTimeout(resolve, payload.prompt === 'slow' ? 80 : 15))
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ data: [{ b64_json: Buffer.from(payload.prompt).toString('base64') }] }))
  }))
  const taskUrl = await listen(createImageTaskServer({
    upstreamBaseUrl: `${upstreamUrl}/v1`,
    logger: () => {},
    cleanupIntervalMs: 10_000,
  }))

  const slow = await createTask(taskUrl, 'slow-key', 'slow')
  const fast = await createTask(taskUrl, 'fast-key', 'fast')
  await Promise.all([waitForCompletion(taskUrl, slow), waitForCompletion(taskUrl, fast)])

  const [slowResult, fastResult] = await Promise.all([
    fetch(`${taskUrl}/image-tasks/${slow.taskId}/result`, { headers: { Authorization: `Bearer ${slow.accessToken}` } }),
    fetch(`${taskUrl}/image-tasks/${fast.taskId}/result`, { headers: { Authorization: `Bearer ${fast.accessToken}` } }),
  ])
  assert.deepEqual(await slowResult.json(), { data: [{ b64_json: Buffer.from('slow').toString('base64') }] })
  assert.deepEqual(await fastResult.json(), { data: [{ b64_json: Buffer.from('fast').toString('base64') }] })
})

test('成功结果可重复读取且不会再次请求上游', async () => {
  let upstreamCalls = 0
  const upstreamUrl = await listen(createServer(async (request, response) => {
    upstreamCalls += 1
    for await (const _chunk of request) {
      // 消费请求正文。
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{"data":[{"b64_json":"cmV1c2U="}]}')
  }))
  const taskUrl = await listen(createImageTaskServer({
    upstreamBaseUrl: `${upstreamUrl}/v1`,
    logger: () => {},
    cleanupIntervalMs: 10_000,
  }))
  const task = await createTask(taskUrl, 'repeat-result', 'prompt')
  await waitForCompletion(taskUrl, task)

  const readResult = () => fetch(`${taskUrl}/image-tasks/${task.taskId}/result`, {
    headers: { Authorization: `Bearer ${task.accessToken}` },
  }).then((response) => response.text())

  assert.equal(await readResult(), '{"data":[{"b64_json":"cmV1c2U="}]}')
  assert.equal(await readResult(), '{"data":[{"b64_json":"cmV1c2U="}]}')
  assert.equal(upstreamCalls, 1)
})

test('结果完整读取后缩短内存保留时间', async () => {
  const upstreamUrl = await listen(createServer(async (request, response) => {
    for await (const _chunk of request) {
      // 消费请求正文。
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{"data":[{"b64_json":"cmVsZWFzZQ=="}]}')
  }))
  const taskUrl = await listen(createImageTaskServer({
    upstreamBaseUrl: `${upstreamUrl}/v1`,
    logger: () => {},
    taskTtlMs: 10_000,
    resultReadTtlMs: 25,
    cleanupIntervalMs: 10,
  }))
  const task = await createTask(taskUrl, 'release-result', 'prompt')
  await waitForCompletion(taskUrl, task)

  const result = await fetch(`${taskUrl}/image-tasks/${task.taskId}/result`, {
    headers: { Authorization: `Bearer ${task.accessToken}` },
  })
  assert.equal(result.status, 200)
  await result.arrayBuffer()
  await new Promise((resolve) => setTimeout(resolve, 80))

  const expired = await fetch(`${taskUrl}/image-tasks/${task.taskId}`, {
    headers: { Authorization: `Bearer ${task.accessToken}` },
  })
  assert.equal(expired.status, 404)
})

test('错误访问令牌不能读取其他并发任务', async () => {
  const upstreamUrl = await listen(createServer(async (request, response) => {
    for await (const _chunk of request) {
      // 消费请求正文。
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{"data":[{"b64_json":"b2s="}]}')
  }))
  const taskUrl = await listen(createImageTaskServer({
    upstreamBaseUrl: `${upstreamUrl}/v1`,
    logger: () => {},
    cleanupIntervalMs: 10_000,
  }))
  const first = await createTask(taskUrl, 'owner-a', 'a')
  const second = await createTask(taskUrl, 'owner-b', 'b')

  const response = await fetch(`${taskUrl}/image-tasks/${first.taskId}`, {
    headers: { Authorization: `Bearer ${second.accessToken}` },
  })
  assert.equal(response.status, 404)
})

test('大型图片结果明确请求未压缩响应，避免压缩流中断', async () => {
  const base64 = Buffer.alloc(8 * 1024 * 1024, 7).toString('base64')
  const responseText = JSON.stringify({ data: [{ b64_json: base64 }] })
  let receivedAcceptEncoding = ''
  const upstreamUrl = await listen(createServer(async (request, response) => {
    receivedAcceptEncoding = request.headers['accept-encoding'] || ''
    for await (const _chunk of request) {
      // 消费请求正文。
    }
    if (receivedAcceptEncoding !== 'identity') {
      const compressed = gzipSync(responseText)
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Content-Length': compressed.byteLength,
      })
      response.write(compressed.subarray(0, Math.floor(compressed.byteLength / 2)))
      response.destroy()
      return
    }
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(responseText),
    })
    response.end(responseText)
  }))
  const taskUrl = await listen(createImageTaskServer({
    upstreamBaseUrl: `${upstreamUrl}/v1`,
    logger: () => {},
    cleanupIntervalMs: 10_000,
  }))

  const task = await createTask(taskUrl, 'large-uncompressed-result', 'prompt')
  const completed = await waitForCompletion(taskUrl, task)

  assert.equal(receivedAcceptEncoding, 'identity')
  assert.equal(completed.status, 'succeeded')
  const result = await fetch(`${taskUrl}/image-tasks/${task.taskId}/result`, {
    headers: { Authorization: `Bearer ${task.accessToken}` },
  })
  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), { data: [{ b64_json: base64 }] })
})
