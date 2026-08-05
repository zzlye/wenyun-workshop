import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, URL } from 'node:url'
import { ASSET_PROXY_PREFIX, normalizeDevProxyConfig } from './src/lib/devProxy'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown,
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

type LockedFetchProxyRoute = {
  prefix: string
  target: string
  rewrite: (path: string) => string
  exact?: boolean
  auth?: {
    accessTokenEnv: string
    userIdEnv: string
    label: string
  }
}

const lockedFetchProxyRoutes: LockedFetchProxyRoute[] = [
  {
    prefix: '/model-performance-proxy/wenyun/api/perf-metrics/summary',
    target: 'https://api.zzlye.xyz',
    rewrite: (path) => path.replace(/^\/model-performance-proxy\/wenyun/, ''),
    exact: true,
    auth: {
      accessTokenEnv: 'NEWAPI_WENYUN_ACCESS_TOKEN',
      userIdEnv: 'NEWAPI_WENYUN_USER_ID',
      label: '文运站成功率代理',
    },
  },
  {
    prefix: '/model-performance-proxy/public/api/perf-metrics/summary',
    target: 'https://1520635.xyz:3901',
    rewrite: (path) => path.replace(/^\/model-performance-proxy\/public/, ''),
    exact: true,
    auth: {
      accessTokenEnv: 'NEWAPI_PUBLIC_ACCESS_TOKEN',
      userIdEnv: 'NEWAPI_PUBLIC_USER_ID',
      label: '公益站成功率代理',
    },
  },
  {
    prefix: '/model-pricing-proxy/wenyun/api/pricing',
    target: 'https://api.zzlye.xyz',
    rewrite: (path) => path.replace(/^\/model-pricing-proxy\/wenyun/, ''),
    exact: true,
    auth: {
      accessTokenEnv: 'NEWAPI_WENYUN_ACCESS_TOKEN',
      userIdEnv: 'NEWAPI_WENYUN_USER_ID',
      label: '文运站价格代理',
    },
  },
  {
    prefix: '/model-pricing-proxy/public/api/pricing',
    target: 'https://1520635.xyz:3901',
    rewrite: (path) => path.replace(/^\/model-pricing-proxy\/public/, ''),
    exact: true,
    auth: {
      accessTokenEnv: 'NEWAPI_PUBLIC_ACCESS_TOKEN',
      userIdEnv: 'NEWAPI_PUBLIC_USER_ID',
      label: '公益站价格代理',
    },
  },
  {
    prefix: '/api-proxy/wenyun',
    target: 'https://api.zzlye.xyz',
    rewrite: (path) => path.replace(/^\/api-proxy\/wenyun/, '/v1'),
  },
  {
    prefix: '/api-proxy/public',
    target: 'https://1520635.xyz:3901',
    rewrite: (path) => path.replace(/^\/api-proxy\/public/, '/v1'),
  },
  {
    prefix: '/newapi-proxy/wenyun',
    target: 'https://api.zzlye.xyz',
    rewrite: (path) => path.replace(/^\/newapi-proxy\/wenyun/, ''),
  },
  {
    prefix: '/newapi-proxy/public',
    target: 'https://1520635.xyz:3901',
    rewrite: (path) => path.replace(/^\/newapi-proxy\/public/, ''),
  },
  {
    prefix: '/wy-public/wenyun',
    target: 'https://api.zzlye.xyz',
    rewrite: (path) => path.replace(/^\/wy-public\/wenyun/, ''),
  },
]

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'proxy-authenticate',
  'proxy-authorization',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function toFetchHeaders(headers: Record<string, string | string[] | undefined>): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(normalizedName)) continue
    if (value == null) continue
    result.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  return result
}

function writeResponseHeaders(response: Response, res: import('node:http').ServerResponse) {
  response.headers.forEach((value, name) => {
    const normalizedName = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(normalizedName)) return
    if (normalizedName === 'content-encoding') return
    res.setHeader(name, value)
  })
}

function findLockedFetchProxyRoute(requestUrl: string): LockedFetchProxyRoute | null {
  const pathname = new URL(requestUrl, 'http://localhost').pathname
  return lockedFetchProxyRoutes.find((item) =>
    item.exact ? pathname === item.prefix : requestUrl.startsWith(item.prefix),
  ) ?? null
}

async function readRequestBody(req: import('node:http').IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function lockedFetchProxyPlugin() {
  return {
    name: 'locked-fetch-proxy',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = req.url ?? ''
        const assetProxyTarget = resolveAssetProxyTarget(requestUrl)
        if (assetProxyTarget) {
          try {
            const response = await fetch(assetProxyTarget, {
              method: req.method ?? 'GET',
              headers: toFetchHeaders(req.headers),
              redirect: 'follow',
            })

            res.statusCode = response.status
            res.statusMessage = response.statusText
            writeResponseHeaders(response, res)
            if (!response.body) {
              res.end()
              return
            }
            await pipeline(Readable.fromWeb(response.body as any), res)
          } catch (error) {
            const cause = error instanceof Error && 'cause' in error && error.cause ? `\n原因: ${String(error.cause)}` : ''
            const message = error instanceof Error ? `${error.stack ?? error.message}${cause}` : String(error)
            server.config.logger.error(`[asset-proxy] ${requestUrl} 代理失败:\n${message}`)
            if (!res.headersSent) {
              res.statusCode = 502
              res.setHeader('Content-Type', 'text/plain;charset=utf-8')
            }
            res.end('图片代理请求失败')
          }
          return
        }

        const route = findLockedFetchProxyRoute(requestUrl)
        if (!route) {
          next()
          return
        }

        try {
          const accessToken = route.auth ? process.env[route.auth.accessTokenEnv]?.trim() ?? '' : ''
          const userId = route.auth ? process.env[route.auth.userIdEnv]?.trim() ?? '' : ''
          if (route.auth && (!accessToken || !userId)) {
            res.statusCode = 503
            res.setHeader('Content-Type', 'text/plain;charset=utf-8')
            res.end(`${route.auth.label}未配置`)
            return
          }

          const targetUrl = new URL(route.rewrite(requestUrl), route.target)
          const method = req.method ?? 'GET'
          if (route.auth && method !== 'GET' && method !== 'HEAD') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'text/plain;charset=utf-8')
            res.end('成功率代理只允许 GET 请求')
            return
          }
          const hasBody = method !== 'GET' && method !== 'HEAD'
          const body = hasBody ? await readRequestBody(req) : undefined
          const headers = toFetchHeaders(req.headers)
          if (route.auth) {
            // 本地开发代理只给成功率接口注入 NewAPI 前台 Access Token，不把凭证写入浏览器代码。
            headers.set('Authorization', `Bearer ${accessToken}`)
            headers.set('New-Api-User', userId)
            headers.set('Cache-Control', 'no-cache')
          }
          const response = await fetch(targetUrl, {
            method,
            headers,
            redirect: 'manual',
            ...(hasBody ? { body } : {}),
          })

          res.statusCode = response.status
          res.statusMessage = response.statusText
          writeResponseHeaders(response, res)
          if (!response.body) {
            res.end()
            return
          }
          await pipeline(Readable.fromWeb(response.body as any), res)
        } catch (error) {
          const cause = error instanceof Error && 'cause' in error && error.cause ? `\n原因: ${String(error.cause)}` : ''
          const message = error instanceof Error ? `${error.stack ?? error.message}${cause}` : String(error)
          server.config.logger.error(`[locked-fetch-proxy] ${requestUrl} 代理失败:\n${message}`)
          if (!res.headersSent) {
            res.statusCode = 502
            res.setHeader('Content-Type', 'text/plain;charset=utf-8')
          }
          res.end('代理请求失败')
        }
      })
    },
  }
}

function resolveAssetProxyTarget(requestUrl: string): string | null {
  if (!requestUrl.startsWith(ASSET_PROXY_PREFIX)) return null
  const parsed = new URL(requestUrl, 'http://localhost')
  const pathMatch = parsed.pathname.match(/^\/asset-proxy\/(https?)\/(.+)$/)
  if (pathMatch) {
    return normalizeAssetProxyTarget(`${pathMatch[1]}://${pathMatch[2]}${parsed.search}`)
  }

  const target = parsed.searchParams.get('url')?.trim()
  // 兼容旧版 ?url= 格式，已部署的新版本会优先使用路径式代理。
  return target ? normalizeAssetProxyTarget(target) : null
}

function normalizeAssetProxyTarget(target: string): string | null {
  if (!target) return null
  try {
    const targetUrl = new URL(target)
    // 图片代理只允许 HTTP(S)，避免误读本地文件或其他协议。
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') return null
    return targetUrl.toString()
  } catch {
    return null
  }
}

export default defineConfig(({ command }) => {
  const devProxyConfig = command === 'serve' ? loadDevProxyConfig() : null
  const imageTaskDevTarget = process.env.IMAGE_TASK_DEV_TARGET?.trim() || 'http://127.0.0.1:8787'
  const publicProxy = {
    '/wy-public/mukyu': {
      target: 'https://i.mukyu.ru',
      changeOrigin: true,
      secure: true,
      rewrite: (path: string) => path.replace(/^\/wy-public\/mukyu/, ''),
    },
  }

  return {
    plugins: [lockedFetchProxyPlugin(), react()],
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
      'process.env.NEXT_PUBLIC_APP_VERSION': JSON.stringify('v0.1.0'),
      'process.env.NEXT_PUBLIC_APP_RELEASES': JSON.stringify('[]'),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src/infiniteCanvasSource', import.meta.url)),
        'next/link': fileURLToPath(new URL('./src/infiniteCanvasCompat/NextLink.tsx', import.meta.url)),
        'next/navigation': fileURLToPath(new URL('./src/infiniteCanvasCompat/nextNavigation.tsx', import.meta.url)),
      },
    },
    server: {
      host: true,
      proxy: {
        ...publicProxy,
        '/image-tasks': {
          target: imageTaskDevTarget,
          changeOrigin: true,
          timeout: 900_000,
          proxyTimeout: 900_000,
        },
        ...(devProxyConfig?.enabled
          ? {
              [devProxyConfig.prefix]: {
                target: devProxyConfig.target,
                changeOrigin: devProxyConfig.changeOrigin,
                secure: devProxyConfig.secure,
                timeout: 900_000,
                proxyTimeout: 900_000,
                rewrite: (path) =>
                  path.replace(
                    new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
                    '',
                  ),
              },
            }
          : {}),
      },
    },
  }
})
