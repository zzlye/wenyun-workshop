import { useEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'

export function logDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function logDatePreset(kind: 'today' | '7d' | 'week' | '30d' | 'month', now = new Date()) {
  const start = new Date(now), end = new Date(now)
  start.setHours(0, 0, 0, 0); end.setHours(23, 59, 59, 999)
  if (kind === '7d') start.setDate(start.getDate() - 6)
  if (kind === '30d') start.setDate(start.getDate() - 29)
  // 与 NewAPI 当前日期库的默认周界限一致：周日开始、周六结束。
  if (kind === 'week') { start.setDate(start.getDate() - start.getDay()); end.setTime(start.getTime()); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999) }
  if (kind === 'month') { start.setDate(1); end.setMonth(end.getMonth() + 1, 0) }
  return { startDate: logDateInput(start), endDate: logDateInput(end) }
}

const inputClass = 'h-8 w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 outline-none focus:border-blue-400 dark:border-white/15 dark:bg-gray-900 dark:text-gray-100'

export default function LogDateRangePicker({ startDate, endDate, onChange }: { startDate: string; endDate: string; onChange: (range: { startDate: string; endDate: string }) => void }) {
  const [open, setOpen] = useState(false), [error, setError] = useState('')
  const [draft, setDraft] = useState({ startDate, endDate })
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const close = () => { setOpen(false); trigger.current?.focus() }
  useCloseOnEscape(open, close)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])
  const apply = () => {
    if (!draft.startDate || !draft.endDate || !Number.isFinite(new Date(draft.startDate).getTime()) || !Number.isFinite(new Date(draft.endDate).getTime())) { setError('请选择有效的时间范围'); return }
    if (draft.startDate > draft.endDate) { setError('开始时间不能晚于结束时间'); return }
    onChange(draft); close()
  }
  return <div ref={root} className="relative min-w-0">
    <button ref={trigger} type="button" aria-label="时间范围" aria-expanded={open} className={`${inputClass} flex items-center gap-2 text-left`} onClick={() => { if (!open) { setDraft({ startDate, endDate }); setError('') }; setOpen(!open) }}><CalendarDays size={14} className="shrink-0 text-gray-500" /><span className="truncate tabular-nums">{startDate.replace('T', ' ')} ~ {endDate.replace('T', ' ')}</span></button>
    {open && <div role="group" aria-label="选择时间范围" className="absolute left-0 top-10 z-30 w-[min(520px,calc(100vw-4rem))] rounded-xl border border-gray-200 bg-white p-3 shadow-xl dark:border-white/15 dark:bg-gray-900">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-end"><label className="min-w-0 text-xs text-gray-500 dark:text-gray-400">开始时间<input autoFocus type="datetime-local" aria-label="开始时间" className={`${inputClass} mt-1.5`} value={draft.startDate} onChange={event => setDraft({ ...draft, startDate: event.target.value })} /></label><span className="hidden pb-2 text-xs text-gray-400 sm:block">~</span><label className="min-w-0 text-xs text-gray-500 dark:text-gray-400">结束时间<input type="datetime-local" aria-label="结束时间" className={`${inputClass} mt-1.5`} value={draft.endDate} onChange={event => setDraft({ ...draft, endDate: event.target.value })} /></label></div>
      <div className="mt-3 flex flex-wrap gap-1.5">{([['today', '今天'], ['7d', '近7天'], ['week', '本周'], ['30d', '近30天'], ['month', '本月']] as const).map(([kind, label]) => <button key={kind} type="button" className="h-7 flex-1 whitespace-nowrap rounded-md bg-gray-100 px-2 text-xs hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10" onClick={() => { onChange(logDatePreset(kind)); close() }}>{label}</button>)}</div>
      {error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}<div className="mt-3 flex justify-end"><button type="button" className="h-8 rounded-md bg-blue-500 px-4 text-xs text-white hover:bg-blue-600" onClick={apply}>确定</button></div>
    </div>}
  </div>
}
