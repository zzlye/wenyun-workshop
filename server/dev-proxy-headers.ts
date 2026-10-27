const OMITTED_HEADERS = new Set([
  'connection', 'content-length', 'content-encoding', 'expect', 'host', 'keep-alive',
  'origin', 'proxy-authenticate', 'proxy-authorization', 'referer', 'te', 'trailer',
  'transfer-encoding', 'upgrade',
])

export function writeResponseHeaders(response: Response, res: { setHeader(name: string, value: string | string[]): unknown }) {
  response.headers.forEach((value, name) => {
    if (OMITTED_HEADERS.has(name.toLowerCase()) || name.toLowerCase() === 'set-cookie') return
    res.setHeader(name, value)
  })
  // Cookie 必须逐条转发；重复 setHeader 会丢掉前面的刷新凭据，逗号合并也会破坏 Expires。
  const cookies = response.headers.getSetCookie()
  if (cookies.length) res.setHeader('set-cookie', cookies)
}
