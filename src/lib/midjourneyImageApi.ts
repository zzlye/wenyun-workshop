import type { ApiProfile } from '../types'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxyForBaseUrl } from './devProxy'
import { fetchImageTask, hasImageTaskCredentials, shouldUseImageTasks } from './imageTasks'
import { type CallApiOptions, type CallApiResult, getSafeImageDisplayUrl, sanitizeApiErrorMessage, assertImageInputPayloadSize } from './imageApiShared'
import { buildMidjourneyRequest, normalizeMidjourneyRatio, readMidjourneyResponse, readMidjourneyTask } from './midjourney'
import { fetchResultResponse, isTransientResultError } from './resultRequest'

const ENDPOINT = 'midjourney/generations'
const POLL_INTERVAL_MS = 3_000
const TERMINAL_STATUSES = ['completed', 'succeeded', 'success', 'failed', 'failure', 'cancelled', 'canceled']

export async function callMidjourneyImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  const proxy = readClientDevProxyConfig()
  const useProxy = shouldUseApiProxyForBaseUrl(profile.apiProxy, profile.baseUrl, proxy)
  const headers = { Authorization: `Bearer ${profile.apiKey}`, 'Content-Type': 'application/json' }
  const resuming = hasImageTaskCredentials(opts.imageTask)
  // 续查不再读取或校验原图，也不重建付费请求；最终结果仍使用 Midjourney 解析器。
  const body = resuming ? undefined : JSON.stringify(buildMidjourneyRequest(profile.model, opts.prompt, opts.params, opts.inputImageDataUrls, opts.maskDataUrl))
  if (body) assertImageInputPayloadSize(new TextEncoder().encode(body).byteLength)
  const timeoutMs = Math.max(900, profile.timeout || 0) * 1000
  const useTasks = resuming || shouldUseImageTasks(profile.baseUrl)
  let response = useTasks
    ? await fetchImageTask(ENDPOINT, { method: 'POST', headers, body }, { timeoutMs, reference: opts.imageTask, onCreated: opts.onImageTaskCreated })
    : await fetchResultResponse(buildApiUrl(profile.baseUrl, ENDPOINT, proxy, useProxy), { method: 'POST', headers, body }, { timeoutMs })
  let payload: unknown = await readMidjourneyResponse(response)
  let task = readMidjourneyTask(payload, response.headers.get('x-newapi-task-id') || '')
  if (!response.ok) throw new Error(sanitizeApiErrorMessage(task.error || `图片请求失败（HTTP ${response.status}）`))
  if (!useTasks && !task.images.length && !TERMINAL_STATUSES.includes(task.status)) {
    if (!task.taskId) throw new Error('接口没有返回有效的图片任务 ID')
    const taskId = task.taskId
    while (!TERMINAL_STATUSES.includes(task.status)) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
      try {
        // 受理后只能查询原任务，临时网络错误不能重新 POST。
        response = await fetchResultResponse(buildApiUrl(profile.baseUrl, `tasks/${encodeURIComponent(taskId)}`, proxy, useProxy), { headers: { Authorization: headers.Authorization }, cache: 'no-store' }, { timeoutMs: 30_000 })
        if ([408, 429, 500, 502, 503, 504].includes(response.status)) continue
        payload = await readMidjourneyResponse(response)
        task = readMidjourneyTask(payload, taskId)
        if (!response.ok) throw new Error(task.error || `查询图片任务失败（HTTP ${response.status}）`)
      } catch (error) {
        if (isTransientResultError(error)) continue
        throw error
      }
    }
  }
  if (['failed', 'failure', 'cancelled', 'canceled'].includes(task.status)) throw new Error(sanitizeApiErrorMessage(task.error || '图片生成失败'))
  if (!task.images.length) throw new Error(task.error || '接口没有返回图片')
  opts.onResultReceived?.()
  // 四宫格封面不作为第五张结果；返回链接后交给现有后台保存流程下载原图。
  return { images: task.images.map(getSafeImageDisplayUrl), rawImageUrls: task.images.filter(value => /^https?:\/\//i.test(value)), actualParams: { size: normalizeMidjourneyRatio(opts.params.size), n: 1 } }
}
