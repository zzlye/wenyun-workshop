import { fetchMediaModelCatalog } from './mediaModels'
import { CANVAS_VIDEO_BASE_URL } from './videoModel'

// 媒体专用 Key 同时可见多种模型，视频入口只接收视频目录。
export async function fetchVideoModelList(apiKey: string, apiProxy: boolean, signal?: AbortSignal): Promise<string[]> {
  if (!apiKey.trim()) throw new Error('视频 Key 尚未就绪，请在设置中查看或登录账号')
  return (await fetchMediaModelCatalog(CANVAS_VIDEO_BASE_URL, apiKey, apiProxy, signal)).videos.map(item => item.value)
}
