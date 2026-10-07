import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { buildVideoCatalogRows, fetchVideoModelCatalog, type VideoCatalogData } from './videoModelCatalog'

const profile = DEFAULT_SETTINGS.profiles[0]
const session = { siteProfileId: profile.id, username: 'test', userId: 2, accessToken: 'account-session', boundVideoApiKey: 'generation-key', boundVideoApiKeyGroup: '视频' }
const price = (extra: Record<string, unknown> = {}) => ({ model_name: 'video-new', description: '来自服务端的简介', enable_groups: ['视频'], quota_type: 1, model_price: 3, ...extra })
const catalog = (items: unknown[] = [price()], ratio: unknown = 1): VideoCatalogData => ({
  pricing: { success: true, data: items, group_ratio: { default: 99, 视频: ratio } },
  performance: { data: { models: [{ model_name: 'video-new', success_rate: 83.33, request_count: 6 }] } },
  status: { data: { quota_display_type: 'CUSTOM', custom_currency_symbol: 'HUHN', custom_currency_exchange_rate: 1 } },
  errors: [], updatedAt: 1,
})
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('视频模型目录归一化', () => {
  it('名称与简介自动来自接口，只展示视频组且去重，新增模型无需改代码', () => {
    const rows = buildVideoCatalogRows(catalog([price(), price(), price({ model_name: 'future-v9' }), price({ model_name: 'image-only', enable_groups: ['default'] })]))
    expect(rows.map(row => row.model)).toEqual(['future-v9', 'video-new'])
    expect(rows[1]).toMatchObject({ description: '来自服务端的简介', priceText: 'HUHN 3 / 次', successRate: 83.33 })
  })

  it('有视频Key时名单以令牌权限为准，保留没有元数据的新模型', () => {
    const rows = buildVideoCatalogRows(catalog([price(), price({ model_name: 'image-only', enable_groups: ['default'] })]), [' unlisted ', 'unlisted', 'image-only'])
    expect(rows).toEqual([{ model: 'unlisted', description: '暂无简介', priceText: '暂无价格', priceNote: '', successRate: null }])
    expect(buildVideoCatalogRows(catalog(), [])).toEqual([])
  })

  it('访客不根据名称猜视频模型；允许接口明确声明的全组模型', () => {
    expect(buildVideoCatalogRows(catalog([price({ model_name: 'wan-not-authorized', enable_groups: undefined }), price({ model_name: 'all-groups', enable_groups: ['all'] })])).map(row => row.model)).toEqual(['all-groups'])
  })

  it('仅使用视频组倍率，金额再按站点币种换算', () => {
    const input = catalog([price()], 0.5)
    input.status = { data: { quota_display_type: 'CNY', usd_exchange_rate: 7.2 } }
    expect(buildVideoCatalogRows(input)[0].priceText).toBe('¥ 10.8 / 次')
  })

  it('价格很大也不猜额度；无币种配置时明确显示USD', () => {
    const input = catalog([price({ model_price: 5000 })])
    input.status = null
    expect(buildVideoCatalogRows(input)[0].priceText).toBe('USD 5,000 / 次')
  })

  it.each([0, '0'])('保留显式零价格和零倍率：%s', zero => {
    expect(buildVideoCatalogRows(catalog([price({ model_price: zero })]))[0].priceText).toBe('HUHN 0 / 次')
    expect(buildVideoCatalogRows(catalog([price()], zero))[0].priceText).toBe('HUHN 0 / 次')
  })

  it.each([null, undefined, '', false, -1, 'bad', Infinity])('不把无效金额或倍率显示成免费：%s', invalid => {
    expect(buildVideoCatalogRows(catalog([price({ model_price: invalid })]))[0].priceText).toBe('暂无价格')
    const input = catalog()
    input.pricing = { data: [price()], group_ratio: { 视频: invalid } }
    expect(buildVideoCatalogRows(input)[0].priceText).toBe('暂无价格')
  })

  it.each(['per_second', 'per-second'])('正确显示按秒价，不伪造整段视频费用：%s', mode => {
    const row = buildVideoCatalogRows(catalog([price({ billing_mode: mode, billing_expr: 'duration * 3' })]))[0]
    expect(row.priceText).toBe('HUHN 3 / 秒')
    expect(row.priceNote).toContain('基准价')
  })

  it.each([{ billing_mode: 'tiered_expr' }, { billing_plugin_variants: [{}] }, { billing_mode: 'future-mode' }])('复杂或未知计费不冒充固定价格：%j', extra => {
    expect(buildVideoCatalogRows(catalog([price(extra)]))[0].priceText).toBe('按参数计费')
  })

  it('用量计费不展示为按次收费', () => {
    expect(buildVideoCatalogRows(catalog([price({ quota_type: 0, billing_mode: 'ratio' })]))[0].priceText).toBe('按用量计费')
  })

  it.each([[0, 2, 0], ['0', 1, 0], [100, 0, null], [null, 2, null], [false, 2, null], [101, 2, null], [-1, 2, null]])('区分成功率零与没有统计：%s / %s', (rate, count, expected) => {
    const input = catalog()
    input.performance = { data: { models: [{ model_name: 'video-new', success_rate: rate, request_count: count }] } }
    expect(buildVideoCatalogRows(input)[0].successRate).toBe(expected)
  })

  it('接口不返回简介或成功率时不捏造文案和数据', () => {
    const input = catalog([price({ description: ' ' })])
    input.performance = null
    expect(buildVideoCatalogRows(input)[0]).toMatchObject({ description: '暂无简介', successRate: null })
  })
})

describe('视频目录获取与鉴权', () => {
  it('公开目录只读并行请求三个资源，不携带Key或Cookie', async () => {
    const fetch = vi.fn().mockImplementation(async () => response({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetch)
    const result = await fetchVideoModelCatalog(profile)
    expect(result.errors).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      '/newapi-proxy/wenyun/api/pricing', '/newapi-proxy/wenyun/api/perf-metrics/summary?hours=24', '/newapi-proxy/wenyun/api/status',
    ])
    for (const [, init] of fetch.mock.calls) expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store' })
    expect(fetch.mock.calls.every(([, init]) => !init.headers)).toBe(true)
  })

  it('登录目录用账号会话获取专属报价，不拿生成Key冒充管理令牌', async () => {
    const payload = catalog().pricing
    const fetch = vi.fn().mockImplementation(async () => response(payload))
    vi.stubGlobal('fetch', fetch)
    const result = await fetchVideoModelCatalog(profile, session)
    expect(result.pricing).toEqual(payload)
    expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer account-session', 'New-Api-User': '2' }, method: 'GET' })
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('generation-key')
    expect(fetch.mock.calls[2][1].headers).toBeUndefined()
  })

  it('单个接口失败不丢弃其余数据，不发送生成请求', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('pricing') ? response({ success: false }, 502) : response({ data: { models: [] } })))
    const result = await fetchVideoModelCatalog(profile)
    expect(result.pricing).toBeNull()
    expect(result.performance).not.toBeNull()
    expect(result.errors).toEqual(['简介与价格暂未获取，请稍后刷新'])
    expect(buildVideoCatalogRows(result, ['future-model'])[0].priceText).toBe('暂无价格')
  })

  it('会话刷新卡住或请求不处理signal时仍在10秒结束', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const request = fetchVideoModelCatalog(profile, session)
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await request
    expect(result.pricing).toBeNull()
    expect(result.errors).toHaveLength(2)
  })

  it('取消时拒绝旧结果而不是覆盖新账号目录', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const controller = new AbortController()
    const request = fetchVideoModelCatalog(profile, undefined, controller.signal)
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
  })
})
