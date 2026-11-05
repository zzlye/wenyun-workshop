import type { CSSProperties } from 'react'
import type { TaskParams } from '../types'
import { isGptImage26Model } from '../lib/modelPricing'
import { GIF_MAX_FRAMES } from '../lib/image26'

// 工坊与画布共用输出设置，避免两个入口的参数范围和透明通道处理不一致。
export default function ImageOutputSettings({ value, onChange, style, model = '', hasInputImages = false }: {
  value: Pick<TaskParams, 'output_format' | 'output_compression' | 'moderation' | 'background' | 'complexity' | 'frame_count' | 'frame_duration_ms'> & Partial<Pick<TaskParams, 'size'>>
  onChange: (patch: Partial<TaskParams>) => void
  style?: CSSProperties
  model?: string
  hasInputImages?: boolean
}) {
  const supports26 = isGptImage26Model(model)
  const inputClass = 'h-8 min-w-0 rounded-lg border border-gray-300/60 bg-transparent px-2 text-xs outline-none dark:border-white/15 [&>option]:bg-white [&>option]:text-gray-900 dark:[&>option]:bg-gray-900 dark:[&>option]:text-gray-100'
  const fieldClass = 'flex min-w-0 flex-col gap-1'
  return <details className="w-full text-xs text-gray-700 dark:text-gray-200" style={style}>
    <summary className="cursor-pointer py-1">更多设置</summary>
    <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-3">
      <label className={fieldClass}><span>输出格式</span>
        <select aria-label="输出格式" className={inputClass} value={value.output_format} onChange={event => {
          const format = event.target.value as TaskParams['output_format']
          onChange({ output_format: format, ...(!['jpeg', 'webp'].includes(format) ? { output_compression: null } : {}), ...(format === 'svg' ? { n: 1 } : {}), ...(format === 'gif' ? { size: 'auto', frame_count: value.frame_count ?? 9, frame_duration_ms: value.frame_duration_ms ?? 200 } : { frame_count: undefined, frame_duration_ms: undefined }) })
        }}>
          <option value="png">PNG</option><option value="jpeg" disabled={value.background === 'transparent'}>JPEG</option><option value="webp">WebP</option>
          {supports26 && !hasInputImages && <><option value="svg">SVG</option><option value="gif">GIF</option></>}
        </select>
      </label>
      {['jpeg', 'webp'].includes(value.output_format) && <label className={fieldClass}><span>压缩质量</span>
        <input aria-label="压缩质量" type="number" min={0} max={100} step={1} placeholder="默认" className={inputClass}
          value={value.output_compression ?? ''} onChange={event => {
            const raw = event.target.value
            onChange({ output_compression: raw === '' ? null : Math.min(100, Math.max(0, Math.round(Number(raw)))) })
          }} />
      </label>}
      {supports26 && <label className={fieldClass}><span>复杂度</span>
        <select aria-label="复杂度" className={inputClass} value={value.complexity || ''} onChange={event => onChange({ complexity: event.target.value ? event.target.value as TaskParams['complexity'] : undefined })}>
          <option value="">默认</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option>
        </select>
      </label>}
      {supports26 && value.output_format === 'gif' && <>
        <label className={fieldClass}><span>动画尺寸</span><input aria-label="动画尺寸" key={value.size} defaultValue={value.size || 'auto'} placeholder="auto / 512x512" className={inputClass} onBlur={event => onChange({ size: event.target.value.trim().toLowerCase() || 'auto' })} /></label>
        <label className={fieldClass}><span>动画帧数</span><input aria-label="动画帧数" type="number" min={2} max={GIF_MAX_FRAMES} step={1} className={inputClass} value={value.frame_count ?? 9} onChange={event => onChange({ frame_count: Number(event.target.value) })} /></label>
        <label className={fieldClass}><span>每帧时长（毫秒）</span><input aria-label="每帧时长" type="number" min={20} max={2000} step={10} className={inputClass} value={value.frame_duration_ms ?? 200} onChange={event => onChange({ frame_duration_ms: Number(event.target.value) })} /></label>
      </>}
      <label className={fieldClass}><span>内容审核</span>
        <select aria-label="内容审核" className={inputClass} value={value.moderation} onChange={event => onChange({ moderation: event.target.value as TaskParams['moderation'] })}>
          <option value="auto">自动</option><option value="low">低</option>
        </select>
      </label>
    </div>
  </details>
}
