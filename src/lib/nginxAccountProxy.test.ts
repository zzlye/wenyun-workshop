import { describe, expect, it } from 'vitest'
import nginxConfig from '../../deploy/nginx.conf?raw'
import viteConfig from '../../vite.config.ts?raw'
import { writeResponseHeaders } from '../../server/dev-proxy-headers'

const getLocationBlock = (location: string) => {
  const start = nginxConfig.indexOf(location)
  expect(start).toBeGreaterThanOrEqual(0)

  const nextLocation = nginxConfig.indexOf('\n    location ', start + location.length)
  return nginxConfig.slice(start, nextLocation === -1 ? undefined : nextLocation)
}

describe('文运账号反向代理配置', () => {
  it('登录和续期的多个Cookie逐条保留，不能逗号拼接丢失刷新会话', () => {
    const cookies = ['new_api_refresh=fixture; Path=/api/user/auth; Expires=Wed, 28 Oct 2026 08:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
      'new_api_has_session=1; Path=/; SameSite=Strict']
    const response = new Response('{}', { headers: [['Set-Cookie', cookies[0]], ['Set-Cookie', cookies[1]], ['Content-Type', 'application/json'], ['Content-Length', '99']] })
    const result: Record<string, string | string[]> = {}
    writeResponseHeaders(response, { setHeader: (name, value) => { result[name.toLowerCase()] = value } })
    expect(result['set-cookie']).toEqual(cookies)
    expect(result['content-type']).toBe('application/json')
    expect(result).not.toHaveProperty('content-length')
  })
  it('视频提交及结果下载的代理时限不早于1800秒', () => {
    for (const location of ['location /api-proxy/wenyun/', 'location ~ ^/asset-proxy/', 'location /asset-proxy {']) {
      const block = getLocationBlock(location)
      expect(block).toContain('proxy_send_timeout 1800s;')
      expect(block).toContain('proxy_read_timeout 1800s;')
    }
    expect(viteConfig).toContain('upstreamRequest.setTimeout(CANVAS_VIDEO_TIMEOUT * 1000,')
    expect(getLocationBlock('location /api-proxy/public/')).toContain('proxy_read_timeout 900s;')
  })

  it('账号接口通过容器网络直连 NewAPI 并传递真实来源链', () => {
    const block = getLocationBlock('location /newapi-proxy/wenyun/')

    expect(block).toContain('proxy_pass http://new-api:3000/;')
    expect(block).toContain('limit_except GET POST PUT DELETE OPTIONS')
    expect(block).toContain('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;')
    expect(block).not.toContain('proxy_pass https://api.zzlye.xyz/')
  })

  it('登录刷新接口通过容器网络直连 NewAPI 并传递真实来源链', () => {
    const block = getLocationBlock('location = /api/user/auth/refresh')

    expect(block).toContain('proxy_pass http://new-api:3000/api/user/auth/refresh;')
    expect(block).toContain('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;')
    expect(block).not.toContain('proxy_pass https://api.zzlye.xyz/api/user/auth/refresh;')
  })
})
