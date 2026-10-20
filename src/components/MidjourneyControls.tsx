import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings2, X } from 'lucide-react'
import type { MidjourneyParams, TaskParams } from '../types'
import { MIDJOURNEY_RATIOS, normalizeMidjourneyRatio } from '../lib/midjourney'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'

/** 两个生图入口共用比例和专属参数，不展示文档未声明的像素档位。 */
export function MidjourneyRatioOptions({ value, onChange }: { value: string; onChange: (ratio: string) => void }) {
  const ratio = normalizeMidjourneyRatio(value)
  return <div className="grid grid-cols-4 gap-2">
    {MIDJOURNEY_RATIOS.map(item => <button key={item} type="button" data-image-ratio={item} aria-pressed={ratio === item}
      className={`h-10 min-w-0 rounded-lg border px-2 text-sm transition ${ratio === item ? 'border-blue-500 bg-blue-500/10 text-blue-500' : 'border-gray-300/60 dark:border-white/15 hover:bg-gray-500/10'}`}
      onClick={() => onChange(item)}>{item === 'auto' ? '自动' : item}</button>)}
  </div>
}

export function MidjourneyOptions({ value, onChange }: { value: TaskParams['midjourney']; onChange: (value: NonNullable<TaskParams['midjourney']>) => void }) {
  const [open, setOpen] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  usePreventBackgroundScroll(open, modalRef)
  useCloseOnEscape(open, () => setOpen(false))
  return <><button type="button" onClick={() => setOpen(true)} className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-gray-300/60 px-3 text-xs dark:border-white/15"><Settings2 size={14} />MJ 设置</button>
    {open && createPortal(<div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label="MJ 图像设置" data-canvas-no-zoom className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl border border-gray-200 bg-white p-6 text-gray-800 shadow-xl dark:border-white/10 dark:bg-gray-900 dark:text-gray-200" onClick={event => event.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between"><h2 className="font-semibold">MJ 图像设置</h2><button type="button" aria-label="关闭 MJ 设置" onClick={() => setOpen(false)}><X size={20} /></button></div>
        <MidjourneySettingsPanel value={value} onChange={onChange} />
      </div>
    </div>, document.body)}
  </>
}

/** 网页与桌面、画布与工坊复用同一参数面板，避免两处字段不一致。 */
export function MidjourneySettingsPanel({ value = {}, onChange }: { value?: MidjourneyParams; onChange: (value: MidjourneyParams) => void }) {
  const inputClass = 'mt-1.5 h-9 w-full min-w-0 rounded-lg border border-gray-300/60 bg-transparent px-2.5 text-sm outline-none focus:border-blue-400 dark:border-white/15'
  const numberField = (key: 'seed' | 'stylize' | 'chaos' | 'weird' | 'iw' | 'cw' | 'sw' | 'dw', label: string, min?: number, max?: number, placeholder = '默认', step = 'any') => <label key={key} className="min-w-0 text-xs"><span className="opacity-70">{label}</span><input type="number" aria-label={label} className={inputClass} value={value[key] ?? ''} min={min} max={max} step={step} placeholder={placeholder} onChange={event => onChange({ ...value, [key]: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
  return <div className="space-y-5">
    <div className="grid grid-cols-3 gap-2">{([['raw', 'Raw 原始风格'], ['hd', 'HD 高清'], ['tile', '无缝平铺']] as const).map(([key, label]) => <label key={key} className="flex items-center gap-1.5 rounded-lg border border-gray-300/60 px-2 py-2.5 text-xs dark:border-white/15"><input type="checkbox" aria-label={key === 'raw' ? 'Raw' : label} checked={value[key] ?? false} onChange={event => onChange({ ...value, [key]: event.target.checked })} className="accent-blue-500" />{label}</label>)}</div>
    <div className="grid grid-cols-2 gap-3">
      <label className="text-xs"><span className="opacity-70">画质</span><select aria-label="MJ 画质" className={inputClass} value={value.quality ?? 1} onChange={event => onChange({ ...value, quality: Number(event.target.value) as MidjourneyParams['quality'] })}>{[0.25, 0.5, 1, 2].map(quality => <option key={quality} value={quality} className="bg-white dark:bg-gray-900">{quality}×</option>)}</select></label>
      {numberField('seed', '随机种子', undefined, undefined, '随机', '1')}
      {numberField('stylize', '风格化', 0, 1000, '100')}
      {numberField('chaos', '变化程度', 0, 100, '0')}
      {numberField('weird', '怪异程度', 0, 3000, '0')}
      {numberField('iw', '参考图权重', 0, 3)}
    </div>
    <label className="block text-xs"><span className="opacity-70">负面提示词</span><textarea aria-label="MJ 负面提示词" rows={2} className={`${inputClass} h-auto py-2`} value={value.negative_prompt ?? ''} onChange={event => onChange({ ...value, negative_prompt: event.target.value })} /></label>
    <div className="space-y-3 border-t border-gray-200/70 pt-4 dark:border-white/10"><h3 className="text-sm font-medium">参考控制</h3>
      {([['cref', '角色参考', 'cw', '角色权重', 100], ['sref', '风格参考', 'sw', '风格权重', 1000], ['dref', '深度参考', 'dw', '深度权重', 100]] as const).map(([key, label, weight, weightLabel, max]) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_100px] gap-3"><label className="min-w-0 text-xs"><span className="opacity-70">{label}</span><input type="url" aria-label={label} placeholder="图片 URL" className={inputClass} value={value[key] ?? ''} onChange={event => onChange({ ...value, [key]: event.target.value })} /></label>{numberField(weight, weightLabel, 0, max)}</div>)}
    </div>
  </div>
}

export function MidjourneyRatioModal({ value, onSelect, onClose }: { value: string; onSelect: (ratio: string) => void; onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement>(null)
  usePreventBackgroundScroll(true, modalRef)
  useCloseOnEscape(true, onClose)
  return <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="图像比例" className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 text-gray-800 shadow-xl dark:border-white/10 dark:bg-gray-900 dark:text-gray-200" onClick={event => event.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold">图像比例</h2><button type="button" aria-label="关闭" title="关闭" className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-500/10" onClick={onClose}><X size={18} /></button></div>
      <MidjourneyRatioOptions value={value} onChange={ratio => { onSelect(ratio); onClose() }} />
    </div>
  </div>
}
