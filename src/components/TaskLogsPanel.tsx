import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Columns3, Copy, RefreshCw, Search } from 'lucide-react'
import type { ApiProfile, NewApiAccountSession } from '../types'
import { isNewApiAuthenticationError } from '../lib/newApiAccount'
import { usageLogTime } from '../lib/newApiLogs'
import { defaultTaskLogFilters, fetchAccountTaskLogs, taskLogsQuery, taskLogStatus, taskLogDuration, type AccountTaskLog } from '../lib/newApiTaskLogs'
import { copyTextToClipboard } from '../lib/clipboard'
import { useLogRefreshGuard } from '../hooks/useLogRefreshGuard'
import LogDateRangePicker from './LogDateRangePicker'
import TaskLogDetailsDialog from './TaskLogDetailsDialog'

const buttonClass = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-gray-200 px-3 text-xs transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/5'
const inputClass = 'h-8 w-full min-w-0 rounded-md border border-gray-200 bg-white px-2.5 text-xs text-gray-800 outline-none focus:border-blue-400 dark:border-white/15 dark:bg-gray-900 dark:text-gray-100'
const columns = [['time', '提交时间'], ['task', '任务 ID'], ['model', '接口 / 模型'], ['duration', '耗时'], ['status', '状态'], ['progress', '进度'], ['details', '详情']] as const
type Column = typeof columns[number][0]
export interface LogPanelProps { profile: ApiProfile; session: NewApiAccountSession; onRequireLogin: () => void; onSessionUpdated: (session: NewApiAccountSession) => void }

export default function TaskLogsPanel(props: LogPanelProps) {
  const { profile, session, onSessionUpdated, onRequireLogin } = props
  const [filters, setFilters] = useState(() => defaultTaskLogFilters()), [draft, setDraft] = useState(filters)
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20)
  const [selected, setSelected] = useState<AccountTaskLog | null>(null), [error, setError] = useState('')
  const [hiddenColumns, setHiddenColumns] = useState<Column[]>([]), [viewOpen, setViewOpen] = useState(false), [mobileFilters, setMobileFilters] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')
  const logs = useQuery({
    queryKey: ['wenyun-task-logs', profile.baseUrl, session.userId ?? session.username, session.authSessionId ?? session.accessToken, filters, page, pageSize],
    queryFn: ({ signal }) => fetchAccountTaskLogs(profile, session, filters, page, pageSize, signal, onSessionUpdated),
    // 筛选、分页按需读取，快速重复打开复用短缓存，不跟随窗口聚焦或网络恢复轮询。
    retry: false, retryOnMount: false, staleTime: 20000, gcTime: 60000, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const guard = useLogRefreshGuard(Math.max(logs.dataUpdatedAt, logs.errorUpdatedAt), logs.isFetching)
  const expired = isNewApiAuthenticationError(logs.error), items = logs.isError ? [] : logs.data?.items ?? [], total = logs.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const visibleColumns = columns.filter(([key]) => !hiddenColumns.includes(key))
  useEffect(() => { if (logs.isSuccess && page > pages) setPage(pages) }, [logs.isSuccess, page, pages])
  // 详情持有选中记录快照，不随列表刷新、排序或分页被替换关闭。
  const refresh = () => { if (!expired && guard.claim()) void logs.refetch({ cancelRefetch: false }) }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    try {
      taskLogsQuery(draft, 1, pageSize); setError(''); setMobileFilters(false)
      if (page === 1 && JSON.stringify(draft) === JSON.stringify(filters)) refresh()
      else { setFilters({ ...draft }); setPage(1) }
    } catch (error) { setError(error instanceof Error ? error.message : '筛选条件无效') }
  }
  const reset = () => {
    const next = defaultTaskLogFilters(); setDraft(next); setError('')
    if (page === 1 && JSON.stringify(next) === JSON.stringify(filters)) refresh()
    else { setFilters(next); setPage(1) }
  }
  const copyId = async (value: string) => { try { await copyTextToClipboard(value); setCopyMessage('任务 ID 已复制') } catch { setCopyMessage('复制失败，请重试') } }
  const cell = (task: AccountTaskLog, column: Column) => {
    switch (column) {
      case 'time': return <div className="whitespace-nowrap font-mono text-xs tabular-nums"><time>{usageLogTime(task.submitTime)}</time><p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{task.finishTime ? usageLogTime(task.finishTime) : '—'}</p></div>
      case 'task': return <div className="min-w-0 max-w-[190px]"><button type="button" title={task.taskId} aria-label={`复制任务 ID ${task.taskId}`} onClick={() => void copyId(task.taskId)} className="inline-flex max-w-full items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-xs dark:border-white/15 dark:bg-white/5"><span className="truncate">{task.taskId}</span><Copy size={11} className="shrink-0" /></button><p className="mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400">{task.platform || '—'} · {taskAction(task.action)}</p></div>
      case 'model': return <div className="min-w-0 max-w-[240px]"><p className="truncate font-mono text-xs" title={task.requestPath}>{[task.requestMethod, task.requestPath].filter(Boolean).join(' ') || '—'}</p><p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400" title={task.model}>{task.model || '—'}</p></div>
      case 'duration': return taskLogDuration(task) === '—' ? '—' : <span className={`whitespace-nowrap rounded-md border px-1.5 py-0.5 font-mono text-xs ${task.durationFinishTime - task.submitTime > 300 ? 'border-red-200 text-red-600 dark:border-red-900 dark:text-red-400' : 'border-emerald-200 text-emerald-600 dark:border-emerald-900 dark:text-emerald-400'}`}>{taskLogDuration(task)}</span>
      case 'status': return <TaskStatus task={task} />
      case 'progress': return <div className="flex min-w-[70px] items-center gap-2"><div className="h-1.5 w-12 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(0, Math.min(100, Number.parseFloat(task.progress) || 0))}%` }} /></div><span className="whitespace-nowrap text-xs">{task.progress || '—'}</span></div>
      case 'details': return <div className="flex max-w-[220px] flex-col items-start gap-1">{task.failReason && <button type="button" title={task.failReason} onClick={() => setSelected(task)} className="max-w-full truncate text-left text-xs text-red-600 hover:underline dark:text-red-400">{task.failReason}</button>}{!task.failReason && task.mediaExpired && <span className="text-xs text-gray-500">生成文件已过期</span>}<button type="button" className="whitespace-nowrap text-xs text-blue-500 hover:underline" onClick={() => setSelected(task)}>查看任务详情</button></div>
    }
  }
  return <>
    <div className="flex shrink-0 justify-end px-5 py-2"><button type="button" className={buttonClass} disabled={guard.disabled || expired} onClick={refresh}><RefreshCw size={13} className={logs.isFetching ? 'animate-spin' : ''} />刷新</button></div>
    <div className="min-h-0 flex-1 overflow-auto">
      <form aria-label="任务日志筛选" onSubmit={submit} className="relative mx-4 mb-4 rounded-lg border border-gray-200 bg-gray-50/70 p-3 dark:border-white/10 dark:bg-white/[0.03] sm:mx-5">
        <div className="grid min-w-0 grid-cols-1 items-start gap-2 sm:grid-cols-2 lg:grid-cols-4"><div className="sm:col-span-2"><LogDateRangePicker startDate={draft.startDate} endDate={draft.endDate} onChange={range => setDraft({ ...draft, ...range })} /></div><div className={mobileFilters ? '' : 'hidden sm:block'}><input aria-label="任务 ID" placeholder="按任务 ID 筛选" className={inputClass} autoComplete="off" value={draft.taskId} onChange={e => setDraft({ ...draft, taskId: e.target.value })} /></div><div className={mobileFilters ? '' : 'hidden sm:block'}><input aria-label="模型" placeholder="按模型名称筛选" className={inputClass} autoComplete="off" value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} /></div></div>
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2"><button type="button" aria-expanded={mobileFilters} className={`${buttonClass} sm:hidden`} onClick={() => setMobileFilters(!mobileFilters)}>筛选{[draft.taskId, draft.model].filter(Boolean).length > 0 ? ` (${[draft.taskId, draft.model].filter(Boolean).length})` : ''}</button><button type="button" className={buttonClass} onClick={reset}>重置</button><button type="submit" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-500 px-3 text-xs text-white hover:bg-blue-600"><Search size={13} />搜索</button><div className="relative"><button type="button" aria-label="显示列" aria-expanded={viewOpen} className={buttonClass} onClick={() => setViewOpen(!viewOpen)}><Columns3 size={13} />显示列</button>{viewOpen && <div role="group" aria-label="显示列选项" className="absolute right-0 top-10 z-20 w-40 rounded-lg border border-gray-200 bg-white p-2 shadow-xl dark:border-white/15 dark:bg-gray-900">{columns.map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-white/5"><input type="checkbox" checked={!hiddenColumns.includes(key)} disabled={visibleColumns.length === 1 && !hiddenColumns.includes(key)} onChange={e => setHiddenColumns(current => e.target.checked ? current.filter(item => item !== key) : [...current, key])} />{label}</label>)}</div>}</div></div>
        {error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}{copyMessage && <p role="status" className="mt-2 text-xs text-gray-500">{copyMessage}</p>}
      </form>
      {logs.isError ? <div role="alert" className="px-5 py-12 text-center"><p className="mb-4 break-words text-sm text-red-500">{logs.error.message}</p><button type="button" className={buttonClass} disabled={!expired && guard.disabled} onClick={expired ? onRequireLogin : refresh}>{expired ? '重新登录' : '重试'}</button></div> : logs.isPending ? <p role="status" className="px-5 py-12 text-center text-sm text-gray-500">正在读取任务日志…</p> : !items.length ? <p className="px-5 py-12 text-center text-sm text-gray-500">暂无符合条件的任务</p> : <div className="px-4 pb-5 sm:px-5">
        <div className="hidden overflow-x-auto rounded-lg border border-gray-200 dark:border-white/10 md:block"><table aria-label="任务日志" className="w-full min-w-[1040px] text-left text-[13px]"><thead className="bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-gray-400"><tr>{visibleColumns.map(([key, label]) => <th key={key} className="whitespace-nowrap px-3 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{items.map(task => <tr key={task.id} className="border-t border-gray-100 align-top dark:border-white/10">{visibleColumns.map(([key]) => <td key={key} className="px-3 py-3">{cell(task, key)}</td>)}</tr>)}</tbody></table></div>
        <div className="space-y-3 md:hidden">{items.map(task => <article key={task.id} className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-white/10"><div className="flex items-start justify-between gap-2">{cell(task, 'task')}<TaskStatus task={task} /></div>{cell(task, 'model')}<dl className="grid grid-cols-2 gap-2 text-xs"><div><dt className="mb-1 text-gray-500 dark:text-gray-400">提交时间</dt><dd>{usageLogTime(task.submitTime)}</dd></div><div><dt className="mb-1 text-gray-500 dark:text-gray-400">耗时</dt><dd>{cell(task, 'duration')}</dd></div><div className="col-span-2">{cell(task, 'progress')}</div></dl>{cell(task, 'details')}</article>)}</div>
      </div>}
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3 text-xs dark:border-white/10"><div className="flex items-center gap-3 text-gray-500 dark:text-gray-400"><label className="flex items-center gap-2">每页<select value={pageSize} className="rounded-md border border-gray-200 bg-transparent px-2 py-1 dark:border-white/10 dark:bg-gray-900" onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}><option value={20}>20 条</option><option value={50}>50 条</option></select></label>{logs.data && !logs.isError && <span>共 {total.toLocaleString('zh-CN')} 条</span>}</div><div className="flex items-center gap-2"><button type="button" aria-label="上一页" className={buttonClass} disabled={page <= 1 || logs.isFetching} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /></button><span>{page} / {pages}</span><button type="button" aria-label="下一页" className={buttonClass} disabled={page >= pages || logs.isFetching || logs.isError} onClick={() => setPage(page + 1)}><ChevronRight size={14} /></button></div></footer>
    {selected && <TaskLogDetailsDialog key={selected.taskId} {...props} task={selected} onClose={() => setSelected(null)} />}
  </>
}

function taskAction(value: string) {
  return ({ IMAGE: '图片', VIDEO: '视频', MUSIC: '生成音乐', LYRICS: '生成歌词', GENERATE: '图生视频', TEXT_GENERATE: '文生视频', FIRST_TAIL_GENERATE: '首尾帧生视频', REFERENCE_GENERATE: '参考视频', REMIX_GENERATE: '视频重混' } as Record<string, string>)[value] || value || '—'
}
function TaskStatus({ task }: { task: AccountTaskLog }) {
  const label = taskLogStatus(task.status)
  const color = label === '失败' ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300' : label === '成功' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
  return <span className={`inline-flex rounded-md px-2 py-1 text-[11px] ${color}`}>{task.mediaSaving ? '生成完成，正在保存文件' : label}</span>
}
