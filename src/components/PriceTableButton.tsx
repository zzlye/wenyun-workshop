import { useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { QrCode, ReceiptText, X } from 'lucide-react'
import type { ApiProfile } from '../types'
import { useStore } from '../store'
import { buildFixedModelPriceRows } from '../lib/modelPricing'
import SupportJoinGroupNotice from './SupportJoinGroupNotice'

type PriceTableButtonProps = {
  activeProfile: ApiProfile
  buttonClassName?: string
  buttonStyle?: CSSProperties
}

export default function PriceTableButton({ activeProfile, buttonClassName, buttonStyle }: PriceTableButtonProps) {
  const settings = useStore((state) => state.settings)
  const [open, setOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const rows = useMemo(
    () => buildFixedModelPriceRows(activeProfile.id, [settings.textModel, settings.textVideoModel, settings.videoModel]),
    [activeProfile.id, settings.textModel, settings.textVideoModel, settings.videoModel],
  )

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
          <div className="absolute inset-0 bg-black/45 backdrop-blur-sm animate-overlay-in" onClick={() => setOpen(false)} />
          <div className="relative z-10 flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-100 p-5 dark:border-white/[0.08]">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
                  <ReceiptText className="h-4 w-4 text-blue-500" />
                  <span>{activeProfile.name || '当前站点'}模型列表</span>
                </div>
                <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">固定模型配置</div>
              </div>
              <button
                type="button"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.08] dark:hover:text-gray-100"
                onClick={() => setOpen(false)}
                aria-label="关闭模型列表"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="overflow-hidden rounded-xl border border-gray-200/70 dark:border-white/[0.08]">
                <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(120px,0.85fr)_110px] gap-4 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-400 dark:bg-white/[0.04] dark:text-gray-500">
                  <span>模型</span>
                  <span>支持分辨率</span>
                  <span>价格</span>
                </div>
                {rows.map((row) => (
                  <div key={`${row.model}-${row.upstreamModel || ''}`} className="grid grid-cols-[minmax(0,1.15fr)_minmax(120px,0.85fr)_110px] gap-4 border-t border-gray-100 px-4 py-3 text-sm dark:border-white/[0.06]">
                    <div className="min-w-0">
                      <div className="break-all font-medium text-gray-800 dark:text-gray-100">{row.model}</div>
                      {row.upstreamModel ? <div className="mt-1 break-all text-[11px] text-gray-400 dark:text-gray-500">实际模型：{row.upstreamModel}</div> : null}
                    </div>
                    <div className="min-w-0 text-gray-600 dark:text-gray-300">{row.resolutionText || '—'}</div>
                    <div className="font-mono text-gray-700 dark:text-gray-200">{row.priceText}</div>
                  </div>
                ))}
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
