import { describe, expect, it } from 'vitest'
import nginxConfig from '../../deploy/nginx.conf?raw'
import viteConfig from '../../vite.config.ts?raw'

const getLocationBlock = (location: string) => {
  const start = nginxConfig.indexOf(location)
  expect(start).toBeGreaterThanOrEqual(0)

  const nextLocation = nginxConfig.indexOf('\n    location ', start + location.length)
  return nginxConfig.slice(start, nextLocation === -1 ? undefined : nextLocation)
}

describe('文运账号反向代理配置', () => {
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
