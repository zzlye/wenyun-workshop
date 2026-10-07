import { useQuery } from '@tanstack/react-query'
import { fetchVideoModelList } from '../lib/videoModelList'
import { CANVAS_VIDEO_BASE_URL } from '../lib/videoModel'

export function useVideoModels(apiKey: string, apiProxy: boolean, enabled = true, refetchOnMount: boolean | 'always' = true) {
  const key = apiKey.trim()
  return useQuery({
    // 节点和设置共用查询；切换密钥后隔离列表，旧请求不会覆盖新密钥的结果。
    queryKey: ['canvas-video-models', CANVAS_VIDEO_BASE_URL, key, apiProxy],
    queryFn: ({ signal }) => fetchVideoModelList(key, apiProxy, signal),
    enabled: enabled && Boolean(key),
    refetchOnMount,
    staleTime: 60_000,
    retry: false,
  })
}
