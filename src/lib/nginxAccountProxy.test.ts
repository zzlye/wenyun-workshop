import { describe, expect, it } from 'vitest'
import nginxConfig from '../../deploy/nginx.conf?raw'

const getLocationBlock = (location: string) => {
  const start = nginxConfig.indexOf(location)
  expect(start).toBeGreaterThanOrEqual(0)

  const nextLocation = nginxConfig.indexOf('\n    location ', start + location.length)
  return nginxConfig.slice(start, nextLocation === -1 ? undefined : nextLocation)
}

describe('文运账号反向代理配置', () => {
  it('账号接口通过容器网络直连 NewAPI 并传递真实来源链', () => {
    const block = getLocationBlock('location /newapi-proxy/wenyun/')

    expect(block).toContain('proxy_pass http://new-api:3000/;')
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
