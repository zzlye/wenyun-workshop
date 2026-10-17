import assert from 'node:assert/strict'
import { test } from 'node:test'
import { finishGatewayTask, readGatewayTask, safeGatewayPollUrl } from './gateway-task.mjs'

test('普通 Responses 同步结果与 SSE 不会误认成网关任务', () => {
  assert.equal(readGatewayTask(Buffer.from('{"id":"resp_fixture","status":"completed","output":[]}'), new Response()), null)
  assert.equal(readGatewayTask(Buffer.from('data: {"type":"response.completed"}\n\n'), new Response(null, { headers: { 'Content-Type': 'text/event-stream' } })), null)
})

test('查询地址只允许相同网关的当前任务', () => {
  const base = 'https://gateway.example/v1'
  assert.equal(safeGatewayPollUrl(base, 'async_fixture', '/v1/tasks/async_fixture'), `${base}/tasks/async_fixture`)
  for (const url of ['ftp://gateway.example/v1/tasks/async_fixture', '/v1/tasks/another', '/v1/tasks/async_fixture?key=extra', 'https://user:secret@gateway.example/v1/tasks/async_fixture']) {
    assert.throws(() => safeGatewayPollUrl(base, 'async_fixture', url), /不可信/)
  }
})

test('公开任务域名与内网不同仍只向配置网关查询，恢复任务也不向外部发送密钥', async () => {
  const base = 'http://new-api:3000/v1'
  const expected = `${base}/tasks/async_fixture`
  for (const origin of ['https://api.xn--v5z30ywuk.com', 'https://attacker.example']) {
    assert.equal(safeGatewayPollUrl(base, 'async_fixture', `${origin}/v1/tasks/async_fixture`), expected)
  }
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return Response.json({ task_id: 'async_fixture', status: 'succeeded', response_status_code: 200, result: { data: [{ url: 'https://media.example/result.png' }] } })
  }
  try {
    for (const recovered of [false, true]) {
      const accepted = { id: 'async_fixture', pollUrl: 'https://api.xn--v5z30ywuk.com/v1/tasks/async_fixture' }
      const task = recovered ? { gateway: accepted } : {}
      const result = await finishGatewayTask({ task, response: new Response(null, { status: 202 }),
        body: Buffer.from(JSON.stringify({ task_id: accepted.id, poll_url: accepted.pollUrl })),
        baseUrl: base, headers: new Headers({ Authorization: 'Bearer fixture-key' }), signal: new AbortController().signal,
        checkpoint: async () => { assert.equal(task.gateway.pollUrl, expected) },
        readBody: async response => Buffer.from(await response.arrayBuffer()), pollIntervalMs: 1,
      })
      assert.equal(result.response.status, 200)
    }
    assert.equal(requests.length, 2)
    for (const request of requests) {
      assert.equal(request.url, expected)
      assert.equal(request.options.headers.Authorization, 'Bearer fixture-key')
      assert.equal(request.options.redirect, 'error')
    }
  } finally { globalThis.fetch = originalFetch }
})

for (const snapshot of [
  { task_id: 'async_fixture', status: 'failed', error: { message: '模拟上游失败' } },
  { task_id: 'async_fixture', status: 'cancelled' },
  { task_id: 'async_fixture', status: 'succeeded', result_expired: true },
]) {
  test(`网关终态 ${snapshot.status} expired=${!!snapshot.result_expired} 明确结束`, async () => {
    await assert.rejects(finishGatewayTask({ task: {}, response: new Response(null, { status: 202 }), body: Buffer.from(JSON.stringify(snapshot)),
      baseUrl: 'https://gateway.example/v1', headers: new Headers(), signal: new AbortController().signal,
      checkpoint: async () => {}, readBody: async () => { throw new Error('终态不应继续查询') }, pollIntervalMs: 1,
    }), /失败|过期/)
  })
}
