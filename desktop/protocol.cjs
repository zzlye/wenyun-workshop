const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const APP_ORIGIN = 'wenyun://app';
const DEFAULT_UPSTREAMS = { wenyun: 'https://api.xn--v5z30ywuk.com', public: 'https://1520635.xyz:3901' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; media-src 'self' data: blob: http: https:; connect-src 'self' http: https:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

function httpUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('不支持此接口地址');
  return url;
}

function resolveProxy(url, taskOrigin, upstreams = DEFAULT_UPSTREAMS) {
  const matched = url.pathname.match(/^\/(api-proxy|newapi-proxy|model-pricing-proxy|model-performance-proxy)\/(wenyun|public)(\/.*)?$/);
  if (matched) {
    const [, kind, site, suffix = '/'] = matched;
    const target = `${upstreams[site]}${kind === 'api-proxy' ? '/v1' : ''}${suffix}${url.search}`;
    const readOnly = kind === 'model-pricing-proxy' || kind === 'model-performance-proxy';
    if (kind === 'model-pricing-proxy' && suffix !== '/api/pricing') throw new Error('价格接口路径无效');
    if (kind === 'model-performance-proxy' && suffix !== '/api/perf-metrics/summary') throw new Error('统计接口路径无效');
    return { url: httpUrl(target), readOnly, cookies: true };
  }
  if (url.pathname === '/api/user/auth/refresh') return { url: httpUrl(`${upstreams.wenyun}${url.pathname}${url.search}`), cookies: true };
  if (/^\/image-tasks(?:\/|$)/.test(url.pathname)) return { url: httpUrl(`${taskOrigin}${url.pathname}${url.search}`), cookies: false };
  const generic = url.pathname.match(/^\/(desktop-api|asset-proxy)\/(https?)\/(.+)$/);
  if (generic) return { url: httpUrl(`${generic[2]}://${generic[3]}${url.search}`), readOnly: generic[1] === 'asset-proxy', cookies: false };
  if (url.pathname.startsWith('/wy-public/mukyu/')) return { url: httpUrl(`https://i.mukyu.ru${url.pathname.slice('/wy-public/mukyu'.length)}${url.search}`), readOnly: true, cookies: false };
  return null;
}

function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'wenyun:' && url.host === 'app' && !url.username && !url.password;
  } catch { return false; }
}

function isAppDocumentUrl(value) {
  if (!isAppUrl(value)) return false;
  const pathname = new URL(value).pathname;
  return !/^\/(?:api|api-proxy|newapi-proxy|model-pricing-proxy|model-performance-proxy|desktop-api|asset-proxy|image-tasks|wy-public|downloads)(?:\/|$)/.test(pathname);
}

function createProtocolHandler({ webRoot, taskOrigin, fetch, upstreams }) {
  const root = path.resolve(webRoot);
  // 只放行安装包入口已有的内联脚本，远程接口返回的内容始终禁止作为页面执行。
  const policy = fs.readFile(path.join(root, 'index.html'), 'utf8').then((html) => {
    const hashes = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), (match) => `'sha256-${crypto.createHash('sha256').update(match[1]).digest('base64')}'`);
    return CSP.replace("script-src 'self'", `script-src 'self' ${hashes.join(' ')}`);
  }).catch(() => CSP);
  return async (request) => {
    if (!isAppUrl(request.url)) return new Response('Forbidden', { status: 403 });
    const url = new URL(request.url);
    try {
      const route = resolveProxy(url, taskOrigin, upstreams);
      if (route) {
        if (request.destination === 'document') return new Response('Forbidden', { status: 403 });
        if (route.readOnly && !['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
        const headers = new Headers(request.headers);
        // 来源及 Cookie 由本机网络会话管理，不将桌面页面的头部发送给任意素材站点。
        for (const name of Array.from(headers.keys())) {
          if (['host', 'connection', 'content-length', 'cookie', 'origin', 'referer'].includes(name.toLowerCase()) || name.toLowerCase().startsWith('sec-')) headers.delete(name);
        }
        if (route.readOnly && !route.cookies) headers.delete('authorization');
        if (route.cookies) {
          headers.set('Origin', route.url.origin);
          headers.set('Referer', `${route.url.origin}/`);
        }
        const hasBody = !['GET', 'HEAD'].includes(request.method);
        const response = await fetch(route.url.href, {
          method: request.method,
          headers,
          credentials: route.cookies ? 'include' : 'omit',
          redirect: 'follow',
          signal: request.signal,
          ...(hasBody ? { body: await request.arrayBuffer() } : {}),
        });
        const responseHeaders = new Headers(response.headers);
        // 网络层已解压响应，重新保留压缩长度会造成长响应被截断。
        for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie']) responseHeaders.delete(name);
        responseHeaders.set('Cache-Control', 'no-store');
        responseHeaders.set('Content-Security-Policy', "default-src 'none'; sandbox; frame-ancestors 'none'");
        responseHeaders.set('X-Content-Type-Options', 'nosniff');
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
      }
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
      const requested = decodeURIComponent(url.pathname);
      const file = path.resolve(root, `.${requested}`);
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) return new Response('Forbidden', { status: 403 });
      let target = file;
      try {
        if (!(await fs.stat(target)).isFile()) target = path.join(root, 'index.html');
      } catch {
        // 历史路由回退只用于页面，缺失脚本和未知接口不能返回 HTML 冒充成功。
        if (path.extname(requested) || /^\/(api|asset-proxy|desktop-api)(\/|$)/.test(requested)) return new Response('Not found', { status: 404 });
        target = path.join(root, 'index.html');
      }
      const response = await fetch(pathToFileURL(target).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', await policy);
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
    } catch {
      return Response.json({ error: { message: '本机请求失败，请检查接口地址和网络连接' } }, { status: 502 });
    }
  };
}

module.exports = { APP_ORIGIN, isAppUrl, isAppDocumentUrl, createProtocolHandler, resolveProxy };
