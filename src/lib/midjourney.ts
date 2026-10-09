import type { TaskParams } from '../types'

export const MIDJOURNEY_MODELS = ['mj-v8.2', 'mj-niji7'] as const
export const MIDJOURNEY_RATIOS = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9', '9:21'] as const
export const MIDJOURNEY_MAX_REFERENCES = 5
export const NIJI_QUALITY_OPTIONS = [0.25, 0.5, 1, 2] as const

export function isMidjourneyModel(model: string): boolean {
  return MIDJOURNEY_MODELS.some(value => value === model.trim().toLowerCase())
}

/** 旧节点的像素尺寸只用于恢复比例，不向 Midjourney 发送像素或清晰度档位。 */
export function normalizeMidjourneyRatio(value: string): string {
  const size = value.trim().toLowerCase()
  if (MIDJOURNEY_RATIOS.some(ratio => ratio === size)) return size
  const pixels = size.match(/^(\d+)\s*[x\u00d7]\s*(\d+)$/)
  if (!pixels || Number(pixels[1]) <= 0 || Number(pixels[2]) <= 0) return '9:16'
  const ratio = Number(pixels[1]) / Number(pixels[2])
  return MIDJOURNEY_RATIOS.filter(value => value !== 'auto').reduce((closest, candidate) => {
    const distance = (value: string) => {
      const [w, h] = value.split(':').map(Number)
      return Math.abs(Math.log(ratio / (w / h)))
    }
    return distance(candidate) < distance(closest) ? candidate : closest
  }, '1:1')
}

export function buildMidjourneyRequest(model: string, prompt: string, params: TaskParams, references: string[], mask?: string): Record<string, unknown> {
  if (!isMidjourneyModel(model)) throw new Error('不支持的 Midjourney 模型')
  if (!prompt.trim()) throw new Error('请输入提示词')
  if (mask) throw new Error('此模型不支持遮罩编辑，请移除遮罩')
  if (references.length > MIDJOURNEY_MAX_REFERENCES) throw new Error('此模型最多支持 5 张参考图，请移除多余图片')
  if (references.some(value => !/^https?:\/\//i.test(value) && !/^data:image\//i.test(value))) throw new Error('参考图必须是图片地址或 Data URL')
  const raw = params.midjourney?.raw ?? false
  if (typeof raw !== 'boolean') throw new Error('Raw 参数必须是布尔值')
  const request: Record<string, unknown> = {
    model: model.trim().toLowerCase(), prompt, size: normalizeMidjourneyRatio(params.size), raw,
    // n 表示提交次数；一次任务返回四张图，不能发送 n=4 导致重复计费。
    n: 1,
  }
  if (model.trim().toLowerCase() === 'mj-niji7') {
    const quality = params.midjourney?.quality ?? 1
    if (!NIJI_QUALITY_OPTIONS.some(value => value === quality)) throw new Error('Niji 品质仅支持 0.25、0.5、1、2')
    request.quality = quality
  }
  if (references.length === 1) request.image = references[0]
  if (references.length > 1) request.images = references
  return request
}

export function readMidjourneyTask(payload: unknown, headerTaskId = '') {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const task = root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data as Record<string, unknown> : root
  const result = task.result && typeof task.result === 'object' ? task.result as Record<string, unknown> : task
  const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : result
  const images = Array.isArray(data.image_urls) ? data.image_urls.filter((value): value is string => typeof value === 'string' && (/^https?:\/\//i.test(value) || /^data:image\//i.test(value))) : []
  const error = task.error_message ?? root.error_message ?? (root.error as { message?: string } | undefined)?.message ?? task.error_code
  return {
    taskId: typeof task.task_id === 'string' ? task.task_id : headerTaskId,
    status: typeof task.status === 'string' ? task.status.toLowerCase() : '',
    images,
    error: typeof error === 'string' || typeof error === 'number' ? String(error) : '',
  }
}

/** 空受理正文允许从响应头取任务 ID；非 JSON 错误页不能冒充有效任务。 */
export async function readMidjourneyResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`图片接口返回了无效响应（HTTP ${response.status}）`)
  }
}
