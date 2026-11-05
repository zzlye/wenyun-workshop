import assert from 'node:assert/strict'
import { createServer, get } from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, test } from 'node:test'
import { createImageTaskServer } from './image-tasks.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
const inline = `data:image/png;base64,${png.toString('base64')}`
const resources = [], directories = []
afterEach(async () => {
  for (const server of resources.reverse().splice(0)) await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})
async function listen(server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); resources.push(server)
  return `http://127.0.0.1:${server.address().port}`
}
async function directory() {
  const value = await fs.mkdtemp(path.join(process.platform === 'win32' ? 'D:/tmp' : tmpdir(), 'wenyun-mj-test-'))
  directories.push(value); return value
}
function freshGet(url) {
  // 重启测试使用新连接，避免测试进程复用已被旧服务关闭的空闲连接。
  return new Promise((resolve,reject)=>get(url,{agent:false},response=>{
    const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject)
    response.on('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks)}))
  }).on('error',reject))
}
async function fixture(options = {}) {
  let submissions = 0, received, validationHeaders
  const upstream = await listen(createServer(async (req, res) => {
    if (req.url === '/v1/models') {
      validationHeaders = req.headers
      res.writeHead(req.headers.authorization === 'Bearer fixture-key' ? 200 : 401, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: [] }))
    }
    submissions++
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    received = JSON.parse(Buffer.concat(chunks))
    if (JSON.stringify(received).includes('data:image/')) {
      res.writeHead(400); return res.end(JSON.stringify({ error: { code: 'invalid_reference_image', message: '参考图只支持公网 HTTP(S) 图片链接，不支持内联 Base64 图片数据' } }))
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ status: 'completed', data: { image_urls: ['https://example.com/result.png'] } }))
  }))
  const storageDirectory = options.storageDirectory ?? await directory()
  // 先占用随机本机端口，再把可公开访问地址交给服务；测试不依赖公网或收费模型。
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening')
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve))
  const base = `http://127.0.0.1:${port}`
  const server = createImageTaskServer({ upstreamBaseUrl: upstream+'/v1', storageDirectory, referencePublicBaseUrl: base, logger: () => {}, ...options })
  server.listen(port, '127.0.0.1'); await once(server, 'listening'); resources.push(server)
  return { base, upstream, storageDirectory, server, submissions: () => submissions, received: () => received, validationHeaders: () => validationHeaders }
}
async function submit(base, body, key = 'fixture-key') {
  const r = await fetch(base+'/image-tasks?endpoint=/midjourney/generations', { method: 'POST', headers: { Authorization: 'Bearer '+key, 'Content-Type': 'application/json', 'X-Wenyun-Task-Client-Version': '2', 'X-Wenyun-Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) })
  assert.equal(r.status,202)
  const task = await r.json()
  for (let n=0;n<100;n++) {
    const status = await (await fetch(base+'/image-tasks/'+task.taskId, { headers: { Authorization: 'Bearer '+task.accessToken } })).json()
    if (['succeeded','failed'].includes(status.status)) return { task, status, result: await fetch(base+'/image-tasks/'+task.taskId+'/result', { headers: { Authorization: 'Bearer '+task.accessToken } }) }
    await new Promise(resolve => setTimeout(resolve,10))
  }
  throw new Error('任务未结束')
}

test('MJ 内联参考图先转成公开链接，上游能匿名读取原字节且多图顺序不变', async () => {
  const f = await fixture()
  const original = 'https://example.com/reference.jpg?signature=keep%2Bme'
  const task = await submit(f.base, { model:'mj-v8.2', prompt:'参考图', images:[original, inline, inline], n:1, iw:0 })
  assert.equal(task.result.status,200,await task.result.clone().text())
  assert.equal(f.submissions(),1)
  const body=f.received(); assert.equal(body.images[0],original); assert.equal(body.iw,0)
  assert.match(body.images[1],/^http:\/\//); assert.equal(body.images[1],body.images[2]); assert.ok(!body.images[1].includes('fixture-key'))
  const image=await fetch(body.images[1]); assert.equal(image.status,200); assert.equal(image.headers.get('content-type'),'image/png')
  assert.deepEqual(Buffer.from(await image.arrayBuffer()),png)
})

test('桌面本机任务把参考图上传到公网服务，不能把 localhost 地址交给上游', async () => {
  const hosted=await fixture()
  const local=await fixture({ referencePublicBaseUrl:'', referenceUploadUrl:hosted.base+'/image-tasks/reference-uploads' })
  const task=await submit(local.base,{model:'mj-v8.2',prompt:'桌面参考图',image:inline})
  assert.equal(task.result.status,200,await task.result.clone().text())
  assert.ok(local.received().image.startsWith(hosted.base+'/image-tasks/references/'))
  assert.deepEqual(Buffer.from(await (await fetch(local.received().image)).arrayBuffer()),png)
  assert.equal(hosted.submissions(),0)
})

test('无效 Key 或非图片上传不能落盘，也不能发起付费生成',async()=>{
  const f=await fixture()
  for(const [key,bytes,status] of [['invalid',png,401],['fixture-key',Buffer.from('<html>不是图片</html>'),400]]) {
    const r=await fetch(f.base+'/image-tasks/reference-uploads',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'image/png'},body:bytes})
    assert.equal(r.status,status)
  }
  const task=await submit(f.base,{model:'mj-v8.2',prompt:'参考图',image:inline},'invalid')
  assert.equal(task.status.status,'failed'); assert.equal(f.submissions(),0)
})

test('未配置托管时内联参考图失败在提交之前，公网地址仍可提交',async()=>{
  const f=await fixture({referencePublicBaseUrl:''})
  const failed=await submit(f.base,{model:'mj-v8.2',prompt:'参考图',image:inline})
  assert.equal(failed.status.status,'failed'); assert.equal(f.submissions(),0)
  const ok=await submit(f.base,{model:'mj-v8.2',prompt:'参考图',image:'https://example.com/ref.png'})
  assert.equal(ok.result.status,200); assert.equal(f.submissions(),1)
})

test('临时参考图重启后可读取，过期和容量限制生效，匿名上传不能获得链接',async()=>{
  const f=await fixture({referenceTtlMs:1000,referenceMaxStoreBytes:png.length})
  const upload=()=>fetch(f.base+'/image-tasks/reference-uploads',{method:'POST',headers:{Authorization:'Bearer fixture-key'},body:png})
  const first=await upload(); assert.equal(first.status,201)
  const {url}=await first.json()
  assert.equal((await upload()).status,503)
  assert.equal((await fetch(f.base+'/image-tasks/reference-uploads',{method:'POST',body:png})).status,401)
  const head=await fetch(url,{method:'HEAD',headers:{Connection:'close'}});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(png.length))
  // 重启服务只重建索引，公开链接和字节不变，不依赖进程内缓存。
  const port=new URL(f.base).port
  resources.splice(resources.indexOf(f.server),1)
  await new Promise(resolve=>{f.server.close(resolve);f.server.closeAllConnections()})
  const restarted=createImageTaskServer({upstreamBaseUrl:f.upstream+'/v1',storageDirectory:f.storageDirectory,referencePublicBaseUrl:f.base,logger:()=>{}})
  restarted.listen(Number(port),'127.0.0.1');await once(restarted,'listening');resources.push(restarted)
  const restored=await freshGet(url);assert.equal(restored.status,200);assert.deepEqual(restored.body,png)
  const name=new URL(url).pathname.split('/').pop()
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(name.split('-')[0])-Date.now()+20)))
  assert.ok([404,410].includes((await freshGet(url)).status))
  for(let i=0;i<20 && (await fs.readdir(path.join(f.storageDirectory,'references'))).length;i++) await new Promise(resolve=>setTimeout(resolve,10))
  assert.deepEqual(await fs.readdir(path.join(f.storageDirectory,'references')),[])
})

test('无效或超量参考图在提交前失败，模板没有参考图时不访问托管接口',async()=>{
  const f=await fixture()
  for(const refs of [Array(6).fill(inline),['data:image/png;base64,PGh0bWw+'],['file:///private.png']]) {
    const result=await submit(f.base,{model:'mj-v8.2',prompt:'参考图',images:refs})
    assert.equal(result.status.status,'failed')
  }
  assert.equal(f.submissions(),0)
  const ok=await submit(f.base,{model:'mj-v8.2',prompt:'文生图'})
  assert.equal(ok.result.status,200);assert.equal(f.submissions(),1)
})

test('上传鉴权保留真实客户端 IP，配置 IP 白名单的 Key 与生成请求行为一致',async()=>{
  const f=await fixture()
  const response=await fetch(f.base+'/image-tasks/reference-uploads',{method:'POST',headers:{Authorization:'Bearer fixture-key','X-Real-IP':'203.0.113.8','X-Forwarded-For':'203.0.113.8, 172.19.0.2',Cookie:'must-not-forward'},body:png})
  assert.equal(response.status,201)
  assert.equal(f.validationHeaders()['x-real-ip'],'203.0.113.8')
  assert.equal(f.validationHeaders()['x-forwarded-for'],'203.0.113.8, 172.19.0.2')
  assert.equal(f.validationHeaders().cookie,undefined)
})
