import { useId, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { QrCode, ReceiptText, RefreshCw, X } from 'lucide-react'
import type { ApiProfile } from '../types'
import { useStore } from '../store'
import { queryNewApiModelPerformance } from '../lib/newApi'
import { normalizeSettings, LOCKED_WENYUN_PROFILE_ID } from '../lib/apiProfiles'
import { getEffectiveImageApiProfile, getEffectiveVideoApiKey } from '../lib/accountApiKey'
import { useMediaCatalog } from '../hooks/useMediaCatalog'
import MediaModelTable from './MediaModelTable'
import SupportJoinGroupNotice from './SupportJoinGroupNotice'

type PriceTableButtonProps = {
  activeProfile: ApiProfile
  buttonClassName?: string
  buttonStyle?: CSSProperties
}

export default function PriceTableButton({ activeProfile, buttonClassName, buttonStyle }: PriceTableButtonProps) {
  const settings = normalizeSettings(useStore((state) => state.settings))
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'image' | 'video'>('image')
  const tabId = useId()
  const [contactOpen, setContactOpen] = useState(false)
  const imageProfile = getEffectiveImageApiProfile(settings, activeProfile)
  const videoProfile = settings.profiles.find(item => item.id === LOCKED_WENYUN_PROFILE_ID)!
  const videoKey = getEffectiveVideoApiKey(settings)
  const imageCatalog = useMediaCatalog(imageProfile.baseUrl, imageProfile.apiKey, imageProfile.apiProxy, open)
  const videoCatalog = useMediaCatalog(videoProfile.baseUrl, videoKey, settings.videoApiProxy, open)
  const performance = useQuery({
    queryKey: ['media-catalog-performance', activeProfile.baseUrl],
    queryFn: () => queryNewApiModelPerformance(activeProfile, 24),
    enabled: open, staleTime: 60_000, retry: false,
  })
  const loading = imageCatalog.isFetching || videoCatalog.isFetching || performance.isFetching
  const currentCatalog = tab === 'image' ? imageCatalog : videoCatalog
  const updatedAt = currentCatalog.updatedAt
  const closeModelList = () => setOpen(false)
  const refresh = () => {
    void imageCatalog.refetch()
    if (imageProfile.apiKey !== videoKey || imageProfile.baseUrl !== videoProfile.baseUrl) void videoCatalog.refetch()
    void performance.refetch()
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          className={buttonClassName || 'shrink-0 rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-medium text-gray-600 transition hover:bg-white hover:text-gray-900 dark:bg-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.12]'}
          style={buttonStyle}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            setOpen(true)
          }}
        >
          模型列表
        </button>
        <button
          type="button"
          className="shrink truncate rounded-full px-1.5 py-0.5 text-[11px] font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400/40 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-100"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            setContactOpen(true)
          }}
          aria-label="打开微信二维码"
        >
          获取联系微信：zzlye674
        </button>
      </div>

      {open ? createPortal(
        <div
          data-no-drag-select
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="absolute inset-0 bg-black/45 backdrop-blur-sm animate-overlay-in" onClick={closeModelList} />
          <div className="relative z-10 flex h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-100 p-5 dark:border-white/[0.08]">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                  <ReceiptText className="h-4 w-4 text-blue-500" />
                  <span>{activeProfile.name || '西米露'}模型列表</span>
                </div>
                <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {updatedAt
                    ? `更新于 ${new Date(updatedAt!).toLocaleString()}` : '更新中'}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:border-blue-400/30 dark:hover:bg-blue-500/15 dark:hover:text-blue-200"
                  onClick={refresh}
                  disabled={loading}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  {loading ? '更新中' : '刷新'}
                </button>
                <button
                  type="button"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.08] dark:hover:text-gray-100"
                  onClick={closeModelList}
                  aria-label="关闭模型列表"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div role="tablist" aria-label="模型类型" className="flex shrink-0 gap-1 border-b border-gray-100 px-5 py-3 dark:border-white/[0.08]">
              {(['image', 'video'] as const).map((value, index) => <button
                key={value} type="button" role="tab" id={`${tabId}-${value}`} aria-selected={tab === value} aria-controls={`${tabId}-${value}-panel`} tabIndex={tab === value ? 0 : -1}
                onClick={() => setTab(value)}
                onKeyDown={event => {
                  const next = event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? index === 0 ? 'video' : 'image' : event.key === 'Home' ? 'image' : event.key === 'End' ? 'video' : null
                  if (next) { event.preventDefault(); setTab(next); document.getElementById(`${tabId}-${next}`)?.focus() }
                }}
                className={`rounded-full px-5 py-2 text-sm font-medium transition ${tab === value ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]'}`}
              >{value === 'image' ? '图片' : '视频'}</button>)}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <div id={`${tabId}-video-panel`} role="tabpanel" aria-labelledby={`${tabId}-video`} hidden={tab !== 'video'}>
                <MediaModelTable video options={videoCatalog.data?.videos ?? []} loading={videoCatalog.isFetching}
                  error={videoCatalog.error?.message} warning={videoCatalog.descriptionError?.message} metadataReady={videoCatalog.metadataReady} metrics={performance.data?.items} />
              </div>
              <div id={`${tabId}-image-panel`} role="tabpanel" aria-labelledby={`${tabId}-image`} hidden={tab !== 'image'}>
                <MediaModelTable options={imageCatalog.data?.images ?? []} loading={imageCatalog.isFetching}
                  error={imageCatalog.error?.message} warning={imageCatalog.descriptionError?.message} metadataReady={imageCatalog.metadataReady} metrics={performance.data?.items} />
              </div>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      {contactOpen ? createPortal(
        <div
          data-no-drag-select
          className="fixed inset-0 z-[130] flex items-center justify-center p-4"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="absolute inset-0 bg-black/45 backdrop-blur-sm animate-overlay-in" onClick={() => setContactOpen(false)} />
          <div
            className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/[0.08]">
              <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                <QrCode className="h-4 w-4 text-blue-500" />
                <span>联系微信</span>
              </div>
              <button
                type="button"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.08] dark:hover:text-gray-100"
                onClick={() => setContactOpen(false)}
                aria-label="关闭微信二维码"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-6 py-6 text-center">
              <div className="mx-auto aspect-square w-56 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-2 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                <img src="/support-qr.jpg" alt="zzlye674 微信二维码" className="h-full w-full rounded-xl object-cover" />
              </div>
              <div className="mt-4 text-base font-semibold text-gray-900 dark:text-gray-100">微信：zzlye674</div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">扫码联系获取更多生图模型</div>
              <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-medium leading-relaxed text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-300">
                <SupportJoinGroupNotice />
              </div>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
