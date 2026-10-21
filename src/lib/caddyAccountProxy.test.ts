import { describe, expect, it } from 'vitest'
import caddyConfig from '../../deploy/Caddyfile?raw'

describe('账号内部代理的来源隔离', () => {
  it('只在内部转发入口信任西米露容器的来源链', () => {
    const start = caddyConfig.indexOf('http://:3000 {')
    expect(start).toBeGreaterThanOrEqual(0)
    const internalProxy = caddyConfig.slice(start)

    // 外部 HTTPS 入口必须继续丢弃伪造头，内部第二跳才保留已校验的来源。
    expect(internalProxy).toMatch(/reverse_proxy\s+127\.0\.0\.1:\d+\s*\{/)
    expect(internalProxy).toContain('trusted_proxies 172.19.0.4/32')
    expect(caddyConfig.slice(0, start)).not.toContain('trusted_proxies')
    expect(caddyConfig).not.toMatch(/trusted_proxies[^\n]*(?:private_ranges|0\.0\.0\.0\/0|::\/0)/)
  })
})
