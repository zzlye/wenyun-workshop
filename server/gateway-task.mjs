import { setTimeout as delay } from 'node:timers/promises'

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504])
const FINISHED = new Set(['succeeded', 'completed', 'success', 'done'])
const FAILED = new Set(['failed', 'failure', 'cancelled', 'canceled', 'error'])

export function gatewayEndpoint(baseUrl, endpoint) {
  // Gemini 使用原生根路径，其他生成协议保持原来的 /v1 路径。
  return endpoint.startsWith('/v1beta/') ? `${baseUrl.replace(/\/v1$/, '')}${endpoint}` : `${baseUrl}${endpoint}`
}

export function readGatewayTask(body, response) {
  let root
  try { root = JSON.parse(body.toString('utf8')) } catch {
    // 不支持异步的旧上游可能返回 SSE，保留原字节交给对应协议解析器。
    if (response?.status !== 202 && response?.headers.get('content-type')?.includes('text/event-stream')) return null
    if (body.length) throw new Error('图片接口返回了无效响应')
    root = {}
  }
  const value = root?.data && !Array.isArray(root.data) ? root.data : root
  const headerId = response?.headers.get('x-newapi-task-id')
  const id = value?.task_id || headerId || value?.id
  // Responses 本身也有 id/status，只有明确任务标记才进入网关轮询。
  const marked = value?.task_id || headerId || response?.status === 202 || (value?.poll_url && String(id).startsWith('async_'))
  if (typeof id !== 'string' || !id.trim() || !marked) return null
  return { id, payload: value, pollUrl: value?.poll_url || response?.headers.get('location') }
}

export function safeGatewayPollUrl(baseUrl, id, supplied) {
  const expected = new URL(`${baseUrl}/tasks/${encodeURIComponent(id)}`)
  const resolved = supplied ? new URL(supplied, `${baseUrl.replace(/\/v1$/, '')}/`) : expected
  // 公网域名可能与内网网关不同；只校验本次任务路径，实际请求始终回到配置的网关。
  // 不使用响应中的域名发请求，避免将客户 Key 转发给任意外部地址。
  if (!['http:', 'https:'].includes(resolved.protocol) || resolved.pathname !== expected.pathname || resolved.username || resolved.password || resolved.search || resolved.hash) throw new Error('上游返回了不可信的任务查询地址')
  return expected.href
}

function retryDelay(response, fallback) {
  const raw = response?.headers.get('retry-after')
  if (!raw) return fallback
  const seconds = Number(raw)
  const value = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now()
  return Number.isFinite(value) ? Math.max(fallback, Math.min(60_000, value)) : fallback
}

/** 所有生成协议统一受理与轮询；网络重试永远只发送 GET。 */
export async function finishGatewayTask({ task, response, body, baseUrl, headers, signal, readBody, checkpoint, pollIntervalMs = 5000 }) {
  let accepted = task.gateway || readGatewayTask(body, response)
  if (!accepted) return { response, body }
  const pollUrl = safeGatewayPollUrl(baseUrl, accepted.id, accepted.pollUrl)
  task.gateway = { id: accepted.id, pollUrl }
  await checkpoint()
  let snapshot = accepted.payload || {}
  let pause = retryDelay(response, pollIntervalMs)
  for (;;) {
    const status = String(snapshot.status || '').toLowerCase()
    if (FAILED.has(status)) throw new Error(snapshot.error?.message || snapshot.error_message || '生成任务失败')
    if (snapshot.result_expired) throw new Error('生成结果已过期，不能重新提交原任务')
    if (FINISHED.has(status)) {
      // NewAPI result 保持原协议；旧 MJ 包装继续交给现有 MJ 解析器。
      if (snapshot.response_status_code === undefined) return { response, body }
      const result = snapshot.result
      if (result === undefined) throw new Error('任务已完成但没有返回原始结果')
      const code = Number(snapshot.response_status_code || 200)
      return { response: new Response(null, { status: code, headers: { 'Content-Type': snapshot.content_type || 'application/json' } }), body: Buffer.from(JSON.stringify(result)) }
    }
    await delay(pause, undefined, { signal })
    try {
      response = await fetch(pollUrl, { headers: { Authorization: headers.get('authorization') || '', 'accept-encoding': 'identity' }, redirect: 'error', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
      body = await readBody(response)
    } catch (error) {
      if (signal.aborted || error?.message === '图片任务响应体过大') throw error
      continue
    }
    pause = retryDelay(response, pollIntervalMs)
    if (RETRYABLE.has(response.status)) continue
    if (!response.ok) throw new Error(`查询生成任务失败（HTTP ${response.status}）`)
    let parsed
    try { parsed = JSON.parse(body.toString('utf8')) } catch { throw new Error('任务查询返回了无效 JSON') }
    snapshot = parsed?.data && !Array.isArray(parsed.data) ? parsed.data : parsed
    const responseId = snapshot.task_id || snapshot.id
    if (responseId && responseId !== accepted.id) throw new Error('查询返回的任务编号不一致')
    // 未知状态保留原任务并继续查询，不把 HTTP 200 当作生成成功。
  }
}
