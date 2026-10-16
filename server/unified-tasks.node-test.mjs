import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createImageTaskServer } from './image-tasks.mjs'
import { createTaskJournal } from './task-journal.mjs'

async function listen(server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}
async function close(server) {
  server.stopTasks?.(); server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
const headers = { Authorization: 'Bearer fixture-only', 'Content-Type': 'application/json', 'X-Wenyun-Idempotency-Key': 'once', 'X-Wenyun-Task-Client-Version': '2' }
async function completed(url, ref) {
  for (let i = 0; i < 200; i++) {
    const snapshot = await (await fetch(`${url}/image-tasks/${ref.taskId}`, { headers: { Authorization: `Bearer ${ref.accessToken}` } })).json()
    if (['succeeded', 'failed'].includes(snapshot.status)) return snapshot
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('任务未结束')
}

for (const endpoint of ['/images/generations', '/images/edits', '/v1beta/models/nano-banana-2.1:generateContent', '/responses', '/midjourney/generations']) {
  test(`${endpoint} 统一 Prefer 异步受理、状态和结果，临时故障不能重生`, async () => {
    let posts = 0, gets = 0
    const upstream = createServer(async (req, res) => {
      for await (const _chunk of req) { /* 接收完整的模拟输入。 */ }
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'POST') {
        posts++
        assert.equal(req.headers.prefer, 'respond-async')
        assert.equal(req.url, endpoint.startsWith('/v1beta') ? endpoint : `/v1${endpoint}`)
        res.writeHead(202); res.end(JSON.stringify({ id: 'async_fixture', task_id: 'async_fixture', status: 'pending', poll_url: '/v1/tasks/async_fixture' })); return
      }
      assert.equal(req.url, '/v1/tasks/async_fixture')
      assert.equal(req.headers.authorization, headers.Authorization)
      gets++
      if (gets === 1) { res.writeHead(503); res.end('{}'); return }
      res.end(JSON.stringify({ task_id: 'async_fixture', status: gets === 2 ? 'waiting' : 'succeeded', response_status_code: 200, result: { candidates: ['原生响应'], quality: 'high' } }))
    })
    const upstreamUrl = await listen(upstream)
    const server = createImageTaskServer({ upstreamBaseUrl: `${upstreamUrl}/v1`, pollIntervalMs: 1, logger: () => {} })
    const url = await listen(server)
    try {
      const ref = await (await fetch(`${url}/image-tasks?endpoint=${encodeURIComponent(endpoint)}`, { method: 'POST', headers, body: '{"quality":"high"}' })).json()
      assert.equal((await completed(url, ref)).status, 'succeeded')
      const result = await fetch(`${url}/image-tasks/${ref.taskId}/result`, { headers: { Authorization: `Bearer ${ref.accessToken}` } })
      assert.deepEqual(await result.json(), { candidates: ['原生响应'], quality: 'high' })
      const recovered = await (await fetch(`${url}/image-tasks/recover`, { headers })).json()
      assert.equal(recovered.taskId, ref.taskId)
      assert.equal(posts, 1)
      assert.equal(gets, 3)
      assert.equal((await fetch(`${url}/image-tasks/recover`, { headers: { ...headers, Authorization: 'Bearer another-customer' } })).status, 404)
    } finally { await close(server); await close(upstream) }
  })
}

test('服务重启后从落盘编号继续查询，结果可再取且始终只有一次生成', async () => {
  const directory = await mkdtemp(path.join(process.platform === 'win32' ? 'D:/tmp' : os.tmpdir(), 'wenyun-task-test-'))
  let posts = 0, ready = false, queried = false
  const upstream = createServer(async (req, res) => {
    for await (const _chunk of req) { /* 消费模拟请求。 */ }
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'POST') { posts++; res.writeHead(202); res.end('{"task_id":"async_restart","status":"pending"}'); return }
    queried = true
    res.end(JSON.stringify({ task_id: 'async_restart', status: ready ? 'succeeded' : 'processing', response_status_code: 200, result: { data: [{ b64_json: 'b2s=' }] } }))
  })
  const upstreamUrl = await listen(upstream)
  const options = { upstreamBaseUrl: `${upstreamUrl}/v1`, storageDirectory: directory, pollIntervalMs: 5, logger: () => {} }
  let server = createImageTaskServer(options), url = await listen(server)
  try {
    const ref = await (await fetch(`${url}/image-tasks?endpoint=/images/generations`, { method: 'POST', headers, body: '{}' })).json()
    for (let i = 0; i < 100 && !queried; i++) await new Promise(resolve => setTimeout(resolve, 5))
    assert.ok(queried)
    await close(server)
    ready = true
    server = createImageTaskServer(options); url = await listen(server)
    assert.equal((await completed(url, ref)).status, 'succeeded')
    await close(server)
    server = createImageTaskServer(options); url = await listen(server)
    const result = await fetch(`${url}/image-tasks/${ref.taskId}/result`, { headers: { Authorization: `Bearer ${ref.accessToken}` } })
    assert.deepEqual(await result.json(), { data: [{ b64_json: 'b2s=' }] })
    assert.equal(posts, 1)
    const record = JSON.parse(await readFile(path.join(directory, (await readdir(directory)).find(name => name.endsWith('.json'))), 'utf8'))
    assert.equal(record.requestBody, undefined)
    assert.equal(record.headers, null)
  } finally { await close(server); await close(upstream); await rm(directory, { recursive: true, force: true }) }
})

test('202 缺少任务编号时结束，不把受理响应冒充图片结果', async () => {
  const upstream = createServer(async (req, res) => {
    for await (const _chunk of req) { /* 消费本地模拟输入。 */ }
    res.writeHead(202, { 'Content-Type': 'application/json' }); res.end('{}')
  })
  const upstreamUrl = await listen(upstream)
  const server = createImageTaskServer({ upstreamBaseUrl: `${upstreamUrl}/v1`, logger: () => {} })
  const url = await listen(server)
  try {
    const ref = await (await fetch(`${url}/image-tasks?endpoint=/images/generations`, { method: 'POST', headers, body: '{}' })).json()
    const state = await completed(url, ref)
    assert.equal(state.status, 'failed')
    assert.match(state.error.message, /缺少任务编号/)
  } finally { await close(server); await close(upstream) }
})

test('重启遇到只有本地占位的任务，明确提交未确认且绝不重发', async () => {
  const directory = await mkdtemp(path.join(process.platform === 'win32' ? 'D:/tmp' : os.tmpdir(), 'wenyun-unknown-test-'))
  let posts = 0
  const upstream = createServer((req, res) => { posts++; res.end('{}') })
  const upstreamUrl = await listen(upstream)
  await createTaskJournal(directory).save({ id: 'unknown-task', accessToken: 'fixture-token', status: 'pending', endpoint: '/images/generations', expiresAt: Date.now() + 60_000 })
  const server = createImageTaskServer({ upstreamBaseUrl: `${upstreamUrl}/v1`, storageDirectory: directory, logger: () => {} })
  const url = await listen(server)
  try {
    const state = await completed(url, { taskId: 'unknown-task', accessToken: 'fixture-token' })
    assert.equal(state.status, 'failed')
    assert.equal(state.error.kind, 'submission_unknown')
    assert.equal(posts, 0)
  } finally { await close(server); await close(upstream); await rm(directory, { recursive: true, force: true }) }
})

test('落盘失败时拒绝新生成并保留幂等占位，服务不崩溃', async () => {
  const directory = await mkdtemp(path.join(process.platform === 'win32' ? 'D:/tmp' : os.tmpdir(), 'wenyun-journal-error-'))
  let posts = 0
  const upstream = createServer((req, res) => { posts++; res.end('{}') })
  const upstreamUrl = await listen(upstream)
  const server = createImageTaskServer({ upstreamBaseUrl: `${upstreamUrl}/v1`, storageDirectory: directory,
    journalCodec: { encode: () => { throw new Error('模拟磁盘不可写') } }, logger: () => {},
  })
  const url = await listen(server)
  try {
    const response = await fetch(`${url}/image-tasks?endpoint=/images/generations`, { method: 'POST', headers, body: '{}' })
    assert.equal(response.status, 500)
    assert.equal((await (await fetch(`${url}/image-tasks/recover`, { headers })).json()).status, 'failed')
    assert.equal((await fetch(`${url}/health`)).status, 200)
    assert.equal(posts, 0)
  } finally { await close(server); await close(upstream); await rm(directory, { recursive: true, force: true }) }
})
