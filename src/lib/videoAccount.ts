import type { NewApiAccountSession } from '../types'

// 与站点已有的视频分组精确对应，不使用默认组或自动跨组路由。
export const VIDEO_ACCOUNT_GROUP = '视频'

export function getBoundVideoApiKey(session?: NewApiAccountSession | null): string {
  return session?.boundVideoApiKeyGroup === VIDEO_ACCOUNT_GROUP ? session.boundVideoApiKey?.trim() ?? '' : ''
}
