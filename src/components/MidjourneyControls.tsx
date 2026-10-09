import { useRef } from 'react'
import { X } from 'lucide-react'
import type { TaskParams } from '../types'
import { MIDJOURNEY_RATIOS, NIJI_QUALITY_OPTIONS, normalizeMidjourneyRatio } from '../lib/midjourney'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'

/** 两个生图入口共用比例和专属参数，不展示文档未声明的像素档位。 */
export function MidjourneyRatioOptions({ value, onChange }: { value: string; onChange: (ratio: string) => void }) {
  const ratio = normalizeMidjourneyRatio(value)
  return <div className="grid grid-cols-4 gap-2">
    {MIDJOURNEY_RATIOS.map(item => <button key={item} type="button" data-image-ratio={item} aria-pressed={ratio === item}
      className={`h-10 min-w-0 rounded-lg border px-2 text-sm transition ${ratio === item ? 'border-blue-500 bg-blue-500/10 text-blue-500' : 'border-gray-300/60 dark:border-white/15 hover:bg-gray-500/10'}`}
      onClick={() => onChange(item)}>{item === 'auto' ? '自动' : item}</button>)}
  </div>
}

export function MidjourneyOptions({ model, value, onChange }: { model: string; value: TaskParams['midjourney']; onChange: (value: NonNullable<TaskParams['midjourney']>) => void }) {
  return <>
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
      <span className="opacity-60">Raw</span>
      <span className="flex h-8 items-center gap-2 rounded-lg border border-gray-300/60 dark:border-white/15 px-3">
        <input type="checkbox" aria-label="Raw" checked={value?.raw ?? false} onChange={event => onChange({ ...value, raw: event.target.checked })} className="accent-blue-500" />
        原始风格
      </span>
    </label>
    {model.toLowerCase() === 'mj-niji7' && <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
      <span className="opacity-60">品质</span>
      <select aria-label="Niji 品质" value={value?.quality ?? 1} onChange={event => onChange({ ...value, quality: Number(event.target.value) })}
        className="h-8 min-w-0 rounded-lg border border-gray-300/60 dark:border-white/15 bg-transparent px-3 text-inherit">
        {NIJI_QUALITY_OPTIONS.map(item => <option key={item} value={item} className="text-gray-900">{item}</option>)}
      </select>
    </label>}
  </>
}

export function MidjourneyRatioModal({ value, onSelect, onClose }: { value: string; onSelect: (ratio: string) => void; onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement>(null)
  usePreventBackgroundScroll(true, modalRef)
  return <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="图像比例" className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 text-gray-800 shadow-xl dark:border-white/10 dark:bg-gray-900 dark:text-gray-200" onClick={event => event.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold">图像比例</h2><button type="button" aria-label="关闭" title="关闭" className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-500/10" onClick={onClose}><X size={18} /></button></div>
      <MidjourneyRatioOptions value={value} onChange={ratio => { onSelect(ratio); onClose() }} />
    </div>
  </div>
}
