import { useQuery } from '@tanstack/react-query'
import { fetchMediaModelCatalog } from '../lib/mediaModels'

export function mediaModelQueryOptions(baseUrl: string, apiKey: string, apiProxy: boolean, enabled = true) {
  const key = apiKey.trim()
  return {
    // 工坊和多个画布节点共用请求；换 Key 后立即隔离旧权限列表。
    queryKey: ['media-models', baseUrl, key, apiProxy],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchMediaModelCatalog(baseUrl, key, apiProxy, signal),
    enabled: enabled && Boolean(key && baseUrl),
    staleTime: 60_000,
    retry: false as const,
  }
}

export function useMediaModels(baseUrl: string, apiKey: string, apiProxy: boolean, enabled = true) {
  return useQuery(mediaModelQueryOptions(baseUrl, apiKey, apiProxy, enabled))
}
