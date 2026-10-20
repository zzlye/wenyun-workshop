import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Gift,
  History,
  RefreshCw,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react'
import { LOCKED_WENYUN_PROFILE_ID, normalizeSettings } from '../lib/apiProfiles'
import {
  fetchNewApiAccountBalance,
  fetchNewApiSiteStatus,
  isNewApiBusinessRejection,
} from '../lib/newApiAccount'
import {
  clearLotteryRequest,
  drawNewApiLottery,
  ensureLotteryRequest,
  fetchLotteryActivities,
  fetchLotteryDraws,
  fetchLotteryWinners,
  formatLotteryQuota,
  lotteryParticipation,
  lotteryPeriod,
  lotteryRequestKey,
  hasUnseenLottery,
  LOTTERY_SEEN_EVENT,
  lotterySeenKey,
  markLotteriesSeen,
  readSeenLotteryIds,
  readLotteryRequest,
  type LotteryDraw,
} from '../lib/newApiLottery'
import { useStore } from '../store'
import type { ApiProfile, NewApiAccountSession } from '../types'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'

const statusLabels = { active: '进行中', paused: '已暂停', ended: '已结束', exhausted: '奖池已领完' }
const buttonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5'

function useLotterySessionUpdate(session?: NewApiAccountSession) {
  const accountId = session?.userId ?? session?.username
  return useCallback(
    (updated: NewApiAccountSession) => {
      const state = useStore.getState()
      const current = state.settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]
      if (!current || (current.userId ?? current.username) !== accountId) return
      // 同一账号重新登录后，也不能用旧设备会话的迟到续期覆盖新登录。
      if (
        current.accessToken !== session?.accessToken &&
        (!session?.authSessionId || current.authSessionId !== session.authSessionId)
      )
        return
      state.setSettings({
        newApiAccountSessions: {
          ...state.settings.newApiAccountSessions,
          [LOCKED_WENYUN_PROFILE_ID]: {
            ...current,
            accessToken: updated.accessToken,
            authSessionId: updated.authSessionId,
            accessTokenExpiresAt: updated.accessTokenExpiresAt,
          },
        },
      })
    },
    [accountId, session?.accessToken, session?.authSessionId],
  )
}

export function LotteryButton({
  onRequireLogin,
  className,
  style,
}: {
  onRequireLogin?: () => void
  className?: string
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const settings = useStore((state) => state.settings)
  const session = settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]
  const profile = normalizeSettings(settings).profiles.find((item) => item.id === LOCKED_WENYUN_PROFILE_ID)!
  const close = useCallback(() => setOpen(false), [])
  const onSessionUpdated = useLotterySessionUpdate(session)
  const accountId = session?.userId ?? session?.username
  const [, refreshSeen] = useState(0)
  const activities = useQuery({
    queryKey: ['wenyun-lottery', profile.baseUrl, accountId, session?.authSessionId, 'activities', 1],
    queryFn: ({ signal }) => fetchLotteryActivities(profile, session!, 1, signal, onSessionUpdated),
    enabled: !!session,
    retry: false,
    refetchInterval: 15000,
    staleTime: 10000,
  })
  useEffect(() => {
    // 页面内多个入口与其他标签页共用已读状态，避免查看后还有残留红点。
    const sync = () => refreshSeen((value) => value + 1)
    window.addEventListener(LOTTERY_SEEN_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(LOTTERY_SEEN_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  const unread =
    !!session &&
    hasUnseenLottery(
      activities.data?.items ?? [],
      readSeenLotteryIds(lotterySeenKey(profile.baseUrl, accountId!)),
    )
  return (
    <>
      <button
        type="button"
        aria-label="幸运抽奖"
        className={`relative inline-flex shrink-0 items-center justify-center gap-1.5 ${className || buttonClass}`}
        style={style}
        onClick={() => (session ? setOpen(true) : onRequireLogin?.())}
      >
        <Gift size={13} aria-hidden />
        幸运抽奖
        {unread && (
          <span
            role="status"
            aria-label="有新抽奖活动"
            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-gray-950"
          />
        )}
      </button>
      {open && session && (
        <LotteryModal
          key={`${session.userId ?? session.username}:${session.authSessionId ?? ''}`}
          profile={profile}
          session={session}
          onClose={close}
        />
      )}
    </>
  )
}

export default function LotteryModal({
  profile,
  session,
  onClose,
}: {
  profile: ApiProfile
  session: NewApiAccountSession
  onClose: () => void
}) {
  const client = useQueryClient()
  const modalRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const drawLock = useRef(false)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [showHistory, setShowHistory] = useState(false)
  const [result, setResult] = useState<LotteryDraw | null>(null)
  const [, setRequestVersion] = useState(0)
  const accountId = session.userId ?? session.username
  const key = ['wenyun-lottery', profile.baseUrl, accountId, session.authSessionId]
  usePreventBackgroundScroll(true, modalRef)
  useCloseOnEscape(true, onClose)

  const onSessionUpdated = useLotterySessionUpdate(session)

  const query = useQuery({
    queryKey: [...key, 'activities', page],
    queryFn: ({ signal }) => fetchLotteryActivities(profile, session, page, signal, onSessionUpdated),
    retry: false,
    refetchInterval: 15000,
  })
  useEffect(() => {
    if (query.isSuccess && query.data)
      markLotteriesSeen(lotterySeenKey(profile.baseUrl, accountId), query.data.items)
  }, [query.data, query.isSuccess, profile.baseUrl, accountId])
  const site = useQuery({
    queryKey: ['wenyun-lottery-currency', profile.baseUrl],
    queryFn: ({ signal }) => fetchNewApiSiteStatus(profile, signal),
    retry: false,
    staleTime: 30000,
  })
  const activity = query.data?.items.find((item) => item.id === selectedId) ?? query.data?.items[0]
  const activityId = activity?.id
  useEffect(() => {
    // 抽完后活动可能被服务端重新排序，仍保留当前活动与开奖结果。
    if (activityId !== undefined && selectedId !== activityId) setSelectedId(activityId)
  }, [activityId, selectedId])
  const history = useQuery({
    queryKey: [...key, 'history', activityId, historyPage],
    queryFn: ({ signal }) =>
      fetchLotteryDraws(profile, session, activityId!, historyPage, signal, onSessionUpdated),
    enabled: !!activityId && showHistory,
    retry: false,
  })
  const winners = useQuery({
    queryKey: [...key, 'winners', activityId],
    queryFn: ({ signal }) => fetchLotteryWinners(profile, session, activityId!, signal, onSessionUpdated),
    enabled: !!activityId,
    retry: false,
    refetchInterval: 15000,
  })
  const money = (quota: number) => formatLotteryQuota(quota, site.data ?? null)
  const requestKey = activityId ? lotteryRequestKey(accountId, activityId) : ''
  const retrying = !!requestKey && !!readLotteryRequest(requestKey)

  const draw = useMutation({
    mutationFn: (id: number) =>
      drawNewApiLottery(
        profile,
        session,
        id,
        ensureLotteryRequest(lotteryRequestKey(accountId, id)),
        onSessionUpdated,
      ),
    retry: false,
    onSuccess: (reward) => {
      clearLotteryRequest(lotteryRequestKey(accountId, reward.activity_id))
      setResult(reward)
      // 开奖响应已经确认到账；余额刷新不阻塞结果，也不把刷新失败当作抽奖失败。
      void fetchNewApiAccountBalance(profile, session, onSessionUpdated)
        .then((updated) => {
          const state = useStore.getState()
          const current = state.settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]
          // 奖励响应只更新原账号余额，不覆盖切换后的账号或独立视频凭据。
          if (current && (current.userId ?? current.username) === accountId)
            state.setSettings({
              newApiAccountSessions: {
                ...state.settings.newApiAccountSessions,
                [LOCKED_WENYUN_PROFILE_ID]: {
                  ...current,
                  balanceText: updated.balanceText,
                  balanceSource: updated.balanceSource,
                  balanceUpdatedAt: updated.balanceUpdatedAt,
                },
              },
            })
        })
        .catch(() => useStore.getState().showToast('奖励已到账，账号余额暂未刷新', 'error'))
    },
    onError: (error, id) => {
      // 明确拒绝可重新申请；断网或响应丢失必须保留编号以取回同一次奖励。
      if (isNewApiBusinessRejection(error)) clearLotteryRequest(lotteryRequestKey(accountId, id))
    },
    onSettled: () => {
      drawLock.current = false
      setRequestVersion((value) => value + 1)
      void client.invalidateQueries({ queryKey: key })
    },
  })

  useEffect(() => {
    setShowHistory(false)
    setHistoryPage(1)
    setResult(null)
  }, [activityId])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const controls = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),select,a[href],[tabindex="0"]',
        ) ?? [],
      )
      const first = controls[0],
        last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      previous?.focus()
    }
  }, [onClose])

  const participation = activity ? lotteryParticipation(activity) : null
  const unavailable = query.isError && (query.error as { status?: number }).status === 404
  return createPortal(
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="幸运抽奖"
        data-canvas-no-zoom
        className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-3xl bg-white text-slate-800 shadow-2xl dark:bg-gray-950 dark:text-gray-100"
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-5 dark:border-white/10">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-blue-50 p-2.5 text-blue-500 dark:bg-blue-500/10">
              <Gift size={21} />
            </span>
            <div>
              <h2 className="text-lg font-semibold">幸运抽奖</h2>
              <p className="mt-0.5 text-xs text-slate-400">好手气，为灵感加点惊喜</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={query.isFetching}
              aria-label="刷新抽奖活动"
              onClick={() => void client.invalidateQueries({ queryKey: key })}
            >
              <RefreshCw size={14} className={query.isFetching ? 'animate-spin' : ''} />
            </button>
            <button
              ref={closeRef}
              type="button"
              className={buttonClass}
              aria-label="关闭抽奖"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="space-y-5 p-5 sm:p-7">
          {query.isPending && (
            <div role="status" className="py-16 text-center text-sm text-slate-400">
              正在加载活动…
            </div>
          )}
          {query.isError && (
            <div role="alert" className="rounded-2xl bg-slate-50 p-8 text-center text-sm dark:bg-white/5">
              <Gift size={32} className="mx-auto mb-3 text-slate-300" />
              {unavailable ? '抽奖活动暂未开放' : query.error.message}
              <button className={`${buttonClass} mx-auto mt-4 flex`} onClick={() => void query.refetch()}>
                重新加载
              </button>
            </div>
          )}
          {!query.isPending && !query.isError && !activity && (
            <div className="py-16 text-center text-sm text-slate-400">
              <Gift size={36} className="mx-auto mb-4" />
              暂时没有抽奖活动，敬请期待
            </div>
          )}
          {activity && !query.isError && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <h3 className="truncate text-lg font-semibold">{activity.name}</h3>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${activity.status === 'active' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10' : 'bg-slate-100 text-slate-500 dark:bg-white/10'}`}
                  >
                    {statusLabels[activity.status] ?? activity.status}
                  </span>
                </div>
                {(query.data?.items.length ?? 0) > 1 && (
                  <select
                    aria-label="选择抽奖活动"
                    className="max-w-[220px] rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-xs dark:border-white/10"
                    value={activity.id}
                    disabled={draw.isPending}
                    onChange={(event) => setSelectedId(Number(event.target.value))}
                  >
                    {query.data?.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <section className="grid overflow-hidden rounded-2xl border border-blue-100 dark:border-blue-500/20 sm:grid-cols-[1.1fr_1fr]">
                <div className="relative flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-blue-50 via-white to-rose-50/60 px-5 py-10 text-center dark:from-blue-950/40 dark:via-gray-900 dark:to-rose-950/20">
                  <Sparkles className="absolute right-8 top-8 text-amber-300" size={20} />
                  <span className="mb-5 flex h-20 w-20 rotate-[-8deg] items-center justify-center rounded-3xl border border-white bg-white/90 text-blue-500 shadow-lg shadow-blue-100/60 dark:border-white/10 dark:bg-blue-950/60 dark:shadow-none">
                    <Gift size={42} strokeWidth={1.4} />
                  </span>
                  <p className="text-xs text-slate-500 dark:text-slate-400">剩余奖池</p>
                  <p className="mt-2 break-all text-3xl font-semibold tracking-tight text-blue-600 dark:text-blue-300 sm:text-4xl">
                    {money(activity.remaining_quota)}
                  </p>
                  <p className="mt-4 text-xs text-slate-400">总奖池 {money(activity.total_quota)}</p>
                  {activity.mode === 'random_shares' && (
                    <p className="mt-1.5 text-xs text-slate-400">剩余 {activity.remaining_shares} 份</p>
                  )}
                  {activity.mode === 'fixed' && (
                    <span className="mt-5 rounded-full bg-white/80 px-3 py-1.5 text-xs text-slate-500 dark:bg-white/5 dark:text-slate-300">
                      每次奖励 {money(activity.fixed_quota)}
                    </span>
                  )}
                </div>
                <div className="flex flex-col justify-center p-5 sm:p-6">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">我的抽奖机会</span>
                    <button
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-500"
                      onClick={() => setShowHistory((value) => !value)}
                    >
                      <History size={13} />
                      抽奖记录
                    </button>
                  </div>
                  <div className="my-5 flex items-baseline gap-2">
                    <strong className="text-4xl font-semibold">{participation?.remaining}</strong>
                    <span className="text-xs text-slate-400">次剩余机会</span>
                  </div>
                  <div className="space-y-3 border-t border-slate-100 pt-4 text-xs dark:border-white/10">
                    <div className="flex justify-between gap-2 text-slate-500 dark:text-slate-400">
                      <span>{activity.topup_scope === 'period' ? '指定时段充值门槛' : '累计充值门槛'}</span>
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {money(activity.min_topup_quota)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2 text-slate-500 dark:text-slate-400">
                      <span>{activity.topup_scope === 'period' ? '该时段已充值' : '我的累计充值'}</span>
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {money(activity.eligible_topup_quota)}
                      </span>
                    </div>
                    {activity.topup_scope === 'period' && (
                      <p className="text-[11px] leading-relaxed text-slate-400">
                        {lotteryPeriod(activity.topup_start, activity.topup_end)}（北京时间）
                      </p>
                    )}
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                      <div
                        className="h-full rounded-full bg-blue-400"
                        style={{
                          width: `${activity.min_topup_quota ? Math.min(100, (activity.eligible_topup_quota / activity.min_topup_quota) * 100) : 100}%`,
                        }}
                      />
                    </div>
                    <p
                      className={
                        participation?.qualified ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600'
                      }
                    >
                      {participation?.qualified ? '已满足参与条件' : '尚未达到充值门槛'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-500 text-sm font-medium text-white shadow-lg shadow-blue-500/15 transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-white/10"
                    disabled={draw.isPending || (!retrying && !participation?.canDraw)}
                    onClick={() => {
                      /* 同步锁阻止下一次重绘前的连续点击，避免重复消耗机会。 */ if (drawLock.current) return
                      drawLock.current = true
                      setResult(null)
                      draw.mutate(activity.id)
                    }}
                  >
                    <Gift size={17} />
                    {draw.isPending ? '正在抽奖…' : retrying ? '取回抽奖结果' : '立即抽奖'}
                    <ArrowRight size={15} />
                  </button>
                </div>
              </section>
              {draw.isError && draw.variables === activity.id && (
                <p
                  role="alert"
                  className="rounded-xl bg-red-50 px-4 py-3 text-xs text-red-600 dark:bg-red-500/10"
                >
                  {draw.error.message}
                </p>
              )}
              {result && result.activity_id === activity.id && (
                <div
                  role="status"
                  className="flex items-center gap-4 rounded-2xl border border-amber-100 bg-amber-50/60 p-5 dark:border-amber-500/20 dark:bg-amber-500/5"
                >
                  <Trophy className="text-amber-500" size={30} />
                  <div>
                    <p className="text-sm font-medium">恭喜获得 {money(result.quota)}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">奖励已存入账号赠金余额</p>
                  </div>
                </div>
              )}
              <section>
                <h4 className="mb-3 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Trophy size={14} />
                  幸运时刻
                </h4>
                {winners.isError ? (
                  <button className={buttonClass} onClick={() => void winners.refetch()}>
                    中奖名单加载失败，点击重试
                  </button>
                ) : winners.isPending ? (
                  <p className="text-xs text-slate-400">正在加载中奖名单…</p>
                ) : !winners.data?.length ? (
                  <p className="text-xs text-slate-400">还没有中奖记录，期待第一份好运</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {winners.data.slice(0, 6).map((item) => (
                      <div
                        key={item.id}
                        className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs dark:bg-white/5"
                      >
                        <span className="truncate text-slate-400">{item.username}</span>
                        <span className="shrink-0 font-medium text-blue-500">+{money(item.quota)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              {showHistory && (
                <section className="rounded-2xl border border-slate-100 p-4 dark:border-white/10">
                  <h4 className="mb-3 text-sm font-medium">我的抽奖记录</h4>
                  {history.isPending ? (
                    <p className="text-xs text-slate-400">正在加载…</p>
                  ) : history.isError ? (
                    <button className={buttonClass} onClick={() => void history.refetch()}>
                      记录加载失败，点击重试
                    </button>
                  ) : !history.data?.items.length ? (
                    <p className="text-xs text-slate-400">暂无抽奖记录</p>
                  ) : (
                    <>
                      <div className="divide-y divide-slate-100 dark:divide-white/10">
                        {history.data.items.map((item) => (
                          <div key={item.id} className="flex justify-between gap-3 py-2.5 text-xs">
                            <span className="text-slate-400">
                              {new Date(item.created_at * 1000).toLocaleString('zh-CN', {
                                timeZone: 'Asia/Shanghai',
                                hour12: false,
                              })}
                            </span>
                            <span className="font-medium text-blue-500">+{money(item.quota)}</span>
                          </div>
                        ))}
                      </div>
                      <Pagination
                        page={historyPage}
                        pageSize={20}
                        total={history.data.total}
                        busy={history.isFetching}
                        onChange={setHistoryPage}
                        label="抽奖记录"
                      />
                    </>
                  )}
                </section>
              )}
              <Pagination
                page={page}
                pageSize={10}
                total={query.data?.total ?? 0}
                busy={query.isFetching || draw.isPending}
                onChange={setPage}
                label="抽奖活动"
              />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Pagination({
  page,
  pageSize,
  total,
  busy,
  onChange,
  label,
}: {
  page: number
  pageSize: number
  total: number
  busy: boolean
  onChange: (page: number) => void
  label: string
}) {
  if (total <= pageSize) return null
  return (
    <div className="mt-3 flex items-center justify-end gap-3 text-xs text-slate-400">
      <button
        aria-label={`上一页${label}`}
        className={buttonClass}
        disabled={page <= 1 || busy}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft size={14} />
      </button>
      <span>
        {page} / {Math.ceil(total / pageSize)}
      </span>
      <button
        aria-label={`下一页${label}`}
        className={buttonClass}
        disabled={page * pageSize >= total || busy}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  )
}
