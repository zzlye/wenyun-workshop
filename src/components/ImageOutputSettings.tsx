import type { CSSProperties } from 'react'
import type { TaskParams } from '../types'

// 工坊与画布共用输出设置，避免两个入口的参数范围和透明通道处理不一致。
export default function ImageOutputSettings({ value, onChange, style }: {
  value: Pick<TaskParams, 'output_format' | 'output_compression' | 'moderation' | 'background'>
  onChange: (patch: Partial<TaskParams>) => void
  style?: CSSProperties
}) {
  const inputClass = 'h-8 min-w-0 rounded-lg border border-gray-300/60 bg-transparent px-2 text-xs outline-none dark:border-white/15 [&>option]:bg-white [&>option]:text-gray-900 dark:[&>option]:bg-gray-900 dark:[&>option]:text-gray-100'
  const fieldClass = 'flex min-w-0 flex-col gap-1'
  return <details className="w-full text-xs text-gray-700 dark:text-gray-200" style={style}>
    <summary className="cursor-pointer py-1">更多设置</summary>
    <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-3">
      <label className={fieldClass}><span>输出格式</span>
        <select aria-label="输出格式" className={inputClass} value={value.output_format} onChange={event => {
          const format = event.target.value as TaskParams['output_format']
          onChange({ output_format: format, ...(format === 'png' ? { output_compression: null } : {}) })
        }}>
          <option value="png">PNG</option><option value="jpeg" disabled={value.background === 'transparent'}>JPEG</option><option value="webp">WebP</option>
        </select>
      </label>
      {value.output_format !== 'png' && <label className={fieldClass}><span>压缩质量</span>
        <input aria-label="压缩质量" type="number" min={0} max={100} step={1} placeholder="默认" className={inputClass}
          value={value.output_compression ?? ''} onChange={event => {
            const raw = event.target.value
            onChange({ output_compression: raw === '' ? null : Math.min(100, Math.max(0, Math.round(Number(raw)))) })
          }} />
      </label>}
      <label className={fieldClass}><span>内容审核</span>
        <select aria-label="内容审核" className={inputClass} value={value.moderation} onChange={event => onChange({ moderation: event.target.value as TaskParams['moderation'] })}>
          <option value="auto">自动</option><option value="low">低</option>
        </select>
      </label>
    </div>
  </details>
}
