import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxyForBaseUrl } from './devProxy'
import { parseModelListPayload } from './modelList'
import { CANVAS_VIDEO_BASE_URL } from './videoModel'

// 获取模型与视频生成使用同一站点、视频密钥和代理规则，不混用生图密钥。
export async function fetchVideoModelList(apiKey: string, apiProxy: boolean, signal?: AbortSignal): Promise<string[]> {
  const key = apiKey.trim()
  if (!key) throw new Error('请先在设置里填写视频 API Key')
  const proxyConfig = readClientDevProxyConfig()
  const useProxy = shouldUseApiProxyForBaseUrl(apiProxy, CANVAS_VIDEO_BASE_URL, proxyConfig)
  const response = await fetch(buildApiUrl(CANVAS_VIDEO_BASE_URL, '/models', proxyConfig, useProxy), {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
    signal,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`获取视频模型失败：${response.status}`)
  const models = parseModelListPayload(payload)
  if (!models.length) throw new Error('接口没有返回模型列表')
  return models
}
