import { useId, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronUp, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { defaultUsageLogFilters, USAGE_LOG_TYPES, type UsageLogFilters, type AccountUsageStats } from '../lib/newApiLogs'

const inputClass = 'h-8 w-full min-w-0 rounded-full border border-gray-200 bg-white/80 px-3 text-xs text-gray-800 outline-none focus:border-blue-400 dark:border-white/15 dark:bg-white/[0.04] dark:text-gray-100'
const buttonClass = 'inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-full border border-gray-200 bg-white/70 px-3 text-xs transition hover:bg-gray-100 dark:border-white/15 dark:bg-white/5 dark:hover:bg-white/10'

export default function UsageLogsFilters({ draft, setDraft, groups, groupsError, models, fetching, error, stats, statsError, statsSupported, money, visible, setVisible, onSubmit, onReset, onRetryStats }: {
  draft: UsageLogFilters
  setDraft: (value: UsageLogFilters) => void
  groups: string[]
  groupsError?: string
  models: string[]
  fetching: boolean
  error: string
  stats?: AccountUsageStats
  statsError?: string
  statsSupported: boolean
  money: (quota: number) => string
  visible: boolean
  setVisible: (value: boolean) => void
  onSubmit: (event: React.FormEvent) => void
  onReset: () => void
  onRetryStats: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [dateOpen, setDateOpen] = useState(false)
  const modelId = useId(), moreId = useId()
  const rangeText = `${draft.startDate.replace('T', ' ')} ~ ${draft.endDate.replace('T', ' ')}`
  const preset = (days: number) => {
    const next = defaultUsageLogFilters()
    const start = new Date(`${next.startDate}:00`)
    start.setDate(start.getDate() - days + 1)
    setDraft({ ...draft, startDate: defaultUsageLogFilters(start).startDate, endDate: next.endDate })
    setDateOpen(false)
  }
  return <form aria-label="日志筛选" onSubmit={onSubmit} className="relative mx-4 mb-4 rounded-2xl border border-gray-200/80 bg-gray-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03] sm:mx-5">
    <div className="grid min-w-0 grid-cols-2 items-center gap-2 lg:grid-cols-[minmax(300px,2fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(110px,1fr)_auto]">
      <div className="relative col-span-2 min-w-0 lg:col-span-1">
        <button type="button" aria-label="时间范围" aria-expanded={dateOpen} onClick={() => setDateOpen(!dateOpen)} className={`${inputClass} flex items-center gap-2 text-left`}><CalendarDays size={14} className="shrink-0" /><span className="truncate">{rangeText}</span></button>
        {dateOpen && <div className="absolute left-0 top-10 z-20 w-[min(380px,calc(100vw-64px))] rounded-2xl border border-gray-200 bg-white p-3 shadow-xl dark:border-white/15 dark:bg-gray-900">
          <div className="mb-3 flex flex-wrap gap-2">{[[1, '今天'], [7, '近7天'], [30, '近30天']].map(([days, label]) => <button type="button" key={days} className={buttonClass} onClick={() => preset(Number(days))}>{label}</button>)}</div>
          <label className="block text-xs text-gray-500">开始时间<input type="datetime-local" required aria-label="开始时间" className={`${inputClass} mt-1`} value={draft.startDate} onChange={event => setDraft({ ...draft, startDate: event.target.value })} /></label>
          <label className="mt-3 block text-xs text-gray-500">结束时间<input type="datetime-local" required aria-label="结束时间" className={`${inputClass} mt-1`} value={draft.endDate} onChange={event => setDraft({ ...draft, endDate: event.target.value })} /></label>
          <div className="mt-3 flex justify-end"><button type="button" className={buttonClass} onClick={() => setDateOpen(false)}>确定</button></div>
        </div>}
      </div>
      <input aria-label="模型" list={modelId} className={inputClass} placeholder="模型名称" value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })} />
      <datalist id={modelId}>{models.map(model => <option key={model} value={model} />)}</datalist>
      <select aria-label="分组" title={groupsError} className={inputClass} value={draft.group} onChange={event => setDraft({ ...draft, group: event.target.value })}><option value="">全部分组</option>{[...new Set([...groups, draft.group].filter(Boolean))].map(group => <option key={group} value={group}>{group}</option>)}</select>
      <select aria-label="日志类型" className={inputClass} value={draft.type} onChange={event => setDraft({ ...draft, type: Number(event.target.value) })}>{USAGE_LOG_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
      <button type="button" aria-expanded={expanded} aria-controls={moreId} className={buttonClass} onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '展开'}{expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
    </div>
    {expanded && <div id={moreId} className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
      <input aria-label="令牌名称" className={inputClass} placeholder="令牌名称" value={draft.tokenName} onChange={event => setDraft({ ...draft, tokenName: event.target.value })} />
      <input aria-label="详情关键词" maxLength={256} className={inputClass} placeholder="详情 / 错误代码" value={draft.detail} onChange={event => setDraft({ ...draft, detail: event.target.value })} />
      <input aria-label="请求 ID" className={inputClass} placeholder="请求 ID" value={draft.requestId} onChange={event => setDraft({ ...draft, requestId: event.target.value })} />
      <input aria-label="上游请求 ID" className={inputClass} placeholder="上游请求 ID" value={draft.upstreamRequestId ?? ''} onChange={event => setDraft({ ...draft, upstreamRequestId: event.target.value })} />
    </div>}
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {([['用量', stats ? money(stats.quota) : '—', '所选时间范围的消费总额'], ['RPM', stats ? stats.rpm.toLocaleString('zh-CN') : '—', '最近60秒的请求数'], ['TPM', stats ? stats.tpm.toLocaleString('zh-CN') : '—', '最近60秒的 Token 数']] as const).map(([label, value, title]) => <span key={label} title={!statsSupported ? '当前请求编号筛选暂不支持汇总统计' : title} className="inline-flex h-7 items-center gap-2 rounded-lg border border-gray-200 bg-white/50 px-2 dark:border-white/10 dark:bg-white/5"><span className={label === 'RPM' ? 'h-3 w-0.5 bg-rose-400' : 'h-3 w-0.5 bg-blue-400'} /><span className="text-gray-500">{label}</span><span className="font-mono font-semibold">{visible ? value : '••••'}</span></span>)}
        {statsError && <button type="button" className="text-amber-600 dark:text-amber-300" title={statsError} onClick={onRetryStats}>统计暂不可用 · 重试</button>}
      </div>
      <div className="ml-auto flex items-center gap-2"><button type="button" className={buttonClass} aria-label={visible ? '隐藏用量' : '显示用量'} onClick={() => setVisible(!visible)}>{visible ? <Eye size={14} /> : <EyeOff size={14} />}</button><button type="button" className={buttonClass} onClick={onReset}>重置</button><button type="submit" className="inline-flex h-8 items-center gap-1 rounded-full bg-blue-500 px-4 text-xs text-white hover:bg-blue-600">{fetching && <RefreshCw size={12} className="animate-spin" />}搜索</button></div>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
  </form>
}
