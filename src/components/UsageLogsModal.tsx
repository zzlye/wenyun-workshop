import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, RefreshCw, ScrollText, X } from 'lucide-react'
import type { ApiProfile, NewApiAccountSession } from '../types'
import { useStore } from '../store'
import { LOCKED_WENYUN_PROFILE_ID } from '../lib/apiProfiles'
import { fetchNewApiSiteStatus, isNewApiAuthenticationError } from '../lib/newApiAccount'
import { formatLotteryQuota } from '../lib/newApiLottery'
import { defaultUsageLogFilters, fetchAccountUsageLogs, USAGE_LOG_TYPES, usageLogsQuery, usageLogTime, usageLogType, type AccountUsageLog } from '../lib/newApiLogs'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'

const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5'
const inputClass = 'mt-1 block w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-blue-400 dark:border-white/10 dark:bg-gray-950 dark:text-gray-100'

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

export default function UsageLogsModal({ profile, session, onClose, onRequireLogin }: {
  profile: ApiProfile
  session: NewApiAccountSession
  onClose: () => void
  onRequireLogin: () => void
}) {
  const titleId = useId()
  const modalRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [filters, setFilters] = useState(defaultUsageLogFilters)
  const [draft, setDraft] = useState(filters)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [selected, setSelected] = useState<number | null>(null)
  const [filterError, setFilterError] = useState('')
  const accountId = session.userId ?? session.username
  usePreventBackgroundScroll(true, modalRef)
  useCloseOnEscape(true, onClose)

  const onSessionUpdated = useCallback((updated: NewApiAccountSession) => {
    const state = useStore.getState()
    const current = state.settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]
    if (!current || (current.userId ?? current.username) !== accountId) return
    // 迟到的续期只合并同一登录的认证字段，不能恢复退出账号或覆盖新媒体 Key。
    if (current.accessToken !== session.accessToken && (!session.authSessionId || current.authSessionId !== session.authSessionId)) return
    state.setSettings({ newApiAccountSessions: { ...state.settings.newApiAccountSessions, [LOCKED_WENYUN_PROFILE_ID]: {
      ...current, accessToken: updated.accessToken, authSessionId: updated.authSessionId, accessTokenExpiresAt: updated.accessTokenExpiresAt,
    } } })
  }, [accountId, session.accessToken, session.authSessionId])

  const logs = useQuery({
    queryKey: ['wenyun-usage-logs', profile.baseUrl, accountId, session.authSessionId ?? session.accessToken, filters, page, pageSize],
    queryFn: ({ signal }) => fetchAccountUsageLogs(profile, session, filters, page, pageSize, signal, onSessionUpdated),
    // 窗口挂载时读取当前页，关闭后取消请求并释放日志缓存，不轮询或全量同步。
    retry: false, staleTime: 20000, gcTime: 0, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const site = useQuery({
    queryKey: ['wenyun-usage-logs-currency', profile.baseUrl],
    queryFn: ({ signal }) => fetchNewApiSiteStatus(profile, signal),
    retry: false, staleTime: 60000, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const money = (quota: number) => formatLotteryQuota(quota, site.data ?? null)
  const items = logs.isError ? [] : logs.data?.items ?? []
  const total = logs.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const pageCost = items.filter(item => item.type === 2).reduce((sum, item) => sum + (item.subscriptionQuota ?? item.quota), 0)
  const pageRefund = items.filter(item => item.type === 6).reduce((sum, item) => sum + item.quota, 0)
  const hasExpired = isNewApiAuthenticationError(logs.error)

  useEffect(() => { setSelected(null) }, [page, pageSize, filters])
  useEffect(() => {
    // 日志清理后总页数可能收缩，回到仍然存在的末页，避免停留在无效页码。
    if (logs.isSuccess && page > pages) setPage(pages)
  }, [logs.isSuccess, page, pages])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const controls = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0)
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', handleTab)
    return () => { document.removeEventListener('keydown', handleTab); if (previous?.isConnected) previous.focus() }
  }, [])

  const refresh = () => { setSelected(null); void logs.refetch(); if (site.isError) void site.refetch() }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    try {
      usageLogsQuery(draft, 1, pageSize)
      setFilterError('')
      if (page === 1 && JSON.stringify(draft) === JSON.stringify(filters)) refresh()
      else { setFilters({ ...draft }); setPage(1) }
    } catch (error) { setFilterError(error instanceof Error ? error.message : '筛选条件无效') }
  }

  return createPortal(<div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/45 p-2 backdrop-blur-sm sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex h-[88dvh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white text-gray-800 shadow-2xl dark:border-white/10 dark:bg-gray-900 dark:text-gray-100" data-no-drag-select data-canvas-no-zoom>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/10">
        <div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-blue-50 p-2 text-blue-500 dark:bg-blue-500/10"><ScrollText size={20} /></span><div className="min-w-0"><h2 id={titleId} className="text-base font-semibold">使用日志</h2><p className="mt-0.5 truncate text-xs text-gray-500">{session.username}</p></div></div>
        <div className="flex shrink-0 items-center gap-2"><button type="button" className={buttonClass} disabled={logs.isFetching || hasExpired} onClick={refresh}><RefreshCw size={14} className={logs.isFetching ? 'animate-spin' : ''} />刷新</button><button ref={closeRef} type="button" className={buttonClass} aria-label="关闭日志" onClick={onClose}><X size={16} /></button></div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <form className="border-b border-gray-100 p-4 dark:border-white/10 sm:p-5" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <label className="min-w-0 text-xs text-gray-500">开始日期<input required type="date" className={inputClass} value={draft.startDate} onChange={event => setDraft({ ...draft, startDate: event.target.value })} /></label>
            <label className="min-w-0 text-xs text-gray-500">结束日期<input required type="date" className={inputClass} value={draft.endDate} onChange={event => setDraft({ ...draft, endDate: event.target.value })} /></label>
            <label className="min-w-0 text-xs text-gray-500">日志类型<select className={inputClass} value={draft.type} onChange={event => setDraft({ ...draft, type: Number(event.target.value) })}>{USAGE_LOG_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
            <label className="min-w-0 text-xs text-gray-500">模型<input className={inputClass} placeholder="全部模型" value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })} /></label>
            <label className="min-w-0 text-xs text-gray-500">分组<input className={inputClass} placeholder="全部分组" value={draft.group} onChange={event => setDraft({ ...draft, group: event.target.value })} /></label>
            <label className="min-w-0 text-xs text-gray-500">令牌名称<input className={inputClass} placeholder="全部令牌" value={draft.tokenName} onChange={event => setDraft({ ...draft, tokenName: event.target.value })} /></label>
            <label className="min-w-0 text-xs text-gray-500">请求 ID<input className={inputClass} value={draft.requestId} onChange={event => setDraft({ ...draft, requestId: event.target.value })} /></label>
            <label className="min-w-0 text-xs text-gray-500">详情关键词<input className={inputClass} value={draft.detail} onChange={event => setDraft({ ...draft, detail: event.target.value })} /></label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={logs.isFetching || hasExpired} className="rounded-xl bg-blue-500 px-4 py-2 text-xs text-white hover:bg-blue-600 disabled:opacity-40">查询</button>
            <button type="button" className={buttonClass} disabled={logs.isFetching} onClick={() => { const next = defaultUsageLogFilters(); setDraft(next); setFilters(next); setPage(1); setFilterError('') }}>重置</button>
            {filterError && <span role="alert" className="text-xs text-red-500">{filterError}</span>}
          </div>
        </form>
        <div className="grid grid-cols-3 gap-3 px-4 py-4 sm:px-5">
          {[['匹配记录', logs.data && !logs.isError ? `${total.toLocaleString('zh-CN')} 条` : '—'], ['本页消费', logs.data && !logs.isError ? money(pageCost) : '—'], ['本页退款', logs.data && !logs.isError ? money(pageRefund) : '—']].map(([label, value]) => <div key={label} className="min-w-0 rounded-2xl border border-gray-100 p-3 dark:border-white/10"><p className="text-xs text-gray-500">{label}</p><p className="mt-1.5 break-words text-sm font-semibold sm:text-base">{value}</p></div>)}
        </div>
        {logs.isError ? <div role="alert" className="px-5 py-12 text-center"><p className="mb-4 break-words text-sm text-red-500">{logs.error instanceof Error ? logs.error.message : '日志读取失败，请稍后重试'}</p><button type="button" className={buttonClass} disabled={logs.isFetching} onClick={hasExpired ? onRequireLogin : refresh}>{hasExpired ? '重新登录' : '重试'}</button></div>
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
        <label className="flex items-center gap-2 text-gray-500">每页<select className="rounded-lg border border-gray-200 bg-transparent px-2 py-1 dark:border-white/10 dark:bg-gray-900" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}><option value={20}>20 条</option><option value={50}>50 条</option></select></label>
        <div className="flex items-center gap-2"><button type="button" aria-label="上一页" className={buttonClass} disabled={page <= 1 || logs.isFetching} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /></button><span className="text-gray-500">{page} / {pages}</span><button type="button" aria-label="下一页" className={buttonClass} disabled={page >= pages || logs.isFetching || logs.isError} onClick={() => setPage(page + 1)}><ChevronRight size={14} /></button></div>
      </footer>
    </div>
  </div>, document.body)
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
