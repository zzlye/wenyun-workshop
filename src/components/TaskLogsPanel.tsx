import { Fragment, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import type { ApiProfile, NewApiAccountSession } from '../types'
import { fetchNewApiSiteStatus, isNewApiAuthenticationError } from '../lib/newApiAccount'
import { formatLotteryQuota } from '../lib/newApiLottery'
import { usageLogTime } from '../lib/newApiLogs'
import { defaultTaskLogFilters, fetchAccountTaskLogs, fetchAccountTaskDetails, taskLogsQuery, taskLogStatus, taskLogDuration, TASK_LOG_STATUSES, type AccountTaskLog } from '../lib/newApiTaskLogs'
import { useLogRefreshGuard } from '../hooks/useLogRefreshGuard'

const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5'
const inputClass = 'h-8 w-full min-w-0 rounded-full border border-gray-200 bg-white/80 px-3 text-xs text-gray-800 outline-none focus:border-blue-400 dark:border-white/15 dark:bg-white/[0.04] dark:text-gray-100'
const queryOptions = { retry: false, retryOnMount: false, staleTime: 20000, gcTime: 60000, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const

export interface LogPanelProps {
  profile: ApiProfile; session: NewApiAccountSession; onRequireLogin: () => void
  onSessionUpdated: (session: NewApiAccountSession) => void
}

export default function TaskLogsPanel({ profile, session, onRequireLogin, onSessionUpdated }: LogPanelProps) {
  const [filters, setFilters] = useState(defaultTaskLogFilters)
  const [draft, setDraft] = useState(filters)
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20)
  const [selected, setSelected] = useState<number | null>(null), [error, setError] = useState('')
  const identity = [profile.baseUrl, session.userId ?? session.username, session.authSessionId ?? session.accessToken]
  const logs = useQuery({
    queryKey: ['wenyun-task-logs', ...identity, filters, page, pageSize],
    queryFn: ({ signal }) => fetchAccountTaskLogs(profile, session, filters, page, pageSize, signal, onSessionUpdated),
    ...queryOptions,
  })
  const site = useQuery({ queryKey: ['wenyun-usage-logs-currency', profile.baseUrl], queryFn: ({ signal }) => fetchNewApiSiteStatus(profile, signal), ...queryOptions, staleTime: 60000 })
  const guard = useLogRefreshGuard(Math.max(logs.dataUpdatedAt, logs.errorUpdatedAt), logs.isFetching)
  const expired = isNewApiAuthenticationError(logs.error)
  const items = logs.isError ? [] : logs.data?.items ?? [], total = logs.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const money = (quota: number) => formatLotteryQuota(quota, site.data ?? null)
  useEffect(() => { setSelected(null) }, [filters, page, pageSize])
  useEffect(() => { if (logs.isSuccess && page > pages) setPage(pages) }, [logs.isSuccess, page, pages])
  const refresh = () => {
    if (expired || !guard.claim()) return
    setSelected(null)
    void logs.refetch({ cancelRefetch: false })
    if (site.isError) void site.refetch({ cancelRefetch: false })
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    try {
      taskLogsQuery(draft, 1, pageSize); setError('')
      if (page === 1 && JSON.stringify(draft) === JSON.stringify(filters)) refresh()
      else { setFilters({ ...draft }); setPage(1) }
    } catch (error) { setError(error instanceof Error ? error.message : '筛选条件无效') }
  }
  const reset = () => {
    const next = defaultTaskLogFilters()
    setDraft(next); setError('')
    if (page === 1 && JSON.stringify(next) === JSON.stringify(filters)) refresh()
    else { setFilters(next); setPage(1) }
  }
  const toggle = (task: AccountTaskLog) => setSelected(selected === task.id ? null : task.id)
  return <>
    <div className="flex shrink-0 justify-end px-5 py-2"><button type="button" className={buttonClass} disabled={guard.disabled || expired} onClick={refresh}><RefreshCw size={14} className={logs.isFetching ? 'animate-spin' : ''} />刷新</button></div>
    <div className="min-h-0 flex-1 overflow-auto">
      <form aria-label="任务日志筛选" onSubmit={submit} className="mx-4 mb-4 rounded-2xl border border-gray-200/80 bg-gray-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03] sm:mx-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-gray-500 dark:text-gray-400">开始时间<input type="datetime-local" required aria-label="开始时间" className={`${inputClass} mt-1`} value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></label>
          <label className="text-xs text-gray-500 dark:text-gray-400">结束时间<input type="datetime-local" required aria-label="结束时间" className={`${inputClass} mt-1`} value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} /></label>
          <label className="text-xs text-gray-500 dark:text-gray-400">模型<input aria-label="模型" placeholder="模型名称" className={`${inputClass} mt-1`} value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} /></label>
          <label className="text-xs text-gray-500 dark:text-gray-400">状态<select aria-label="任务状态" className={`${inputClass} mt-1`} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>{TASK_LOG_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2"><input aria-label="任务 ID" placeholder="任务 ID" className={`${inputClass} flex-1 basis-48`} value={draft.taskId} onChange={e => setDraft({ ...draft, taskId: e.target.value })} /><button type="button" className={buttonClass} onClick={reset}>重置</button><button type="submit" className="h-8 rounded-full bg-blue-500 px-4 text-xs text-white hover:bg-blue-600">搜索</button></div>
        {error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
      </form>
      {logs.isError ? <div role="alert" className="px-5 py-12 text-center"><p className="mb-4 break-words text-sm text-red-500">{logs.error.message}</p><button type="button" className={buttonClass} disabled={!expired && guard.disabled} onClick={expired ? onRequireLogin : refresh}>{expired ? '重新登录' : '重试'}</button></div>
        : logs.isPending ? <p role="status" className="px-5 py-12 text-center text-sm text-gray-500">正在读取任务日志…</p>
          : !items.length ? <p className="px-5 py-12 text-center text-sm text-gray-500">暂无符合条件的任务</p> : <div className="px-4 pb-5 sm:px-5">
            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-white/10"><table className="w-full min-w-[820px] text-left text-xs"><thead className="bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-gray-400"><tr>{['提交时间', '任务 / 模型', '分组', '状态', '进度', '耗时', '额度', ''].map((label, index) => <th key={index} className="whitespace-nowrap px-3 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{items.map(task => <Fragment key={task.id}>
              <tr className="border-t border-gray-100 align-top dark:border-white/10"><td className="whitespace-nowrap px-3 py-3 text-gray-500 dark:text-gray-400">{usageLogTime(task.submitTime)}</td><td className="max-w-[250px] px-3 py-3"><p className="break-all font-medium">{task.model || '—'}</p><p className="mt-1 select-text break-all font-mono text-[11px] text-gray-500 dark:text-gray-400">{task.taskId}</p></td><td className="max-w-[120px] break-all px-3 py-3">{task.group || '—'}</td><td className="whitespace-nowrap px-3 py-3"><TaskStatus task={task} /></td><td className="whitespace-nowrap px-3 py-3">{task.progress || '—'}</td><td className="whitespace-nowrap px-3 py-3">{taskLogDuration(task)}</td><td className="whitespace-nowrap px-3 py-3 font-medium">{money(task.quota)}</td><td className="px-3 py-3"><button type="button" className="whitespace-nowrap text-blue-500 hover:underline" aria-expanded={selected === task.id} onClick={() => toggle(task)}>{selected === task.id ? '收起' : '详情'}</button></td></tr>
              {selected === task.id && <tr><td colSpan={8} className="px-3 pb-3"><TaskLogDetails task={task} profile={profile} session={session} onRequireLogin={onRequireLogin} onSessionUpdated={onSessionUpdated} /></td></tr>}
            </Fragment>)}</tbody></table></div>
          </div>}
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3 text-xs dark:border-white/10"><div className="flex items-center gap-3 text-gray-500 dark:text-gray-400"><label className="flex items-center gap-2">每页<select value={pageSize} className="rounded-lg border border-gray-200 bg-transparent px-2 py-1 dark:border-white/10 dark:bg-gray-900" onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}><option value={20}>20 条</option><option value={50}>50 条</option></select></label>{logs.data && !logs.isError && <span>共 {total.toLocaleString('zh-CN')} 条</span>}</div><div className="flex items-center gap-2"><button type="button" aria-label="上一页" className={buttonClass} disabled={page <= 1 || logs.isFetching} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /></button><span>{page} / {pages}</span><button type="button" aria-label="下一页" className={buttonClass} disabled={page >= pages || logs.isFetching || logs.isError} onClick={() => setPage(page + 1)}><ChevronRight size={14} /></button></div></footer>
  </>
}

function TaskStatus({ task }: { task: AccountTaskLog }) {
  const label = taskLogStatus(task.status)
  const color = label === '失败' ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300' : label === '成功' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
  return <span className={`inline-flex rounded-md px-2 py-1 text-[11px] ${color}`}>{task.mediaSaving ? '保存中' : label}</span>
}

function TaskLogDetails({ task, profile, session, onSessionUpdated, onRequireLogin }: LogPanelProps & { task: AccountTaskLog }) {
  // 普通任务使用列表摘要；只有用户展开异步任务时，才读取其提示词与参数。
  const details = useQuery({
    queryKey: ['wenyun-task-details', profile.baseUrl, session.userId ?? session.username, session.authSessionId ?? session.accessToken, task.taskId],
    queryFn: ({ signal }) => fetchAccountTaskDetails(profile, session, task.taskId, signal, onSessionUpdated),
    enabled: task.isAsync && task.taskId.startsWith('async_'), ...queryOptions,
  })
  const guard = useLogRefreshGuard(Math.max(details.dataUpdatedAt, details.errorUpdatedAt), details.isFetching)
  const expired = isNewApiAuthenticationError(details.error)
  const data = details.data
  return <div className="rounded-xl bg-gray-50 p-4 text-xs dark:bg-white/5"><dl className="grid gap-3 sm:grid-cols-2">
    {[['任务 ID', task.taskId], ['类型', task.action || task.platform || '—'], ['开始时间', task.startTime ? usageLogTime(task.startTime) : '—'], ['完成时间', task.finishTime ? usageLogTime(task.finishTime) : '—'], ...(task.requestPath ? [['请求路径', task.requestPath]] : []), ...(data?.responseStatusCode ? [['响应状态码', String(data.responseStatusCode)]] : [])].map(([label, value]) => <div key={label}><dt className="text-gray-500 dark:text-gray-400">{label}</dt><dd className="mt-1 select-text break-all">{value}</dd></div>)}
    {(data?.error || task.failReason) && <div className="sm:col-span-2"><dt className="text-gray-500 dark:text-gray-400">失败原因</dt><dd className="mt-1 select-text whitespace-pre-wrap break-words text-red-600 [overflow-wrap:anywhere] dark:text-red-300">{data?.error || task.failReason}</dd></div>}
    {data && <><div className="sm:col-span-2"><dt className="text-gray-500 dark:text-gray-400">{data.promptSource === 'upstream_revised' ? '上游修订提示词' : '提示词'}</dt><dd className="mt-1 max-h-60 select-text overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{data.prompt || '—'}</dd></div>{Object.entries(data.parameters).map(([key, value]) => <div key={key}><dt className="text-gray-500 dark:text-gray-400">{key}</dt><dd className="mt-1 select-text break-all">{value}</dd></div>)}</>}
  </dl>{task.mediaExpired && <p className="mt-3 text-amber-600 dark:text-amber-300">结果文件已过期</p>}{details.isFetching && <p role="status" className="mt-3 text-gray-500">正在读取任务详情…</p>}{details.isError && <div role="alert" className="mt-3"><p className="mb-2 text-red-500">{details.error.message}</p><button type="button" className={buttonClass} disabled={!expired && guard.disabled} onClick={() => { if (expired) onRequireLogin(); else if (guard.claim()) void details.refetch({ cancelRefetch: false }) }}>{expired ? '重新登录' : '重试详情'}</button></div>}</div>
}
