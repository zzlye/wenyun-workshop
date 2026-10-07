import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useStore } from '../store'
import { LOCKED_WENYUN_PROFILE_ID, normalizeSettings } from '../lib/apiProfiles'
import { getEffectiveVideoApiKey } from '../lib/accountApiKey'
import { getBoundVideoApiKey } from '../lib/videoAccount'
import { useVideoModels } from '../hooks/useVideoModels'
import { buildVideoCatalogRows, fetchVideoModelCatalog } from '../lib/videoModelCatalog'

type VideoModelCatalogProps = {
  refreshSignal: number
  onUpdatedAt: (timestamp: number | null) => void
}

export default function VideoModelCatalog({ refreshSignal, onUpdatedAt }: VideoModelCatalogProps) {
  const settings = normalizeSettings(useStore(state => state.settings))
  const videoKey = getEffectiveVideoApiKey(settings)
  const account = settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]
  // 手填 Key 可能属于另一个账号，其目录不能套用当前登录账号的专属报价。
  const session = account && (!videoKey || videoKey === getBoundVideoApiKey(account)) ? account : undefined
  const profile = settings.profiles.find(item => item.id === LOCKED_WENYUN_PROFILE_ID)!
  const models = useVideoModels(videoKey, settings.videoApiProxy, true, 'always')
  const catalog = useQuery({
    queryKey: ['video-model-catalog', profile.baseUrl, videoKey, session?.accessToken, session?.userId],
    queryFn: ({ signal }) => fetchVideoModelCatalog(profile, session, signal),
    staleTime: 60_000,
    refetchOnMount: 'always',
    retry: false,
    refetchOnWindowFocus: false,
  })
  const rows = useMemo(() => catalog.data ? buildVideoCatalogRows(catalog.data, videoKey ? models.data ?? [] : undefined) : [], [catalog.data, models.data, videoKey])
  const loading = catalog.isFetching || models.isFetching
  const errors = [...(catalog.data?.errors ?? []), ...(catalog.isError ? ['视频目录暂未获取，请稍后刷新'] : []), ...(videoKey && models.isError ? [models.error.message] : [])]
  const previousRefreshSignal = useRef(refreshSignal)

  useEffect(() => {
    const data = catalog.data
    onUpdatedAt(data && (data.pricing || data.performance || data.status) ? data.updatedAt : null)
  }, [catalog.data, onUpdatedAt])

  useEffect(() => {
    if (previousRefreshSignal.current === refreshSignal) return
    previousRefreshSignal.current = refreshSignal
    void catalog.refetch()
    if (videoKey) void models.refetch()
    // 手动刷新只响应顶部按钮；切换分页不会重新请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal])

  return <div className="space-y-4" aria-busy={loading}>
    {errors.length > 0 && <div role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">{errors.join('；')}</div>}
    <div className="overflow-hidden rounded-xl border border-gray-200/70 dark:border-white/[0.08]" role="table" aria-label="视频模型列表">
      <div role="row" className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(100px,0.8fr)_85px] gap-4 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-400 dark:bg-white/[0.04] dark:text-gray-500 sm:grid">
        {['模型', '简介', '价格', '成功率'].map(label => <span key={label} role="columnheader">{label}</span>)}
      </div>
      {rows.map(row => <div key={row.model} role="row" className="grid grid-cols-2 gap-3 border-t border-gray-100 px-4 py-4 text-sm first:border-t-0 dark:border-white/[0.06] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(100px,0.8fr)_85px] sm:gap-4">
        <div role="cell" className="col-span-2 min-w-0 break-all font-medium text-gray-800 dark:text-gray-100 sm:col-span-1">{row.model}</div>
        <div role="cell" className="col-span-2 min-w-0 whitespace-pre-wrap break-words leading-relaxed text-gray-600 dark:text-gray-300 sm:col-span-1">{row.description}</div>
        <div role="cell" className="min-w-0 break-words text-gray-700 dark:text-gray-200">
          <div className="mb-1 text-xs text-gray-400 sm:hidden">价格</div>
          <span className="font-mono">{row.priceText}</span>
          {row.priceNote && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{row.priceNote}</div>}
        </div>
        <div role="cell" className="text-right text-gray-700 dark:text-gray-200 sm:text-left">
          <div className="mb-1 text-xs text-gray-400 sm:hidden">成功率</div>
          <span className="font-mono">{row.successRate === null ? '暂无数据' : `${row.successRate.toFixed(2)}%`}</span>
        </div>
      </div>)}
      {!rows.length && <div role="status" className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">{loading ? '正在获取视频模型…' : errors.length ? '暂未获取到视频模型' : '暂无可用视频模型'}</div>}
    </div>
  </div>
}
