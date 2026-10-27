import type { ApiProfile, NewApiAccountSession } from '../types'
import { requestNewApiAccountResource } from './newApiAccount'
import { defaultUsageLogFilters, usageLogsQuery } from './newApiLogs'

export const TASK_LOG_STATUSES = [
  ['', '全部状态'], ['NOT_START', '未开始'], ['SUBMITTED', '已提交'], ['QUEUED', '排队中'],
  ['IN_PROGRESS', '进行中'], ['SUCCESS', '成功'], ['FAILURE', '失败'], ['UNKNOWN', '未知'],
] as const
export interface TaskLogFilters { startDate: string; endDate: string; model: string; taskId: string; status: string }
export interface AccountTaskLog {
  id: number; taskId: string; model: string; group: string; status: string; progress: string
  platform: string; action: string; quota: number; submitTime: number; startTime: number; finishTime: number
  durationFinishTime: number; failReason: string; isAsync: boolean; mediaExpired: boolean; mediaSaving: boolean
  requestPath: string
}
export interface AccountTaskLogPage { items: AccountTaskLog[]; total: number }
export interface AccountTaskDetails { taskId: string; prompt: string; promptSource: string; error: string; responseStatusCode: number; parameters: Record<string, string> }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0

export function defaultTaskLogFilters(): TaskLogFilters {
  const { startDate, endDate } = defaultUsageLogFilters()
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
  for (const key of ['model', 'size', 'resolution', 'aspect_ratio', 'duration', 'seconds', 'quality', 'background', 'output_format', 'n', 'seed', 'response_format']) {
    if (typeof parameters[key] === 'string') allowed[key] = parameters[key]
  }
  return { taskId, prompt: text(data.prompt), promptSource: text(data.prompt_source), error: text(data.error), responseStatusCode: number(data.response_status_code), parameters: allowed }
}

export function taskLogStatus(value: string): string {
  if (!value.trim()) return '未知'
  const status = ({ FAILED: 'FAILURE', SUCCEEDED: 'SUCCESS', COMPLETED: 'SUCCESS', RUNNING: 'IN_PROGRESS', PENDING: 'NOT_START' } as Record<string, string>)[value.toUpperCase()] ?? value.toUpperCase()
  return TASK_LOG_STATUSES.find(([key]) => key === status)?.[1] ?? (value || '未知')
}
export function taskLogDuration(log: AccountTaskLog): string {
  const start = log.startTime || log.submitTime
  return log.durationFinishTime > 0 && start > 0 && log.durationFinishTime >= start ? `${log.durationFinishTime - start}s` : '—'
}
