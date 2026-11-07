import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const UPLOAD = '/image-tasks/media-reference-uploads'
const CONTENT = '/image-tasks/media-references/'
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', weba: 'audio/webm', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg' }
const NAME = /^(\d{13})-[a-f0-9]{48}\.(png|jpg|webp|gif|mp4|mov|webm|weba|wav|mp3|m4a|ogg)$/
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
function mediaType(b, declared) {
  if (b.length < 12) throw fail('参考素材内容不完整')
  const text = (start, end) => b.toString('ascii', start, end)
  if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png'
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'jpg'
  if (/^GIF8[79]a$/.test(text(0, 6))) return 'gif'
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'webp'
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE') return 'wav'
  if (text(0, 3) === 'ID3' || (b[0] === 255 && (b[1] & 0xe0) === 0xe0)) return 'mp3'
  if (text(0, 4) === 'OggS' && declared.startsWith('audio/')) return 'ogg'
  if (b.subarray(0, 4).equals(Buffer.from([26,69,223,163]))) {
    if (declared === 'video/webm') return 'webm'
    if (declared === 'audio/webm') return 'weba'
  }
  if (text(4, 8) === 'ftyp') {
    if (declared === 'audio/mp4' || text(8, 12) === 'M4A ') return 'm4a'
    return text(8, 12) === 'qt  ' ? 'mov' : 'mp4'
  }
  throw fail('请上传 PNG、JPEG、WebP、GIF、MP4、MOV、WebM、MP3、WAV、M4A 或 OGG 素材')
}
function checkedBase(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('素材托管地址无效')
  return url.origin
}

// 视频参考素材独立存储、流式写盘；桌面转发至固定托管端，公开链接不携带账号凭据。
export function createMediaReferenceService({ storageDirectory, publicBaseUrl, uploadUrl, upstreamBaseUrl, maxFileBytes = 200 * 1024 * 1024, maxStoreBytes = 4 * 1024 ** 3, maxOwnerBytes = 512 * 1024 * 1024, ttlMs = 86400000 }) {
  const base = publicBaseUrl ? checkedBase(publicBaseUrl) : ''
  const remote = uploadUrl ? checkedBase(uploadUrl) + UPLOAD : ''
  const root = base && storageDirectory ? path.join(path.resolve(storageDirectory), 'media-references') : ''
  const files = new Map(), quotas = new Map()
  let total = 0, reserved = 0, active = 0
  if (root) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 })
    for (const name of fs.readdirSync(root)) {
      // 本实例独占目录；重启后清掉未完成上传，不计入公开素材索引。
      if (/^\d{13}-[a-f0-9]{48}\.upload$/.test(name)) { fs.rmSync(path.join(root, name), { force: true }); continue }
      if (!NAME.test(name)) continue
      const stat = fs.lstatSync(path.join(root, name))
      if (stat.isFile() && !stat.isSymbolicLink()) { files.set(name, stat.size); total += stat.size }
    }
  }
  let cleaning = Promise.resolve()
  function cleanup() {
    cleaning = cleaning.catch(() => {}).then(async () => {
      for (const [name, size] of files) if (Number(name.split('-')[0]) <= Date.now()) {
        await fsp.rm(path.join(root, name), { force: true })
        if (files.delete(name)) total -= size
      }
      for (const [key, q] of quotas) if (!q.active && q.until <= Date.now()) quotas.delete(key)
    })
    return cleaning
  }
  return {
    cleanup,
    async handle(request, response, sendJson) {
      const url = new URL(request.url, 'http://media.local')
      if (url.pathname === UPLOAD) {
        if (request.method !== 'POST') { sendJson(response, 405, { error: { message: 'Method Not Allowed' } }); return true }
        let temp, quota, allocation = 0, admitted = false
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 180000)
        const abort = () => { if (!response.writableFinished) controller.abort() }
        response.on('close', abort)
        try {
          if (active >= 4) throw fail('素材正在上传，请稍后重试', 429)
          active++; admitted = true
          if (!root && !remote) throw fail('素材托管尚未配置', 503)
          const authorization = request.headers.authorization || ''
          if (!/^Bearer\s+\S+$/i.test(authorization)) throw fail('素材上传需要有效的 API Key', 401)
          const length = Number(request.headers['content-length'])
          if (length > maxFileBytes) throw fail('单个参考素材不能超过 200MB', 413)
          const declared = String(request.headers['content-type'] || '').split(';')[0].toLowerCase()
          if (!/^(image|audio|video)\//.test(declared)) throw fail('参考素材类型无效')
          if (!root) {
            // 直接流式转发原字节，不将整个视频读入本机任务服务内存。
            const r = await fetch(remote, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': declared }, body: request, duplex: 'half', redirect: 'error', signal: controller.signal })
            const payload = await r.json().catch(() => ({}))
            if (!r.ok) throw fail(payload.error?.message || '素材上传失败', r.status)
            const result = new URL(payload.url)
            if (result.origin !== new URL(remote).origin || result.username || result.password || result.search || result.hash || !result.pathname.startsWith(CONTENT) || !NAME.test(result.pathname.slice(CONTENT.length))) throw fail('素材上传返回地址无效', 502)
            sendJson(response, 201, { url: result.href, expires_in: payload.expires_in })
            return true
          }
          const headers = { Authorization: authorization }
          for (const name of ['x-real-ip', 'x-forwarded-for', 'x-forwarded-proto']) if (request.headers[name]) headers[name] = request.headers[name]
          const auth = await fetch(upstreamBaseUrl + '/models', { headers, redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
          const valid = auth.ok && auth.headers.get('content-type')?.includes('application/json')
          await auth.body?.cancel()
          if (!valid) throw fail(auth.status === 429 ? '素材上传验证频繁，请稍后重试' : '素材上传验证失败，请检查 API Key', auth.status === 429 ? 429 : 401)
          await cleanup()
          allocation = length > 0 ? length : maxFileBytes
          if (total + reserved + allocation > maxStoreBytes || files.size + active > 10000) { allocation = 0; throw fail('素材临时空间已满，请稍后重试', 503) }
          reserved += allocation
          const owner = createHash('sha256').update(authorization).digest('hex')
          quota = quotas.get(owner)
          if (!quota) {
            if (quotas.size >= 10000) throw fail('素材上传繁忙，请稍后重试', 429)
            quota = { bytes: 0, reserved: 0, active: 0, until: Date.now() + 3600000 }; quotas.set(owner, quota)
          }
          if (quota.bytes + quota.reserved + allocation > maxOwnerBytes) { quota = null; throw fail('素材上传过于频繁，请稍后重试', 429) }
          quota.reserved += allocation; quota.active++
          const stem = `${Date.now() + ttlMs}-${randomBytes(24).toString('hex')}`
          temp = path.join(root, stem + '.upload')
          let size = 0, head = Buffer.alloc(0)
          const limiter = new Transform({ transform(chunk, encoding, callback) {
            size += chunk.length
            if (size > maxFileBytes || size > allocation) return callback(fail('单个参考素材不能超过 200MB', 413))
            if (head.length < 512) head = Buffer.concat([head, chunk.subarray(0, 512 - head.length)])
            callback(null, chunk)
          } })
          await pipeline(request, limiter, fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }), { signal: controller.signal })
          const extension = mediaType(head, declared)
          if (TYPES[extension].split('/')[0] !== declared.split('/')[0]) throw fail('参考素材内容与文件类型不一致')
          const name = stem + '.' + extension
          await fsp.rename(temp, path.join(root, name)); temp = null
          files.set(name, size); total += size; quota.bytes += size
          sendJson(response, 201, { url: base + CONTENT + name, expires_in: Math.floor(ttlMs / 1000) })
        } catch (error) {
          if (!response.destroyed) sendJson(response, Number(error.statusCode) || 502, { error: { message: error.statusCode ? error.message : '素材上传失败，请稍后重试' } })
        } finally {
          clearTimeout(timer); response.off('close', abort)
          if (temp) await fsp.rm(temp, { force: true }).catch(() => {})
          if (quota) { quota.reserved -= allocation; quota.active-- }
          reserved -= allocation
          if (admitted) active--
        }
        return true
      }
      if (!url.pathname.startsWith(CONTENT)) return false
      const name = url.pathname.slice(CONTENT.length)
      if (!root || !NAME.test(name) || !files.has(name)) { sendJson(response, 404, { error: { message: '参考素材不存在' } }); return true }
      if (!['GET', 'HEAD'].includes(request.method)) { sendJson(response, 405, { error: { message: 'Method Not Allowed' } }); return true }
      if (Number(name.split('-')[0]) <= Date.now()) { sendJson(response, 410, { error: { message: '参考素材已过期' } }); return true }
      const size = files.get(name)
      let start = 0, end = size - 1, status = 200
      if (request.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range)
        if (match && (match[1] || match[2])) {
          start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
          end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
        } else start = size
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return true }
        status = 206
      }
      response.writeHead(status, { 'Content-Type': TYPES[name.split('.').pop()], 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Access-Control-Allow-Origin': '*' })
      if (request.method === 'HEAD') response.end()
      else await pipeline(fs.createReadStream(path.join(root, name), { start, end }), response).catch(() => response.destroy())
      return true
    },
  }
}
