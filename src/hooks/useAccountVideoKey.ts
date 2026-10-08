import { useQuery } from '@tanstack/react-query'
import { useStore } from '../store'
import { LOCKED_WENYUN_PROFILE_ID, normalizeSettings } from '../lib/apiProfiles'
import { ensureNewApiVideoBoundKey, isRetryableNewApiAccountError } from '../lib/newApiAccount'
import { getBoundVideoApiKey } from '../lib/videoAccount'

export function useAccountVideoKey() {
  const settings = normalizeSettings(useStore(state => state.settings))
  const profile = settings.profiles.find(item => item.id === LOCKED_WENYUN_PROFILE_ID)!
  const session = settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]
  return useQuery({
    queryKey: ['account-video-key', profile.baseUrl, session?.userId, session?.accessToken],
    enabled: Boolean(session && !getBoundVideoApiKey(session)),
    // 老账号首次打开页面时可能短暂断网；有限重试，并先复用服务端已有的视频 Key。
    retry: (failureCount, error) => failureCount < 2 && isRetryableNewApiAccountError(error),
    retryDelay: attempt => Math.min(1000 * 2 ** attempt, 5000),
    staleTime: 0,
    refetchOnWindowFocus: query => isRetryableNewApiAccountError(query.state.error),
    refetchOnReconnect: query => isRetryableNewApiAccountError(query.state.error),
    queryFn: async () => {
      if (!session) return false
      const before = useStore.getState().settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]
      // 重试等待期间退出或切换账号时，不能再为旧账号发送创建令牌请求。
      if (!before || before.accessToken !== session.accessToken || before.userId !== session.userId) return false
      if (getBoundVideoApiKey(before)) return true
      const updated = await ensureNewApiVideoBoundKey(profile, session)
      const store = useStore.getState()
      const current = store.settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]
      // 退出或切换账号后丢弃迟到结果，不能恢复旧会话或覆盖新的图片 Key。
      if (!current || current.accessToken !== session.accessToken || current.userId !== session.userId) return false
      store.setSettings({
        newApiAccountSessions: {
          ...store.settings.newApiAccountSessions,
          [LOCKED_WENYUN_PROFILE_ID]: {
            ...current,
            accessToken: updated.accessToken,
            authSessionId: updated.authSessionId,
            accessTokenExpiresAt: updated.accessTokenExpiresAt,
            boundVideoApiKey: updated.boundVideoApiKey,
            boundVideoApiKeyId: updated.boundVideoApiKeyId,
            boundVideoApiKeyName: updated.boundVideoApiKeyName,
            boundVideoApiKeyGroup: updated.boundVideoApiKeyGroup,
          },
        },
      })
      return true
    },
  })
}

export function AccountVideoKeySync() {
  // 新登录和恢复的老会话都自动补齐，视频授权失败不阻止图片使用。
  useAccountVideoKey()
  return null
}
