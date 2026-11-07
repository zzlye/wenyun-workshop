import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test, afterEach } from 'node:test'
import { createMediaReferenceService } from './media-references.mjs'

const resources = [], dirs = []
afterEach(async () => {
  for (const server of resources.splice(0)) { server.closeAllConnections(); await new Promise(r => server.close(r)) }
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const wav = Buffer.concat([Buffer.from('RIFF0000WAVEfmt '), Buffer.alloc(64)])
const mp4 = Buffer.concat([Buffer.from([0,0,0,24]), Buffer.from('ftypisom'), Buffer.alloc(1024)])
async function start(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); resources.push(server); return `http://127.0.0.1:${server.address().port}` }
async function fixture(options = {}) {
  const authHeaders = []
  const upstream = await start(createServer((req, res) => {
    assert.equal(req.url, '/v1/models'); authHeaders.push(req.headers)
    res.writeHead(req.headers.authorization === 'Bearer test-key' ? 200 : 401, { 'Content-Type': 'application/json' }); res.end('{}')
  }))
  const dir = options.storageDirectory || await fs.mkdtemp(path.join(os.tmpdir(), 'video-refs-'))
  if (!options.storageDirectory) dirs.push(dir)
  let service
  const base = await start(createServer(async (req, res) => {
    const send = (r, status, value) => { r.writeHead(status, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(value)) }
    if (!await service.handle(req, res, send)) send(res, 404, {})
  }))
  service = createMediaReferenceService({ storageDirectory: dir, publicBaseUrl: base, upstreamBaseUrl: upstream + '/v1', ...options })
  return { base, dir, service, authHeaders, upload: (bytes, type = 'image/png', headers = {}) => fetch(base + '/image-tasks/media-reference-uploads', { method: 'POST', headers: { Authorization: 'Bearer test-key', 'Content-Type': type, ...headers }, body: bytes }) }
}
test('图片视频音频流式托管保留原字节，匿名读取且不泄露凭据', async () => {
  const f = await fixture()
  for (const [bytes, type] of [[png, 'image/png'], [wav, 'audio/wav'], [mp4, 'video/mp4']]) {
    const r = await f.upload(bytes, type, { 'x-real-ip': '192.0.2.9', Cookie: 'private' }); assert.equal(r.status, 201)
    const { url } = await r.json(); assert.ok(!url.includes('test-key'))
    const result = await fetch(url); assert.equal(result.status, 200); assert.equal(result.headers.get('content-type'), type)
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes)
    const head = await fetch(url, { method: 'HEAD' }); assert.equal(Number(head.headers.get('content-length')), bytes.length)
  }
  assert.ok(f.authHeaders.every(h => h['x-real-ip'] === '192.0.2.9' && !h.cookie))
})
test('视频支持分段、尾部读取及非法范围拒绝', async () => {
  const f = await fixture(); const { url } = await (await f.upload(mp4, 'video/mp4')).json()
  for (const [range, bytes] of [['bytes=4-11', mp4.subarray(4, 12)], ['bytes=-8', mp4.subarray(-8)]]) {
    const r = await fetch(url, { headers: { Range: range } }); assert.equal(r.status, 206)
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes)
  }
  assert.equal((await fetch(url, { headers: { Range: 'bytes=99999-' } })).status, 416)
})
test('桌面流式转发至固定托管端，返回远程 URL，实际媒体内容一致', async () => {
  const hosted = await fixture()
  const desktop = await fixture({ publicBaseUrl: '', uploadUrl: hosted.base })
  const r = await desktop.upload(mp4, 'video/mp4'); assert.equal(r.status, 201)
  const { url } = await r.json(); assert.ok(url.startsWith(hosted.base + '/image-tasks/media-references/'))
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), mp4)
  assert.equal(desktop.authHeaders.length, 0); assert.equal(hosted.authHeaders.length, 1)
})
test('鉴权、真实格式和大小校验失败不留下文件', async () => {
  const f = await fixture({ maxFileBytes: 1024 })
  assert.equal((await f.upload(png, 'image/png', { Authorization: 'Bearer invalid' })).status, 401)
  assert.equal((await f.upload(Buffer.from('<svg onload="alert(1)"></svg>'))).status, 400)
  assert.equal((await f.upload(wav, 'image/png')).status, 400)
  assert.equal((await f.upload(Buffer.alloc(2048))).status, 413)
  assert.deepEqual(await fs.readdir(path.join(f.dir, 'media-references')), [])
  assert.equal((await f.upload(png)).status, 201)
})
test('存储容量及每令牌限额独立生效，拒绝后能继续处理合法上传', async () => {
  const f = await fixture({ maxFileBytes: png.length, maxStoreBytes: png.length * 2, maxOwnerBytes: png.length })
  assert.equal((await f.upload(png)).status, 201)
  assert.equal((await f.upload(png)).status, 429)
  const capped = await fixture({ maxFileBytes: png.length, maxStoreBytes: png.length })
  assert.equal((await capped.upload(png)).status, 201)
  assert.equal((await capped.upload(png)).status, 503)
})
test('重启重建文件索引，过期清理素材，不创建生成请求', async () => {
  const f = await fixture({ ttlMs: 200 })
  const { url } = await (await f.upload(png)).json()
  const restarted = await fixture({ storageDirectory: f.dir })
  assert.equal((await fetch(restarted.base + new URL(url).pathname)).status, 200)
  await new Promise(r => setTimeout(r, 220))
  assert.equal((await fetch(url)).status, 410)
  await f.service.cleanup()
  assert.deepEqual(await fs.readdir(path.join(f.dir, 'media-references')), [])
  assert.equal(f.authHeaders.length, 1)
})
