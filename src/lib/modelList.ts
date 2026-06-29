function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonLike(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value
  try {
    return JSON.parse(text)
  } catch {
    return value
  }
}

function readModelId(input: unknown): string {
  if (typeof input === 'string') return input.trim()
  if (!isRecord(input)) return ''

  for (const key of ['id', 'model', 'model_name', 'modelName', 'name']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  return ''
}

function collectModelIds(input: unknown, output: Set<string>, depth = 0) {
  if (depth > 6 || input == null) return
  const payload = parseJsonLike(input)
  const id = readModelId(payload)
  if (id) output.add(id)

  if (Array.isArray(payload)) {
    for (const item of payload) collectModelIds(item, output, depth + 1)
    return
  }

  if (!isRecord(payload)) return

  for (const key of ['data', 'models', 'model_list', 'modelList', 'items', 'list']) {
    if (key in payload) collectModelIds(payload[key], output, depth + 1)
  }
}

const VIDEO_MODEL_PRIORITY = [
  'sora-2',
  'sora-2-pro',
  'sora-2-8s',
  'sora-2-12s',
  'sora2',
  'sora-v3-pro',
  'sora-v3-fast',
  'veo_3_1',
  'veo_3_1-fast',
  'veo31-fast',
  'kling-video-3.0',
  'kling-video-o3-omni',
  'grok-imagine-video-1.5-720p',
  'grok-video-3',
  'grok-video-3-max',
  'grok-video-3-pro',
]

function compareModelId(a: string, b: string) {
  const aPriority = VIDEO_MODEL_PRIORITY.findIndex((model) => model.toLowerCase() === a.toLowerCase())
  const bPriority = VIDEO_MODEL_PRIORITY.findIndex((model) => model.toLowerCase() === b.toLowerCase())
  if (aPriority >= 0 || bPriority >= 0) {
    if (aPriority < 0) return 1
    if (bPriority < 0) return -1
    return aPriority - bPriority
  }
  return a.localeCompare(b)
}

export function parseModelListPayload(payload: unknown): string[] {
  const models = new Set<string>()
  collectModelIds(payload, models)
  return Array.from(models).sort(compareModelId)
}
