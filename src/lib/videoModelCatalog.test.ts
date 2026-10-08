import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { buildVideoCatalogRows, fetchVideoModelCatalog, type VideoCatalogData } from './videoModelCatalog'

const profile = DEFAULT_SETTINGS.profiles[0]
const session = { siteProfileId: profile.id, username: 'test', userId: 2, accessToken: 'account-session', boundVideoApiKey: 'generation-key', boundVideoApiKeyGroup: '视频' }
const price = (extra: Record<string, unknown> = {}) => ({ model_name: 'video-new', description: '来自服务端的简介', enable_groups: ['视频'], quota_type: 1, model_price: 3, ...extra })
const catalog = (items: unknown[] = [price()], ratio: unknown = 1): VideoCatalogData => ({
  pricing: { success: true, data: items, group_ratio: { default: 99, 视频: ratio } },
  pricingSource: 'public',
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
    expect(rows).toEqual([{ model: 'unlisted', description: '暂无简介', priceText: '暂无价格', priceNote: '', priceTiers: [], successRate: null }])
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

  it('按分辨率显示明确配置的单价，并应用视频组倍率和币种换算', () => {
    const input = catalog([price({
      billing_mode: 'per_second',
      billing_expr: 'param("resolution") == "1080p" ? 0.93 : param("resolution") == "720p" ? 0.48 : 0.27',
    })], 2)
    input.status = { data: { quota_display_type: 'CNY', usd_exchange_rate: 7.2 } }
    expect(buildVideoCatalogRows(input)[0]).toMatchObject({
      priceText: '按分辨率计费',
      priceNote: '',
      priceTiers: [
        { label: '480p', priceText: '¥ 3.888 / 秒' },
        { label: '720p', priceText: '¥ 6.912 / 秒' },
        { label: '1080p', priceText: '¥ 13.392 / 秒' },
      ],
    })
  })

  it('只列出表达式明确声明的档位，不把默认分支猜成缺失分辨率', () => {
    const row = buildVideoCatalogRows(catalog([price({
      billing_mode: 'per_second',
      billing_expr: 'param("resolution") == "4k" ? 1.25 : 0.6',
    })]))[0]
    expect(row.priceTiers).toEqual([{ label: '4k', priceText: 'HUHN 1.25 / 秒' }])
  })

  it('参数不是分辨率或表达式结构不完整时不猜价格档位', () => {
    for (const billing_expr of [
      'param("duration") == 10 ? 0.9 : 0.4',
      'param("resolution") == "1080p" ? 0.9 : unknown(0.4)',
      'param("resolution") == "1080p" ? param("duration") : 0.4',
    ]) {
      const row = buildVideoCatalogRows(catalog([price({ billing_mode: 'per_second', billing_expr })]))[0]
      expect(row.priceText).toBe('按参数计费')
      expect(row.priceTiers).toEqual([])
    }
  })

  it.each(['per_second', 'per_request'])('%s 分辨率价格来自表达式而非基础价，新增模型不需要写死', mode => {
    const row = buildVideoCatalogRows(catalog([price({
      model_name: 'future-resolution-model', model_price: null, billing_mode: mode,
      billing_expr: 'param("resolution") == "1080p" ? 0.93 : param("resolution") == "720p" ? 0.48 : 0.27',
    })]))[0]
    const unit = mode === 'per_second' ? '秒' : '次'
    expect(row.priceTiers).toEqual([
      { label: '480p', priceText: `HUHN 0.27 / ${unit}` },
      { label: '720p', priceText: `HUHN 0.48 / ${unit}` },
      { label: '1080p', priceText: `HUHN 0.93 / ${unit}` },
    ])
    expect(row.priceNote).toBe('')
  })

  it('按次模型没有分辨率规则时保留固定单价', () => {
    expect(buildVideoCatalogRows(catalog([price({ billing_mode: 'per_request' })]))[0]).toMatchObject({ priceText: 'HUHN 3 / 次', priceTiers: [] })
  })

  it('自定义币种、零档位和零分组倍率都正确应用', () => {
    const input = catalog([price({ billing_mode: 'per_second', billing_expr: 'param("resolution") == "720p" ? 0 : param("resolution") == "1080p" ? 4.8e-1 : .27' })], 0.5)
    input.status = { data: { quota_display_type: 'CUSTOM', custom_currency_symbol: '积分', custom_currency_exchange_rate: 10 } }
    expect(buildVideoCatalogRows(input)[0].priceTiers.map(tier => tier.priceText)).toEqual(['积分 1.35 / 秒', '积分 0 / 秒', '积分 2.4 / 秒'])
    input.pricing = { ...input.pricing as object, group_ratio: { 视频: 0 } }
    expect(buildVideoCatalogRows(input)[0].priceTiers.map(tier => tier.priceText)).toEqual(['积分 0 / 秒', '积分 0 / 秒', '积分 0 / 秒'])
  })

  it('显式三档和其他分辨率均保留声明价格，不从模型名猜档位', () => {
    const input = catalog([price({ billing_mode: 'per_second', billing_expr: 'param("resolution") == "480p" ? .1 : param("resolution") == "1080p" ? .3 : param("resolution") == "720p" ? .2 : 1' })])
    expect(buildVideoCatalogRows(input)[0].priceTiers.map(tier => tier.priceText)).toEqual(['HUHN 0.1 / 秒', 'HUHN 0.2 / 秒', 'HUHN 0.3 / 秒'])
    const other = catalog([price({ billing_mode: 'per_request', billing_expr: 'param ( "resolution" ) == "360p" ? 0 : param("resolution") == "4K" ? 1.6 : 1' })])
    expect(buildVideoCatalogRows(other)[0].priceTiers).toEqual([{ label: '360p', priceText: 'HUHN 0 / 次' }, { label: '4K', priceText: 'HUHN 1.6 / 次' }])
  })

  it.each([
    'param("resolution") == "720p" ? 1 : param("resolution") == "720p" ? 2 : 3',
    'param("resolution") == "720p" ? -1 : 1',
    'param("resolution") == "720p" ? 1e999 : 1',
    'param("resolution") == "720p" ? 1 : 1e999',
    'param("resolution") == "720p" ? 1 :',
    'param("resolution") == "720p" ? 1 : 0; globalThis.unexpected = true',
  ])('重复、异常数值或混入代码的规则不会产生价格档位：%s', billing_expr => {
    expect(buildVideoCatalogRows(catalog([price({ billing_mode: 'per_second', billing_expr })]))[0]).toMatchObject({ priceText: '按参数计费', priceTiers: [] })
  })

  it('分辨率规则的倍率缺失或金额溢出时不冒充免费', () => {
    const expression = 'param("resolution") == "1080p" ? .93 : param("resolution") == "720p" ? .48 : .27'
    for (const ratio of [null, -1, false, Infinity]) {
      expect(buildVideoCatalogRows(catalog([price({ billing_mode: 'per_second', billing_expr: expression })], ratio))[0]).toMatchObject({ priceText: '暂无价格', priceTiers: [] })
    }
    const input = catalog([price({ billing_mode: 'per_second', billing_expr: 'param("resolution") == "720p" ? 1e308 : 1' })], 1e308)
    expect(buildVideoCatalogRows(input)[0]).toMatchObject({ priceText: '暂无价格', priceTiers: [] })
  })

  it('插件报价或用量计费仍优先，不被分辨率条件覆盖', () => {
    const billing_expr = 'param("resolution") == "1080p" ? .93 : param("resolution") == "720p" ? .48 : .27'
    expect(buildVideoCatalogRows(catalog([price({ billing_mode: 'per_second', billing_expr, billing_plugin_variants: [{}] })]))[0]).toMatchObject({ priceText: '按参数计费', priceTiers: [] })
    expect(buildVideoCatalogRows(catalog([price({ billing_mode: 'per_second', billing_expr, quota_type: 0 })]))[0]).toMatchObject({ priceText: '按用量计费', priceTiers: [] })
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
    expect(result.pricingSource).toBe('public')
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
    expect(result.pricingSource).toBe('account')
    expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer account-session', 'New-Api-User': '2' }, method: 'GET' })
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('generation-key')
    expect(fetch.mock.calls[2][1].headers).toBeUndefined()
  })

  it('管理会话过期且刷新失败时仍能读取公开目录，不携带账号或生成凭据', async () => {
    const input = catalog([price()], 0.5)
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh') || (init?.headers as Record<string, string> | undefined)?.Authorization) {
        return response({ success: false, message: '登录状态已过期' }, 401)
      }
      return response(url.endsWith('/pricing') ? input.pricing : url.includes('/perf-metrics/') ? input.performance : input.status)
    })
    vi.stubGlobal('fetch', fetch)
    const result = await fetchVideoModelCatalog(profile, session)
    expect(result.errors).toEqual([])
    expect(result.pricingSource).toBe('public')
    expect(buildVideoCatalogRows(result, ['video-new'])[0]).toMatchObject({ priceText: 'HUHN 1.5 / 次', successRate: 83.33, description: '来自服务端的简介' })
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1)
    for (const path of ['/api/pricing', '/api/perf-metrics/summary?hours=24']) {
      const calls = fetch.mock.calls.filter(([url]) => url.endsWith(path))
      expect(calls).toHaveLength(2)
      expect(calls[1][1]).toMatchObject({ credentials: 'omit', cache: 'no-store' })
      expect(calls[1][1]?.headers).toBeUndefined()
    }
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('generation-key')
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => url.endsWith('/api/user/auth/refresh'))).toEqual([true])
  })

  it('会话刷新成功仍使用账号专属倍率，不改用公开参考价格', async () => {
    const input = catalog([price()], 0.25)
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return response({ success: true, data: { access_token: 'renewed-session', id: session.userId } })
      if (url.endsWith('/status')) return response(input.status)
      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization
      if (authorization === 'Bearer account-session') return response({ success: false, message: '登录状态已过期' }, 401)
      expect(authorization).toBe('Bearer renewed-session')
      return response(url.endsWith('/pricing') ? input.pricing : input.performance)
    })
    vi.stubGlobal('fetch', fetch)
    const result = await fetchVideoModelCatalog(profile, session)
    expect(result.pricingSource).toBe('account')
    expect(result.errors).toEqual([])
    expect(buildVideoCatalogRows(result)[0].priceText).toBe('HUHN 0.75 / 次')
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1)
    expect(fetch.mock.calls.filter(([url, init]) => !url.endsWith('/status') && init?.credentials === 'omit')).toHaveLength(0)
  })

  it('成功率单独失败只恢复成功率，不替换已获得的专属价格', async () => {
    const input = catalog([price()], 0.1)
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/perf-metrics/') && (init?.headers as Record<string, string> | undefined)?.Authorization) return response({ success: false }, 503)
      return response(url.endsWith('/pricing') ? input.pricing : url.includes('/perf-metrics/') ? input.performance : input.status)
    })
    vi.stubGlobal('fetch', fetch)
    const result = await fetchVideoModelCatalog(profile, session)
    expect(result.pricingSource).toBe('account')
    expect(result.errors).toEqual([])
    expect(buildVideoCatalogRows(result)[0]).toMatchObject({ priceText: 'HUHN 0.3 / 次', successRate: 83.33 })
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/pricing'))).toHaveLength(1)
  })

  it.each([401, 403])('公开价格接口仍拒绝访问时保留错误，不套用旧账号报价：%s', async status => {
    const fetch = vi.fn(async (url: string) => url.endsWith('/pricing')
      ? response({ success: false }, status)
      : response({ success: true, data: { models: [] } }))
    vi.stubGlobal('fetch', fetch)
    const result = await fetchVideoModelCatalog(profile, session)
    expect(result.pricing).toBeNull()
    expect(result.pricingSource).toBeNull()
    expect(result.errors).toEqual(['简介与价格暂未获取，请稍后刷新'])
    expect(buildVideoCatalogRows(result, ['video-new'])[0].priceText).toBe('暂无价格')
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/pricing'))).toHaveLength(2)
  })

  it('取消目录后不再追加公开请求，即使原账号请求稍后才失败', async () => {
    let fail: (error: Error) => void = () => {}
    const fetch = vi.fn((url: string) => url.endsWith('/status') ? Promise.resolve(response({ success: true })) : new Promise<Response>((_, reject) => { fail = reject }))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    const request = fetchVideoModelCatalog(profile, session, controller.signal)
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    fail(new Error('账号目录请求失败'))
    await Promise.resolve()
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(3)
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
