import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useStore } from '../store'
import { normalizeSettings } from '../lib/apiProfiles'
import { fetchNewApiAccountModelCatalog, fetchNewApiSiteStatus, requestNewApiAccountResource } from '../lib/newApiAccount'
import { applyMediaCatalogMetadata, parseMediaCatalogMetadata } from '../lib/mediaCatalogPricing'
import { useMediaModels } from './useMediaModels'

export function useMediaCatalog(baseUrl: string, apiKey: string, apiProxy: boolean, enabled = true) {
  const settings = normalizeSettings(useStore(state => state.settings))
  const profile = settings.profiles.find(item => item.baseUrl === baseUrl)
  const candidate = profile && settings.newApiAccountSessions[profile.id]
  // 手填别人的 Key 不能套用当前登录账号的专属倍率或价格。
  const session = candidate?.boundApiKeyPurpose === 'media' && candidate.boundApiKey === apiKey ? candidate : undefined
  const models = useMediaModels(baseUrl, apiKey, apiProxy, enabled)
  const fallback = useQuery({
    queryKey: ['media-catalog-pricing', baseUrl, apiKey, session?.userId, session?.accessToken],
    enabled: enabled && Boolean(session && profile && models.isSuccess && !models.data.metadata),
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!profile || !session) throw new Error('请登录后查看分类和报价')
      // 兼容尚未携带目录扩展字段的服务器，授权配置与报价必须属于同一账号。
      const [config, pricing, status] = await Promise.all([
        requestNewApiAccountResource<{ groups: string[] }>(profile, session, '/api/token/media-groups', { signal }),
        fetchNewApiAccountModelCatalog(profile, session, 'pricing', signal),
        fetchNewApiSiteStatus(profile, signal),
      ])
      const metadata = parseMediaCatalogMetadata({ ...(pricing as object), groups: config.groups, status })
      if (!metadata) throw new Error('暂时无法获取分类和报价')
      return metadata
    },
  })
  const metadata = models.data?.metadata ?? (session ? fallback.data : undefined)
  const data = useMemo(() => models.data && metadata ? applyMediaCatalogMetadata(models.data, metadata) : models.data, [models.data, metadata])
  return { data, metadataReady: Boolean(metadata), isFetching: models.isFetching || fallback.isFetching,
    error: models.error ?? (models.data?.metadata ? null : fallback.error),
    updatedAt: Math.max(models.dataUpdatedAt, fallback.dataUpdatedAt),
    refetch: async () => {
      const refreshed = await models.refetch()
      // 升级后的目录已含专属报价，不再沿用刷新前的状态重复请求账号接口。
      if (session && refreshed.isSuccess && !refreshed.data.metadata) await fallback.refetch()
    },
  }
}
