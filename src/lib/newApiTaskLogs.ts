import type { ApiProfile, NewApiAccountSession } from '../types'
import { requestNewApiAccountResource } from './newApiAccount'
import { defaultUsageLogFilters, usageLogsQuery } from './newApiLogs'

export const TASK_LOG_STATUSES = [
  ['', '全部状态'], ['NOT_START', '未开始'], ['SUBMITTED', '排队中'], ['QUEUED', '排队中'],
  ['IN_PROGRESS', '进行中'], ['SUCCESS', '成功'], ['FAILURE', '失败'], ['UNKNOWN', '未知'],
] as const
export interface TaskLogFilters { startDate: string; endDate: string; model: string; taskId: string; status: string }
export interface AccountTaskLog {
  id: number; taskId: string; model: string; group: string; status: string; progress: string
  platform: string; action: string; quota: number; submitTime: number; startTime: number; finishTime: number
  durationFinishTime: number; failReason: string; isAsync: boolean; mediaExpired: boolean; mediaSaving: boolean
  requestPath: string; requestMethod?: string; upstreamModel?: string
}
export interface AccountTaskLogPage { items: AccountTaskLog[]; total: number }
export interface AccountTaskMedia { kind: 'image' | 'video' | 'audio'; contentType: string; name: string; role: string; url: string; error: string }
export interface AccountTaskDetails {
  fullParameters?: Record<string, unknown>
  taskId: string; prompt: string; promptSource: string; error: string; responseStatusCode: number; parameters: Record<string, string>
  model?: string; status?: string; requestMethod?: string; requestPath?: string; requestFormat?: string
  submitTime?: number; startTime?: number; responseTime?: number; finishTime?: number; expiresAt?: number
  inputAvailable?: boolean; inputError?: string; mediaExpired?: boolean; references?: AccountTaskMedia[]; media?: AccountTaskMedia[]
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0

export function defaultTaskLogFilters(now = new Date()): TaskLogFilters {
  // 与 NewAPI 相同：今天零点到当前时间后一小时，刷新不会立刻漏掉刚提交的任务。
  const { startDate } = defaultUsageLogFilters(now)
  const { endDate } = defaultUsageLogFilters(new Date(now.getTime() + 3600000))
  return { startDate, endDate, model: '', taskId: '', status: '' }
}

export function taskLogsQuery(filters: TaskLogFilters, page: number, pageSize: number): string {
  // 沿用相同的日期与分页校验，但只发送本人任务接口实际支持的筛选条件。
  const query = new URLSearchParams(usageLogsQuery({ ...defaultUsageLogFilters(), startDate: filters.startDate, endDate: filters.endDate, model: filters.model }, page, pageSize))
  query.delete('type')
  if (!TASK_LOG_STATUSES.some(([status]) => status === filters.status)) throw new Error('任务状态无效')
  if (filters.taskId.trim()) query.set('task_id', filters.taskId.trim())
  if (filters.status) query.set('status', filters.status)
  return query.toString()
}

export function parseAccountTaskLogs(value: unknown): AccountTaskLogPage {
  const data = record(value)
  // NewAPI 空页的 Go 切片可能编码为 null，不能将其他畸形响应当作空页。
  const items = data.items === null && data.total === 0 ? [] : data.items
  if (!Array.isArray(items) || !Number.isSafeInteger(data.total) || (data.total as number) < 0) throw new Error('任务日志格式异常，请稍后重试')
  return { total: data.total as number, items: items.map(value => {
    const row = record(value), properties = record(row.properties)
    if (!Number.isSafeInteger(row.id) || !text(row.task_id) || !Number.isFinite(row.submit_time)) throw new Error('任务记录格式异常，请稍后重试')
    // 不保留上游快照、密钥、管理员信息或媒体地址，列表不会逐条下载图片或视频。
    return {
      id: row.id as number, taskId: text(row.task_id), model: text(row.model_name) || text(properties.origin_model_name),
      group: text(row.group), status: text(row.status), progress: text(row.progress), platform: text(row.platform), action: text(row.action),
      quota: number(row.quota), submitTime: number(row.submit_time), startTime: number(row.start_time), finishTime: number(row.finish_time),
      durationFinishTime: number(row.duration_finish_time) || number(row.finish_time), failReason: text(row.fail_reason),
      isAsync: row.is_async === true, mediaExpired: row.media_expired === true, mediaSaving: row.media_saving === true, requestPath: text(row.request_path),
      requestMethod: text(row.request_method), upstreamModel: text(properties.upstream_model_name),
    }
  }) }
}

async function readTaskResource(profile: ApiProfile, session: NewApiAccountSession, path: string, signal?: AbortSignal, onSessionUpdated?: (session: NewApiAccountSession) => void): Promise<unknown> {
  const timeout = AbortSignal.timeout(30000)
  try {
    return await requestNewApiAccountResource<unknown>(profile, session, path, { method: 'GET', signal: signal ? AbortSignal.any([signal, timeout]) : timeout }, onSessionUpdated)
  } catch (error) {
    if (timeout.aborted && !signal?.aborted) throw new Error('任务日志读取超时，请稍后重试')
    throw error
  }
}

export async function fetchAccountTaskLogs(profile: ApiProfile, session: NewApiAccountSession, filters: TaskLogFilters, page: number, pageSize: number, signal?: AbortSignal, onSessionUpdated?: (session: NewApiAccountSession) => void): Promise<AccountTaskLogPage> {
  return parseAccountTaskLogs(await readTaskResource(profile, session, `/api/task/self?${taskLogsQuery(filters, page, pageSize)}`, signal, onSessionUpdated))
}

export async function fetchAccountTaskDetails(profile: ApiProfile, session: NewApiAccountSession, taskId: string, signal?: AbortSignal, onSessionUpdated?: (session: NewApiAccountSession) => void): Promise<AccountTaskDetails> {
  if (!/^async_[A-Za-z0-9_-]+$/.test(taskId)) throw new Error('该任务没有异步请求详情')
  const data = record(await readTaskResource(profile, session, `/api/task/${encodeURIComponent(taskId)}/details`, signal, onSessionUpdated))
  if (data.task_id !== taskId) throw new Error('任务详情格式异常')
  // 参数使用公开字段白名单，避免未来接口新增凭证或内部配置时被直接渲染。
  const parameters = record(data.parameters), allowed: Record<string, string> = {}
  for (const key of ['model', 'size', 'resolution', 'aspect_ratio', 'duration', 'seconds', 'quality', 'background', 'output_format', 'output_compression', 'n', 'seed', 'response_format', 'negative_prompt', 'stream', 'moderation', 'fps', 'watermark', 'generate_audio']) {
    if (typeof parameters[key] === 'string') allowed[key] = parameters[key]
  }
  const media = (value: unknown, role: 'media' | 'reference'): AccountTaskMedia[] => Array.isArray(value) ? value.map(value => {
    const item = record(value)
    if (!['image', 'video', 'audio'].includes(text(item.kind))) return null
    const candidate = text(item.url), prefix = `/api/task/${taskId}/${role}/`
    // 仅允许当前任务的同源读取入口，忽略上游地址、其他账号任务以及主动内容。
    const url = candidate.startsWith(prefix) && /^[0-9]+$/.test(candidate.slice(prefix.length)) ? candidate : ''
    return { kind: item.kind as AccountTaskMedia['kind'], contentType: text(item.content_type), name: text(item.name), role: text(item.role), url, error: text(item.error) }
  }).filter((item): item is AccountTaskMedia => item !== null) : []
  const snapshot = record(data.full_parameters)
  let fullParameters: Record<string, unknown> | undefined
  if (snapshot.task_id === taskId) {
    // 保留 NewAPI 已脱敏的任务快照契约，不透传未来新增的内部对象或原始请求体。
    fullParameters = {}
    for (const key of ['task_id', 'model_name', 'upstream_model_name', 'request_method', 'request_path', 'request_query', 'request_content_type', 'request_format', 'created_beijing', 'status']) {
      if (typeof snapshot[key] === 'string') fullParameters[key] = snapshot[key]
    }
    for (const key of ['channel_id', 'created_at', 'started_at', 'finished_at', 'response_status_code', 'result_expired_at']) {
      if (typeof snapshot[key] === 'number' && Number.isFinite(snapshot[key])) fullParameters[key] = snapshot[key]
    }
    for (const key of ['request_body', 'request_files']) if (snapshot[key] === '') fullParameters[key] = ''
    if (Array.isArray(snapshot.request_conversion)) fullParameters.request_conversion = snapshot.request_conversion.filter(value => typeof value === 'string')
    const input = record(snapshot.request_details)
    fullParameters.request_details = {
      prompt: text(input.prompt), prompt_source: text(input.prompt_source), parameters: allowed,
      references: Array.isArray(input.references) ? input.references.map(value => { const reference = record(value); return { role: text(reference.role), content_type: text(reference.content_type), kind: text(reference.kind) } }) : [],
      ...(typeof input.capture_error === 'string' ? { capture_error: input.capture_error } : {}),
    }
  }
  return {
    fullParameters,
    taskId, prompt: text(data.prompt), promptSource: text(data.prompt_source), error: text(data.error), responseStatusCode: number(data.response_status_code), parameters: allowed,
    model: text(data.model_name), status: text(data.status), requestMethod: text(data.request_method), requestPath: text(data.request_path), requestFormat: text(data.request_format),
    submitTime: number(data.submit_time), startTime: number(data.start_time), responseTime: number(data.response_time), finishTime: number(data.finish_time), expiresAt: number(data.expires_at),
    inputAvailable: data.input_available === true, inputError: text(data.input_error), mediaExpired: data.media_expired === true, references: media(data.references, 'reference'), media: media(data.media, 'media'),
  }
}

export function taskLogStatus(value: string): string {
  if (!value.trim()) return '未知'
  const status = ({ FAILED: 'FAILURE', SUCCEEDED: 'SUCCESS', COMPLETED: 'SUCCESS', RUNNING: 'IN_PROGRESS', PROCESSING: 'IN_PROGRESS', WAITING: 'IN_PROGRESS', PENDING: 'QUEUED', CANCELLED: '已取消' } as Record<string, string>)[value.toUpperCase()] ?? value.toUpperCase()
  return TASK_LOG_STATUSES.find(([key]) => key === status)?.[1] ?? (status === '已取消' ? status : value || '未知')
}
export function taskLogDuration(log: AccountTaskLog): string {
  // 原站任务表从提交时间计算耗时，包含排队；详情另外展示生成开始时间。
  const start = log.submitTime
  return log.durationFinishTime > 0 && start > 0 && log.durationFinishTime >= start ? `${(log.durationFinishTime - start).toFixed(1)}s` : '—'
}
