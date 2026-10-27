import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ScrollText, X } from 'lucide-react'
import type { ApiProfile, NewApiAccountSession } from '../types'
import { useStore } from '../store'
import { LOCKED_WENYUN_PROFILE_ID } from '../lib/apiProfiles'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import UsageLogsPanel from './UsageLogsPanel'
import TaskLogsPanel from './TaskLogsPanel'

export default function UsageLogsModal({ profile, session, onClose, onRequireLogin }: {
  profile: ApiProfile; session: NewApiAccountSession; onClose: () => void; onRequireLogin: () => void
}) {
  const titleId = useId()
  const modalRef = useRef<HTMLDivElement>(null), closeRef = useRef<HTMLButtonElement>(null)
  const [tab, setTab] = useState<'usage' | 'task'>('usage')
  const accountId = session.userId ?? session.username
  usePreventBackgroundScroll(true, modalRef)
  useCloseOnEscape(true, onClose)
  const onSessionUpdated = useCallback((updated: NewApiAccountSession) => {
    const state = useStore.getState()
    const current = state.settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]
    if (!current || (current.userId ?? current.username) !== accountId) return
    // 迟到的续期只合并同一登录的认证字段，不恢复退出账号或覆盖新媒体 Key。
    if (current.accessToken !== session.accessToken && (!session.authSessionId || current.authSessionId !== session.authSessionId)) return
    state.setSettings({ newApiAccountSessions: { ...state.settings.newApiAccountSessions, [LOCKED_WENYUN_PROFILE_ID]: {
      ...current, accessToken: updated.accessToken, authSessionId: updated.authSessionId, accessTokenExpiresAt: updated.accessTokenExpiresAt,
    } } })
  }, [accountId, session.accessToken, session.authSessionId])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || modalRef.current?.querySelector('[data-task-details-dialog]')) return
      const controls = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0)
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', handleTab)
    return () => { document.removeEventListener('keydown', handleTab); if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(<div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/45 p-2 backdrop-blur-sm sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="account-logs relative flex h-[88dvh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white text-gray-800 shadow-2xl dark:border-white/10 dark:bg-gray-900 dark:text-gray-100" data-no-drag-select data-canvas-no-zoom>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/10">
        <div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-blue-50 p-2 text-blue-500 dark:bg-blue-500/10"><ScrollText size={20} /></span><div className="min-w-0"><h2 id={titleId} className="text-base font-semibold">使用日志</h2><p className="mt-0.5 truncate text-xs text-gray-500">{session.username}</p></div></div>
        <button ref={closeRef} type="button" className="rounded-xl border border-gray-200 p-2 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5" aria-label="关闭日志" onClick={onClose}><X size={16} /></button>
      </header>
      <div role="tablist" aria-label="日志类别" className="flex shrink-0 gap-1 border-b border-gray-100 px-5 pt-2 dark:border-white/10">
        {([['usage', '使用日志'], ['task', '任务日志']] as const).map(([value, label]) => <button key={value} id={`${titleId}-${value}`} role="tab" type="button" aria-selected={tab === value} aria-controls={`${titleId}-panel`} className={`border-b-2 px-4 py-2 text-sm ${tab === value ? 'border-blue-500 text-blue-500' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'}`} onClick={() => setTab(value)}>{label}</button>)}
      </div>
      <div id={`${titleId}-panel`} role="tabpanel" aria-labelledby={`${titleId}-${tab}`} className="flex min-h-0 flex-1 flex-col">
        {/* 只挂载当前页签，切换或关窗会取消旧面板仍在读取的请求。 */}
        {tab === 'usage' ? <UsageLogsPanel profile={profile} session={session} onRequireLogin={onRequireLogin} onSessionUpdated={onSessionUpdated} /> : <TaskLogsPanel profile={profile} session={session} onRequireLogin={onRequireLogin} onSessionUpdated={onSessionUpdated} />}
      </div>
    </div>
  </div>, document.body)
}
