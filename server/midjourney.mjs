import { setTimeout as delay } from 'node:timers/promises'

function readTask(body, headerId = '') {
  const text = body.toString('utf8')
  let payload = {}
  try {
    if (text.trim()) payload = JSON.parse(text)
  } catch {
    throw new Error('图片接口返回了无效响应')
  }
  const task = payload?.data && !Array.isArray(payload.data) ? payload.data : payload
  return {
    taskId: task?.task_id || headerId,
    status: String(task?.status || '').toLowerCase(),
    error: task?.error_message || payload?.error?.message || '图片生成失败',
  }
}

/** 受理响应不代表生成完成；始终使用提交时的令牌查询同一任务，网络重试只发送 GET。 */
export async function pollMidjourneyTask({ response, body, baseUrl, headers, signal, readBody, onAccepted, pollIntervalMs = 3_000, queryTimeoutMs = 30_000 }) {
  const submitted = readTask(body, response.headers.get('x-newapi-task-id') || '')
  const terminal = new Set(['completed', 'succeeded', 'success', 'failed', 'failure', 'cancelled', 'canceled'])
  if (terminal.has(submitted.status)) return { response, body }
  if (!submitted.taskId || typeof submitted.taskId !== 'string') throw new Error('上游没有返回有效的图片任务 ID')
  onAccepted?.()
  const pollHeaders = { Authorization: headers.get('authorization') || '', 'accept-encoding': 'identity' }
  while (true) {
    await delay(pollIntervalMs, undefined, { signal })
    let nextResponse
    let nextBody
    try {
      // 单次查询可超时，但任务没有服务端终态时仍保留原任务继续查询。
      const querySignal = AbortSignal.any([signal, AbortSignal.timeout(queryTimeoutMs)])
      nextResponse = await fetch(`${baseUrl}/tasks/${encodeURIComponent(submitted.taskId)}`, { headers: pollHeaders, signal: querySignal, cache: 'no-store' })
      nextBody = await readBody(nextResponse)
    } catch (error) {
      if (signal.aborted) throw error
      // 临时断流继续查询；响应超限等确定错误应结束，避免掩盖配置问题。
      if (error?.message === '图片任务响应体过大') throw error
      continue
    }
    if ([408, 429, 500, 502, 503, 504].includes(nextResponse.status)) continue
    if (!nextResponse.ok) return { response: nextResponse, body: nextBody }
    const task = readTask(nextBody)
    if (terminal.has(task.status)) return { response: nextResponse, body: nextBody }
  }
}
