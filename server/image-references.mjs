import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { pipeline } from 'node:stream/promises'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_STORE_BYTES = 1024 * 1024 * 1024
const TTL_MS = 24 * 60 * 60 * 1000
const NAME = /^(\d{13})-[a-f0-9]{48}\.(png|jpg|webp|gif)$/
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
function fail(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }) }
function imageType(bytes) {
  if (bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg'
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  if (bytes.length > 10 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'gif'
  throw fail('参考图必须是 PNG、JPEG、WebP 或 GIF 图片')
}
function checkedUrl(value) {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('参考图服务地址无效')
  return url.href.replace(/\/+$/, '')
}

/** 参考图使用随机不可枚举地址；独立目录、有效期和容量上限避免长期堆积。 */
export function createImageReferenceService({ storageDirectory, publicBaseUrl, uploadUrl, upstreamBaseUrl, maxFileBytes = MAX_FILE_BYTES, maxStoreBytes = MAX_STORE_BYTES, ttlMs = TTL_MS }) {
  const base = publicBaseUrl ? checkedUrl(publicBaseUrl) : ''
  const remote = uploadUrl ? checkedUrl(uploadUrl) : ''
  const root = base && storageDirectory ? path.join(path.resolve(storageDirectory), 'references') : ''
  const files = new Map(), quotas = new Map()
  let totalBytes = 0, writing = Promise.resolve(), uploading = 0, preparing = 0
  if (root) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 })
    for (const name of fs.readdirSync(root)) {
      if (!NAME.test(name)) continue
      const stat = fs.lstatSync(path.join(root, name))
      if (!stat.isFile() || stat.isSymbolicLink()) continue
      files.set(name, stat.size); totalBytes += stat.size
    }
  }
  const sweep = async () => {
    for (const [name, size] of files) {
      if (Number(name.split('-')[0]) > Date.now()) continue
      await fsp.rm(path.join(root, name), { force: true })
      if (files.delete(name)) totalBytes -= size
    }
    for (const [key, quota] of quotas) if (quota.until < Date.now()) quotas.delete(key)
  }
  const cleanup = () => { const next = writing.then(sweep); writing = next.catch(() => {}); return next }
  const authenticate = async (headers, signal) => {
    const originalHeaders = new Headers(headers)
    const authorization = originalHeaders.get('authorization') || ''
    if (!/^Bearer\s+\S+$/i.test(authorization)) throw fail('参考图上传需要有效的 API Key', 401)
    // 仅向固定 NewAPI 读取模型权限，不创建生成任务，也不把凭据写入图片链接。
    const validationHeaders = new Headers({ Authorization: authorization })
    // 与生成请求保留同一条真实 IP 链路，避免设置 IP 白名单的 Key 被当作服务器地址拒绝。
    for (const name of ['x-real-ip', 'x-forwarded-for', 'x-forwarded-proto']) {
      if (originalHeaders.has(name)) validationHeaders.set(name, originalHeaders.get(name))
    }
    const response = await fetch(upstreamBaseUrl+'/models', { headers: validationHeaders, signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(15000)]), redirect: 'error' })
    const ok = response.ok && response.headers.get('content-type')?.includes('application/json')
    await response.body?.cancel()
    if (!ok) throw fail(response.status === 429 ? '参考图上传验证频繁，请稍后重试' : '参考图上传验证失败，请检查 API Key', response.status === 429 ? 429 : 401)
    return createHash('sha256').update(authorization).digest('hex')
  }
  const store = async (bytes, owner) => {
    if (!root) throw fail('参考图托管尚未配置', 503)
    if (!bytes.length || bytes.length > maxFileBytes) throw fail('单张 MJ 参考图不能超过 20MB', 413)
    const extension = imageType(bytes)
    const next = writing.then(async () => {
      await sweep()
      if (totalBytes + bytes.length > maxStoreBytes) throw fail('参考图存储已满，请稍后重试', 503)
      if (files.size >= 10000) throw fail('参考图数量已达上限，请稍后重试', 503)
      const quota = quotas.get(owner) || { bytes: 0, until: Date.now() + 3600000 }
      if (quota.bytes + bytes.length > 256 * 1024 * 1024 || (!quotas.has(owner) && quotas.size >= 10000)) throw fail('参考图上传过于频繁，请稍后重试', 429)
      const name = `${Date.now() + ttlMs}-${randomBytes(24).toString('hex')}.${extension}`
      const target = path.join(root, name)
      try { await fsp.writeFile(target, bytes, { flag: 'wx', mode: 0o600 }) }
      catch (error) { await fsp.rm(target, { force: true }).catch(() => {}); throw error }
      files.set(name, bytes.length); totalBytes += bytes.length
      quota.bytes += bytes.length; quotas.set(owner, quota)
      return base+'/image-tasks/references/'+name
    })
    writing = next.catch(() => {})
    return next
  }
  const upload = async (bytes, headers, signal, owner) => {
    if (root) return store(bytes, owner)
    if (!remote) throw fail('当前服务未配置 MJ 参考图托管，请使用公网图片链接', 503)
    const response = await fetch(remote, { method: 'POST', headers: { Authorization: new Headers(headers).get('authorization') || '', 'Content-Type': TYPES[imageType(bytes)] }, body: bytes, signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]), redirect: 'error' })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw fail(payload?.error?.message || `参考图上传失败（HTTP ${response.status}）`, response.status)
    // 桌面只能使用托管端返回的公开地址，绝不能把本机文件或临时端口作为参考图。
    const url = typeof payload.url === 'string' ? new URL(payload.url) : null
    if (!url || url.origin !== new URL(remote).origin || !url.pathname.startsWith('/image-tasks/references/') || !NAME.test(url.pathname.split('/').pop()) || url.username || url.password) throw fail('参考图上传未返回有效的公网地址', 502)
    return url.href
  }
  return {
    cleanup,
    async prepare(body, headers, signal) {
      const input = JSON.parse(body.toString('utf8'))
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('MJ 请求格式无效')
      const refs = input.images ?? (input.image ? [input.image] : [])
      if (!Array.isArray(refs) || refs.length > 5 || input.images && input.image) throw fail('MJ 最多支持 5 张参考图，不能同时使用 image 和 images')
      const values = [...refs, ...['cref', 'sref', 'dref'].map(key => input[key]).filter(value => value != null)]
      for (const value of values) if (typeof value !== 'string' || !/^(https?:\/\/|data:image\/)/i.test(value)) throw fail('MJ 参考图必须是公网图片链接或本地图片')
      if (!values.some(value => /^data:/i.test(value))) return body
      if (preparing >= 4) throw fail('参考图正在上传，请稍后重试', 429)
      preparing++
      try {
        if (!root && !remote) throw fail('当前服务未配置 MJ 参考图托管，请使用公网图片链接', 503)
        const owner = root ? await authenticate(headers, signal) : ''
        const converted = new Map()
        for (const value of values) {
          if (!/^data:/i.test(value) || converted.has(value)) continue
          if (value.length > Math.ceil(maxFileBytes / 3) * 4 + 100) throw fail('单张 MJ 参考图不能超过 20MB', 413)
          const match = /^data:image\/(?:png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value)
          if (!match) throw fail('MJ 参考图数据无效，请重新添加图片')
          const bytes = Buffer.from(match[1], 'base64')
          if (bytes.toString('base64').replace(/=+$/, '') !== match[1].replace(/=+$/, '') || bytes.length > maxFileBytes) throw fail('MJ 参考图数据无效或超过 20MB')
          imageType(bytes)
          converted.set(value, await upload(bytes, headers, signal, owner))
        }
        if (input.image) input.image = converted.get(input.image) ?? input.image
        if (input.images) input.images = input.images.map(value => converted.get(value) ?? value)
        for (const key of ['cref', 'sref', 'dref']) if (input[key]) input[key] = converted.get(input[key]) ?? input[key]
        return Buffer.from(JSON.stringify(input))
      } finally { preparing-- }
    },
    async handle(request, response, readBody, sendJson) {
      const url = new URL(request.url, 'http://reference.local')
      if (url.pathname === '/image-tasks/reference-uploads') {
        if (request.method !== 'POST') { sendJson(response, 405, { error: { message: 'Method Not Allowed' } }); return true }
        if (!root) { sendJson(response, 503, { error: { message: '参考图托管尚未配置' } }); return true }
        if (uploading >= 4) { sendJson(response, 429, { error: { message: '参考图正在上传，请稍后重试' } }); return true }
        uploading++
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 120000)
        const abort = () => { if (!response.writableFinished) controller.abort() }
        response.on('close', abort)
        try {
          const owner = await authenticate(request.headers, controller.signal)
          if (Number(request.headers['content-length']) > maxFileBytes) throw fail('单张 MJ 参考图不能超过 20MB', 413)
          const bytes = await Promise.race([readBody(request, maxFileBytes), new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(fail('参考图上传超时', 408)), { once: true }))])
          controller.signal.throwIfAborted()
          sendJson(response, 201, { url: await store(bytes, owner), expires_in: Math.floor(ttlMs / 1000) })
        } catch (error) { sendJson(response, Number(error.statusCode) || 502, { error: { message: error.statusCode ? error.message : '参考图上传失败，请稍后重试' } }) }
        finally { clearTimeout(timer); response.off('close', abort); uploading-- }
        return true
      }
      if (!url.pathname.startsWith('/image-tasks/references/')) return false
      const name = url.pathname.slice('/image-tasks/references/'.length)
      if (!root || !NAME.test(name) || !files.has(name)) { sendJson(response, 404, { error: { message: '参考图不存在' } }); return true }
      if (!['GET', 'HEAD'].includes(request.method)) { sendJson(response, 405, { error: { message: 'Method Not Allowed' } }); return true }
      if (Number(name.split('-')[0]) <= Date.now()) { sendJson(response, 410, { error: { message: '参考图已过期' } }); return true }
      response.writeHead(200, { 'Content-Type': TYPES[name.split('.').pop()], 'Content-Length': files.get(name), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Access-Control-Allow-Origin': '*' })
      if (request.method === 'HEAD') response.end()
      else await pipeline(fs.createReadStream(path.join(root, name)), response).catch(() => response.destroy())
      return true
    },
  }
}
