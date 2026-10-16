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
  for (const url of ['https://attacker.example/v1/tasks/async_fixture', '/v1/tasks/another', '/v1/tasks/async_fixture?key=extra', 'https://user:secret@gateway.example/v1/tasks/async_fixture']) {
    assert.throws(() => safeGatewayPollUrl(base, 'async_fixture', url), /不可信/)
  }
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
