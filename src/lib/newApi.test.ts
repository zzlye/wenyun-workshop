import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, GPT_IMAGE_2_SUPER_MODEL } from './apiProfiles'
import { queryNewApiBalance, queryNewApiModelPerformance, queryNewApiModelUnitCost, queryNewApiPriceTable } from './newApi'

describe('newApi model unit cost', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses ModelPrice from status when protected price endpoints are unavailable', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        'general_setting.custom_currency_symbol': 'HUHN',
        ModelPrice: JSON.stringify({
          'gpt-image-2': 0.06,
          'nano-banana-2': 0.09,
        }),
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await queryNewApiModelUnitCost({
      ...DEFAULT_SETTINGS.profiles[0],
      baseUrl: 'https://zzlye.xyz:60/v1',
      apiKey: 'test-key',
      model: 'nano-banana-2',
    })

    expect(result).toMatchObject({ text: 'HUHN 0.09', found: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('lets pricing endpoints override stale status model prices', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          'general_setting.custom_currency_symbol': 'HUHN',
          ModelPrice: JSON.stringify({
            'gpt-image-2': 0.06,
            'gpt-image-2-vip': 0.15,
          }),
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: [
          { model_name: 'gpt-image-2-vip', model_price: 0.09 },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await queryNewApiPriceTable({
      ...DEFAULT_SETTINGS.profiles[0],
      baseUrl: 'https://zzlye.xyz:60/v1',
      apiKey: 'test-key',
    })

    expect(result.found).toBe(true)
    expect(result.items).toEqual([
      { model: 'gpt-image-2', rawPrice: 0.06, text: 'HUHN 0.06' },
      { model: 'gpt-image-2-vip', rawPrice: 0.09, text: 'HUHN 0.09' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('queries the 4K model when displaying the fixed super model cost', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          'general_setting.custom_currency_symbol': 'HUHN',
          ModelPrice: JSON.stringify({ 'gpt-image-2-4k': 0.15 }),
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { 'gpt-image-2-4k': 0.15 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await queryNewApiModelUnitCost({
      ...DEFAULT_SETTINGS.profiles[0],
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: GPT_IMAGE_2_SUPER_MODEL,
    })

    expect(result).toMatchObject({ text: 'HUHN 0.15', found: true })
  })

  it('reads the NewAPI pricing data array when status has no model price map', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          'general_setting.custom_currency_symbol': 'HUHN',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: [
          { model_name: 'gpt-image-2', model_price: 0.06 },
          { model_name: 'gpt-image-2-vip', model_price: 0.15 },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await queryNewApiPriceTable({
      ...DEFAULT_SETTINGS.profiles[0],
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
    })

    expect(result.found).toBe(true)
    expect(result.items).toEqual([
      { model: 'gpt-image-2', rawPrice: 0.06, text: 'HUHN 0.06' },
      { model: 'gpt-image-2-vip', rawPrice: 0.15, text: 'HUHN 0.15' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/api/pricing')
  })

  it('reads pricing-get payloads returned by the public pricing endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          'general_setting.custom_currency_symbol': 'HUHN',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: {
          data: [
            { model_name: 'gpt-image-2', model_price: 0.06 },
            { model_name: 'gpt-image-2-vip', model_price: 0.09 },
          ],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await queryNewApiPriceTable({
      ...DEFAULT_SETTINGS.profiles[0],
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
    })

    expect(result.found).toBe(true)
    expect(result.items).toEqual([
      { model: 'gpt-image-2', rawPrice: 0.06, text: 'HUHN 0.06' },
      { model: 'gpt-image-2-vip', rawPrice: 0.09, text: 'HUHN 0.09' },
    ])
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/api/pricing')
  })

  it('does not request protected price endpoints without an access token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          'general_setting.custom_currency_symbol': 'HUHN',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await queryNewApiPriceTable({
      ...DEFAULT_SETTINGS.profiles[0],
      baseUrl: 'https://example.com/v1',
      apiKey: '',
    })

    expect(result).toMatchObject({ found: false, items: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('newApi balance', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('always sends a fresh balance request for repeated manual queries', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          'general_setting.custom_currency_symbol': 'HUHN',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          quota: 50_000,
          used_quota: 10_000,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          'general_setting.custom_currency_symbol': 'HUHN',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          quota: 40_000,
          used_quota: 20_000,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const profile = {
      ...DEFAULT_SETTINGS.profiles[0],
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
    }

    const first = await queryNewApiBalance(profile)
    const second = await queryNewApiBalance(profile)
    const balanceUrls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/api/user/self'))

    expect(first.text).toBe('可用 HUHN 0.1 / 已用 HUHN 0.02')
    expect(second.text).toBe('可用 HUHN 0.08 / 已用 HUHN 0.04')
    expect(balanceUrls).toHaveLength(2)
    expect(balanceUrls[0]).not.toBe(balanceUrls[1])
    expect(balanceUrls.every((url) => url.includes('_t='))).toBe(true)
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      cache: 'no-store',
      headers: expect.objectContaining({
        Authorization: 'Bearer test-key',
        'Cache-Control': 'no-cache, no-store, max-age=0',
        Pragma: 'no-cache',
      }),
    })
  })
})

describe('newApi model performance', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads NewAPI model square performance summary for the current profile', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: {
          models: [
            {
              model_name: 'gpt-image-2-4k',
              avg_latency_ms: 79930,
              success_rate: 99.88,
              avg_tps: 0,
            },
            {
              model_name: 'nano-banana-pro',
              avg_latency_ms: '194830',
              success_rate: '100',
              avg_tps: '0.25',
            },
          ],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await queryNewApiModelPerformance({
      ...DEFAULT_SETTINGS.profiles[0],
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
    })

    expect(result.found).toBe(true)
    expect(result.items).toEqual([
      {
        model: 'gpt-image-2-4k',
        avgLatencyMs: 79930,
        successRate: 99.88,
        avgTps: 0,
        requestCount: null,
      },
      {
        model: 'nano-banana-pro',
        avgLatencyMs: 194830,
        successRate: 100,
        avgTps: 0.25,
        requestCount: null,
      },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('https://example.com/api/perf-metrics/summary?hours=24')
    expect(String(fetchMock.mock.calls[0][0])).toContain('_t=')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      cache: 'no-store',
      headers: expect.objectContaining({
        'Cache-Control': 'no-cache, no-store, max-age=0',
      }),
    })
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('uses the locked same-origin performance proxy for the Wenyun site', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: {
          models: [
            {
              model_name: 'gpt-image-2',
              success_rate: 98.5,
            },
          ],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await queryNewApiModelPerformance({
      ...DEFAULT_SETTINGS.profiles[0],
      baseUrl: 'https://zzlye.xyz:60/v1',
      apiKey: 'test-key',
    })

    expect(result).toMatchObject({
      found: true,
      items: [
        expect.objectContaining({
          model: 'gpt-image-2',
          successRate: 98.5,
        }),
      ],
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/model-performance-proxy/wenyun/api/perf-metrics/summary?hours=24')
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('does not fake model square success rate from token logs when metrics require frontend login', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: false,
        message: '未登录',
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await queryNewApiModelPerformance({
      ...DEFAULT_SETTINGS.profiles[0],
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
    })

    expect(result).toMatchObject({ found: false, items: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('https://example.com/api/perf-metrics/summary?hours=24')
  })
})
