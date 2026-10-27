import { useQuery } from '@tanstack/react-query'
import { mediaModelQueryOptions } from './useMediaModels'
import { CANVAS_VIDEO_BASE_URL } from '../lib/videoModel'

export function useVideoModels(apiKey: string, apiProxy: boolean, enabled = true, refetchOnMount: boolean | 'always' = true) {
  return useQuery({
    // 价格页、设置和画布共用媒体目录，不为同一 Key 重复请求。
    ...mediaModelQueryOptions(CANVAS_VIDEO_BASE_URL, apiKey, apiProxy, enabled),
    select: catalog => catalog.videos.map(item => item.value),
    refetchOnMount,
  })
}
