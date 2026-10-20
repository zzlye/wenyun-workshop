import type { MidjourneyParams, TaskParams } from '../types'

export const MIDJOURNEY_MODELS = ['mj-v8.2'] as const
export const MIDJOURNEY_RATIOS = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9', '9:21'] as const
export const MIDJOURNEY_MAX_REFERENCES = 5
export const MIDJOURNEY_MAX_PROMPT_LENGTH = 1023

// 画布的字符串配置保留完整参数，旧节点仍可从 mjRaw 恢复原始风格。
export function readMidjourneyConfig(config: { mjParameters?: string; mjRaw?: string }): MidjourneyParams {
  try {
    const options = config.mjParameters ? JSON.parse(config.mjParameters) : null
    if (options && typeof options === 'object' && !Array.isArray(options)) return options
  } catch { /* 损坏的旧配置交由默认值恢复，不阻止打开画布。 */ }
  return { raw: config.mjRaw === 'true' }
}

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
  if (Array.from(prompt).length > MIDJOURNEY_MAX_PROMPT_LENGTH) throw new Error('MJ 提示词最多 1023 个字符，请精简后重试')
  if (mask) throw new Error('此模型不支持遮罩编辑，请移除遮罩')
  if (references.length > MIDJOURNEY_MAX_REFERENCES) throw new Error('此模型最多支持 5 张参考图，请移除多余图片')
  if (references.some(value => !/^https?:\/\//i.test(value) && !/^data:image\/[^;,]+;base64,[A-Za-z0-9+/=\s]+$/i.test(value))) throw new Error('参考图必须是图片地址或完整 Data URL')
  const raw = params.midjourney?.raw ?? false
  if (typeof raw !== 'boolean') throw new Error('Raw 参数必须是布尔值')
  const request: Record<string, unknown> = {
    model: model.trim().toLowerCase(), prompt, size: normalizeMidjourneyRatio(params.size), raw,
    // n 表示提交次数；一次任务返回四张图，不能发送 n=4 导致重复计费。
    n: 1,
  }
  if (references.length === 1) request.image = references[0]
  if (references.length > 1) request.images = references
  const options = params.midjourney ?? {}
  for (const field of ['hd', 'tile'] as const) {
    if (options[field] === undefined) continue
    if (typeof options[field] !== 'boolean') throw new Error(`${field} 参数必须是布尔值`)
    request[field] = options[field]
  }
  if (options.quality !== undefined) {
    if (![0.25, 0.5, 1, 2].includes(options.quality)) throw new Error('MJ 品质仅支持 0.25、0.5、1 或 2')
    request.quality = options.quality
  }
  if (options.seed !== undefined) {
    if (!Number.isSafeInteger(options.seed)) throw new Error('随机种子必须是整数')
    request.seed = options.seed
  }
  if (options.negative_prompt?.trim()) request.negative_prompt = options.negative_prompt
  const ranges = { stylize: [0, 1000], chaos: [0, 100], weird: [0, 3000], iw: [0, 3], cw: [0, 100], sw: [0, 1000], dw: [0, 100] } as const
  for (const [field, range] of Object.entries(ranges)) {
    const value = options[field as keyof typeof ranges]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < range[0] || value > range[1]) throw new Error(`${field} 必须在 ${range[0]}–${range[1]} 之间`)
    // 无对应参考图时不发送权重；零权重必须原样保留。
    if (field === 'iw' && !references.length || field === 'cw' && !options.cref?.trim() || field === 'sw' && !options.sref?.trim() || field === 'dw' && !options.dref?.trim()) continue
    request[field] = value
  }
  for (const field of ['cref', 'sref', 'dref'] as const) {
    const value = options[field]?.trim()
    if (!value) continue
    try {
      if (!['http:', 'https:'].includes(new URL(value).protocol)) throw new Error()
    } catch { throw new Error(`${field} 必须是可访问的图片 URL`) }
    request[field] = value
  }
  return request
}

export function readMidjourneyTask(payload: unknown, headerTaskId = '', baseUrl?: string) {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const task = root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data as Record<string, unknown> : root
  const resultValue = task.result ?? root.result
  const result = resultValue && typeof resultValue === 'object' ? resultValue as Record<string, unknown> : task
  const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : result
  // 中转可能返回带签名的相对地址；以原 API 地址补全，不能使用本站或代理路径作为基准。
  const images = Array.isArray(data.image_urls) ? data.image_urls.flatMap(value => {
    if (typeof value !== 'string' || !value.trim()) return []
    if (/^data:image\//i.test(value)) return [value]
    try {
      const url = new URL(value, baseUrl ? `${baseUrl.replace(/\/$/, '')}/` : undefined)
      return url.protocol === 'http:' || url.protocol === 'https:' ? [url.toString()] : []
    } catch {
      return []
    }
  }) : []
  const error = task.error_message || root.error_message || (task.error as { message?: string } | undefined)?.message || (root.error as { message?: string } | undefined)?.message || task.error_code || root.error_code
  return {
    taskId: typeof root.task_id === 'string' ? root.task_id : typeof task.task_id === 'string' ? task.task_id : headerTaskId,
    status: String(task.status || root.status || '').toLowerCase(),
    resultExpired: task.result_expired === true || root.result_expired === true,
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
