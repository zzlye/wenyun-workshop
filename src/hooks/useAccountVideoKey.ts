import { useQuery } from '@tanstack/react-query'
import { useStore } from '../store'
import { LOCKED_WENYUN_PROFILE_ID, normalizeSettings } from '../lib/apiProfiles'
import { ensureNewApiVideoBoundKey } from '../lib/newApiAccount'
import { getBoundVideoApiKey } from '../lib/videoAccount'

export function useAccountVideoKey() {
  const settings = normalizeSettings(useStore(state => state.settings))
  const profile = settings.profiles.find(item => item.id === LOCKED_WENYUN_PROFILE_ID)!
  const session = settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]
  return useQuery({
    queryKey: ['account-video-key', profile.baseUrl, session?.userId, session?.accessToken],
    enabled: Boolean(session && !getBoundVideoApiKey(session)),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!session) return false
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
