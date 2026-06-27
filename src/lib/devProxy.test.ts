import { describe, expect, it } from 'vitest'
import { buildApiUrl, getLockedAssetProxyUrl, getLockedNewApiPerformanceProxyUrl, getLockedNewApiProxyUrl, shouldUseApiProxyForBaseUrl } from './devProxy'

describe('buildApiUrl', () => {
  it('uses the same-origin proxy prefix when API proxy is enabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'images/edits', null, true)).toBe(
      '/api-proxy/images/edits',
    )
  })

  it('leaves API versioning to the proxy target when proxying', () => {
    expect(buildApiUrl('http://api.example.com', 'images/generations', null, true)).toBe(
      '/api-proxy/images/generations',
    )
  })

  it('uses a configured proxy prefix when one is available', () => {
    expect(
      buildApiUrl(
        'http://api.example.com/v1',
        'responses',
        {
          enabled: true,
          prefix: '/openai-proxy',
          target: 'http://api.example.com/v1',
          changeOrigin: true,
          secure: false,
        },
        true,
      ),
    ).toBe('/openai-proxy/responses')
  })

  it('routes the locked Wenyun site through its dedicated same-origin proxy', () => {
    expect(buildApiUrl('https://zzlye.xyz:60/v1', 'images/generations', null, true)).toBe(
      '/api-proxy/wenyun/images/generations',
    )
  })

  it('routes the locked public site through its dedicated same-origin proxy', () => {
    expect(buildApiUrl('https://1520635.xyz:3901/v1', 'models', null, true)).toBe(
      '/api-proxy/public/models',
    )
  })

  it('uses the locked Wenyun proxy even when the generic proxy is unavailable', () => {
    expect(shouldUseApiProxyForBaseUrl(false, 'https://zzlye.xyz:60/v1', null)).toBe(true)
  })

  it('routes Wenyun root-domain asset URLs through the same-origin proxy', () => {
    expect(getLockedNewApiProxyUrl('https://zzlye.xyz/files/final.png?token=1')).toBe(
      '/newapi-proxy/wenyun/files/final.png?token=1',
    )
    expect(getLockedAssetProxyUrl('https://zzlye.xyz/files/final.png')).toBe(
      '/newapi-proxy/wenyun/files/final.png',
    )
  })

  it('routes only locked NewAPI performance summary through the credentialed proxy', () => {
    expect(getLockedNewApiPerformanceProxyUrl('https://zzlye.xyz:60/api/perf-metrics/summary?hours=24')).toBe(
      '/model-performance-proxy/wenyun/api/perf-metrics/summary?hours=24',
    )
    expect(getLockedNewApiPerformanceProxyUrl('https://1520635.xyz:3901/api/perf-metrics/summary?hours=24')).toBe(
      '/model-performance-proxy/public/api/perf-metrics/summary?hours=24',
    )
    expect(getLockedNewApiPerformanceProxyUrl('https://zzlye.xyz:60/api/models/')).toBeNull()
  })

  it('routes third-party image assets through the generic same-origin asset proxy', () => {
    expect(getLockedAssetProxyUrl('https://bafang.me/files/final.png?token=1')).toBe(
      '/asset-proxy?url=https%3A%2F%2Fbafang.me%2Ffiles%2Ffinal.png%3Ftoken%3D1',
    )
  })

  it('does not force custom API URLs through the proxy when the generic proxy is unavailable', () => {
    expect(shouldUseApiProxyForBaseUrl(true, 'https://api.example.com/v1', null)).toBe(false)
  })

  it('uses the configured API URL directly when API proxy is disabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'responses', null, false)).toBe(
      'http://api.example.com/v1/responses',
    )
  })
})
