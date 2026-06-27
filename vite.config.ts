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
}

const lockedFetchProxyRoutes: LockedFetchProxyRoute[] = [
  {
    prefix: '/api-proxy/wenyun',
    target: 'https://zzlye.xyz:60',
    rewrite: (path) => path.replace(/^\/api-proxy\/wenyun/, '/v1'),
  },
  {
    prefix: '/api-proxy/public',
    target: 'https://1520635.xyz:3901',
    rewrite: (path) => path.replace(/^\/api-proxy\/public/, '/v1'),
  },
  {
    prefix: '/newapi-proxy/wenyun',
    target: 'https://zzlye.xyz:60',
    rewrite: (path) => path.replace(/^\/newapi-proxy\/wenyun/, ''),
  },
  {
    prefix: '/newapi-proxy/public',
    target: 'https://1520635.xyz:3901',
    rewrite: (path) => path.replace(/^\/newapi-proxy\/public/, ''),
  },
  {
    prefix: '/wy-public/wenyun',
    target: 'https://zzlye.xyz:60',
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

        const route = lockedFetchProxyRoutes.find((item) => requestUrl.startsWith(item.prefix))
        if (!route) {
          next()
          return
        }

        try {
          const targetUrl = new URL(route.rewrite(requestUrl), route.target)
          const method = req.method ?? 'GET'
          const hasBody = method !== 'GET' && method !== 'HEAD'
          const body = hasBody ? await readRequestBody(req) : undefined
          const response = await fetch(targetUrl, {
            method,
            headers: toFetchHeaders(req.headers),
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
  const target = parsed.searchParams.get('url')?.trim()
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
