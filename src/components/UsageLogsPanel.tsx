import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { fetchNewApiSiteStatus, isNewApiAuthenticationError } from '../lib/newApiAccount'
import { formatLotteryQuota } from '../lib/newApiLottery'
import { defaultUsageLogFilters, fetchAccountUsageLogs, fetchAccountUsageStats, fetchAccountLogGroups, canQueryUsageStats, usageLogsQuery, usageLogTime, usageLogType, type AccountUsageLog } from '../lib/newApiLogs'
import { useLogRefreshGuard } from '../hooks/useLogRefreshGuard'
import type { LogPanelProps } from './TaskLogsPanel'
import UsageLogsFilters from './UsageLogsFilters'
const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5'

function LogBadge({ type }: { type: number }) {
  const color = type === 5 ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300'
    : type === 6 || type === 1 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
      : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
  return <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-medium ${color}`}>{usageLogType(type)}</span>
}

function LogDetails({ log }: { log: AccountUsageLog }) {
  return <dl className="grid gap-3 rounded-xl bg-gray-50 p-4 text-xs dark:bg-white/5 sm:grid-cols-2">
    <div><dt className="text-gray-500">请求 ID</dt><dd className="mt-1 select-text break-all font-mono">{log.requestId || '—'}</dd></div>
    <div><dt className="text-gray-500">上游请求 ID</dt><dd className="mt-1 select-text break-all font-mono">{log.upstreamRequestId || '—'}</dd></div>
    <div><dt className="text-gray-500">输出方式</dt><dd className="mt-1">{log.stream ? '流式' : '非流式'}</dd></div>
    {log.billingSource && <div><dt className="text-gray-500">扣费来源</dt><dd className="mt-1">{log.billingSource === 'subscription' ? '订阅' : '钱包'}</dd></div>}
    <div><dt className="text-gray-500">序号</dt><dd className="mt-1">{log.id}</dd></div>
    <div className="sm:col-span-2"><dt className="text-gray-500">详情</dt><dd className="mt-1 select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{log.content || '—'}</dd></div>
  </dl>
}


export default function UsageLogsPanel({ profile, session, onRequireLogin, onSessionUpdated }: LogPanelProps) {
  const [filters, setFilters] = useState(defaultUsageLogFilters)
  const [draft, setDraft] = useState(filters)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [selected, setSelected] = useState<number | null>(null)
  const [filterError, setFilterError] = useState('')
  const [visible, setVisible] = useState(true)
  const accountId = session.userId ?? session.username

  const logs = useQuery({
    queryKey: ['wenyun-usage-logs', profile.baseUrl, accountId, session.authSessionId ?? session.accessToken, filters, page, pageSize],
    queryFn: ({ signal }) => fetchAccountUsageLogs(profile, session, filters, page, pageSize, signal, onSessionUpdated),
    // 只读取当前页，关窗取消请求；短时复用相同查询，闲置一分钟自动释放缓存。
    retry: false, retryOnMount: false, staleTime: 20000, gcTime: 60000, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const site = useQuery({
    queryKey: ['wenyun-usage-logs-currency', profile.baseUrl],
    queryFn: ({ signal }) => fetchNewApiSiteStatus(profile, signal),
    retry: false, retryOnMount: false, staleTime: 60000, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const statsSupported = canQueryUsageStats(filters)
  const stats = useQuery({
    queryKey: ['wenyun-usage-stats', profile.baseUrl, accountId, session.authSessionId ?? session.accessToken, filters],
    queryFn: ({ signal }) => fetchAccountUsageStats(profile, session, filters, signal, onSessionUpdated),
    enabled: statsSupported && logs.isSuccess,
    // 汇总不随翻页重复查询，不轮询；只有筛选变化或主动刷新才重新获取。
    retry: false, retryOnMount: false, staleTime: Infinity, gcTime: 60000, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const groups = useQuery({
    queryKey: ['wenyun-log-groups', profile.baseUrl, accountId, session.authSessionId ?? session.accessToken],
    queryFn: ({ signal }) => fetchAccountLogGroups(profile, session, signal, onSessionUpdated),
    retry: false, retryOnMount: false, staleTime: 60000, gcTime: 60000, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const guard = useLogRefreshGuard(Math.max(logs.dataUpdatedAt, logs.errorUpdatedAt, stats.dataUpdatedAt, stats.errorUpdatedAt), logs.isFetching || stats.isFetching)
  const money = (quota: number) => visible ? formatLotteryQuota(quota, site.data ?? null) : '••••'
  const items = logs.isError ? [] : logs.data?.items ?? []
  const total = logs.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const hasExpired = isNewApiAuthenticationError(logs.error)

  useEffect(() => { setSelected(null) }, [page, pageSize, filters])
  useEffect(() => {
    // 日志清理后总页数可能收缩，回到仍然存在的末页，避免停留在无效页码。
    if (logs.isSuccess && page > pages) setPage(pages)
  }, [logs.isSuccess, page, pages])

  const refresh = () => {
    if (hasExpired || !guard.claim()) return
    setSelected(null)
    void logs.refetch({ cancelRefetch: false })
    if (statsSupported && !stats.isFetching && logs.isSuccess) void stats.refetch({ cancelRefetch: false })
    if (groups.isError) void groups.refetch({ cancelRefetch: false })
    if (site.isError) void site.refetch({ cancelRefetch: false })
  }
  const reset = () => {
    const next = defaultUsageLogFilters()
    setDraft(next); setFilterError(''); setSelected(null)
    if (page === 1 && JSON.stringify(next) === JSON.stringify(filters)) refresh()
    else { setFilters(next); setPage(1) }
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    try {
      usageLogsQuery(draft, 1, pageSize)
      setFilterError('')
      if (page === 1 && JSON.stringify(draft) === JSON.stringify(filters)) refresh()
      else { setFilters({ ...draft }); setPage(1) }
    } catch (error) { setFilterError(error instanceof Error ? error.message : '筛选条件无效') }
  }


  return <>
    <div className="flex shrink-0 justify-end px-5 py-2"><button type="button" className={buttonClass} disabled={guard.disabled || hasExpired} onClick={refresh}><RefreshCw size={14} className={logs.isFetching ? 'animate-spin' : ''} />刷新</button></div>
      <div className="min-h-0 flex-1 overflow-auto pt-4">
        <UsageLogsFilters draft={draft} setDraft={setDraft}
          groups={[...new Set([...(groups.data ?? []), ...items.map(item => item.group).filter(Boolean)])]}
          groupsError={groups.error?.message} models={[...new Set(items.map(item => item.model).filter(Boolean))]}
          fetching={logs.isFetching} error={filterError} stats={statsSupported ? stats.data : undefined}
          statsError={statsSupported ? stats.error?.message : undefined} statsSupported={statsSupported}
          money={money} visible={visible} setVisible={setVisible} onSubmit={submit} onReset={reset}
          onRetryStats={refresh} />
        {logs.isError ? <div role="alert" className="px-5 py-12 text-center"><p className="mb-4 break-words text-sm text-red-500">{logs.error instanceof Error ? logs.error.message : '日志读取失败，请稍后重试'}</p><button type="button" className={buttonClass} disabled={!hasExpired && guard.disabled} onClick={hasExpired ? onRequireLogin : refresh}>{hasExpired ? '重新登录' : '重试'}</button></div>
          : logs.isPending ? <p role="status" className="px-5 py-12 text-center text-sm text-gray-500">正在读取日志…</p>
            : items.length === 0 ? <p className="px-5 py-12 text-center text-sm text-gray-500">暂无符合条件的日志</p>
              : <div className="px-4 pb-5 sm:px-5">
                <div className="hidden overflow-x-auto rounded-xl border border-gray-100 dark:border-white/10 md:block">
                  <table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-gray-50 text-gray-500 dark:bg-white/5"><tr>{['时间', '类型', '模型 / 分组', '令牌', '输入 / 输出', '耗时', '额度', ''].map((label, index) => <th key={index} className="whitespace-nowrap px-3 py-3 font-medium">{label}</th>)}</tr></thead>
                    <tbody>{items.map(log => <LogRows key={log.id} log={log} money={money} expanded={selected === log.id} toggle={() => setSelected(selected === log.id ? null : log.id)} />)}</tbody>
                  </table>
                </div>
                <div className="space-y-3 md:hidden">{items.map(log => <article key={log.id} className="rounded-2xl border border-gray-100 p-3 dark:border-white/10">
                  <div className="flex items-center justify-between gap-2"><LogBadge type={log.type} /><time className="text-[11px] text-gray-500">{usageLogTime(log.createdAt)}</time></div>
                  <p className="mt-3 break-all text-sm font-medium">{log.model || '—'}</p><p className="mt-1 break-all text-xs text-gray-500">{log.group || '—'} · {log.tokenName || '—'}</p>
                  <div className="my-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold">{money(log.subscriptionQuota ?? log.quota)}</span><span className="text-gray-500">输入 {log.promptTokens.toLocaleString('zh-CN')} / 输出 {log.completionTokens.toLocaleString('zh-CN')} · {log.seconds}s</span></div>
                  <button type="button" className={buttonClass} aria-expanded={selected === log.id} onClick={() => setSelected(selected === log.id ? null : log.id)}>{selected === log.id ? '收起' : '详情'}</button>
                  {selected === log.id && <div className="mt-3"><LogDetails log={log} /></div>}
                </article>)}</div>
              </div>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-xs dark:border-white/10 sm:px-5">
        <div className="flex items-center gap-3 text-gray-500"><label className="flex items-center gap-2">每页<select className="rounded-lg border border-gray-200 bg-transparent px-2 py-1 dark:border-white/10 dark:bg-gray-900" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}><option value={20}>20 条</option><option value={50}>50 条</option></select></label>{logs.data && !logs.isError && <span>共 {total.toLocaleString('zh-CN')} 条</span>}</div>
        <div className="flex items-center gap-2"><button type="button" aria-label="上一页" className={buttonClass} disabled={page <= 1 || logs.isFetching} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /></button><span className="text-gray-500">{page} / {pages}</span><button type="button" aria-label="下一页" className={buttonClass} disabled={page >= pages || logs.isFetching || logs.isError} onClick={() => setPage(page + 1)}><ChevronRight size={14} /></button></div>
      </footer>

  </>
}
function LogRows({ log, money, expanded, toggle }: { log: AccountUsageLog; money: (quota: number) => string; expanded: boolean; toggle: () => void }) {
  return <>
    <tr className="border-t border-gray-100 align-top dark:border-white/10">
      <td className="whitespace-nowrap px-3 py-3 text-gray-500">{usageLogTime(log.createdAt)}</td><td className="px-3 py-3"><LogBadge type={log.type} /></td>
      <td className="max-w-[240px] break-words px-3 py-3 [overflow-wrap:anywhere]"><p className="font-medium">{log.model || '—'}</p><p className="mt-1 text-gray-500">{log.group || '—'}</p></td>
      <td className="max-w-[130px] break-words px-3 py-3 [overflow-wrap:anywhere]">{log.tokenName || '—'}</td>
      <td className="whitespace-nowrap px-3 py-3 tabular-nums">{log.promptTokens.toLocaleString('zh-CN')} / {log.completionTokens.toLocaleString('zh-CN')}</td><td className="whitespace-nowrap px-3 py-3">{log.seconds}s</td><td className="whitespace-nowrap px-3 py-3 font-medium tabular-nums">{money(log.subscriptionQuota ?? log.quota)}</td>
      <td className="px-3 py-3"><button type="button" className="whitespace-nowrap text-blue-500 hover:underline" aria-expanded={expanded} onClick={toggle}>{expanded ? '收起' : '详情'}</button></td>
    </tr>
    {expanded && <tr><td colSpan={8} className="px-3 pb-3"><LogDetails log={log} /></td></tr>}
  </>
}
