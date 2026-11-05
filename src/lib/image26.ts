import type { TaskParams } from '../types'
import { isGptImage26Model } from './modelPricing'

// API 参数参考目前将 GIF 帧数上限列为 16；采用与指南共同支持的范围。
export const GIF_MAX_FRAMES = 16
const integer = (value: number | undefined, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

export function normalizeImage26Params(model: string, params: TaskParams, hasInputImages = false): TaskParams {
  const next = { ...params }
  const supported = isGptImage26Model(model)
  if (!supported) {
    delete next.complexity
    if (next.output_format === 'svg' || next.output_format === 'gif') next.output_format = 'png'
  } else {
    if (!['low', 'medium', 'high'].includes(next.complexity || '')) delete next.complexity
    // 官方编辑接口只接受栅格输出，添加参考图后清理不适用的生成格式。
    if (hasInputImages && (next.output_format === 'svg' || next.output_format === 'gif')) next.output_format = 'png'
    if (next.output_format === 'svg') next.n = 1
  }
  if (next.output_format === 'gif') {
    next.frame_count = integer(next.frame_count, 9, 2, GIF_MAX_FRAMES)
    next.frame_duration_ms = Math.round(integer(next.frame_duration_ms, 200, 20, 2000) / 10) * 10
    // 动画尺寸代表每帧，允许小于静态图的下限；默认交给接口分配像素预算。
    if (params.size === 'auto') next.size = 'auto'
    else {
      const match = params.size.match(/^(\d+)x(\d+)$/)
      if (match && [Number(match[1]), Number(match[2])].every(value => value > 0 && value <= 3840 && value % 16 === 0)) next.size = params.size
      else next.size = 'auto'
    }
  } else {
    delete next.frame_count
    delete next.frame_duration_ms
  }
  if (next.output_format !== 'jpeg' && next.output_format !== 'webp') next.output_compression = null
  return next
}
