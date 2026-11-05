import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const { _electron } = createRequire('D:/tools/playwright/package.json')('playwright');
const build = JSON.parse(await fs.readFile('D:/tmp/wenyun-desktop/latest-build.json', 'utf8'));
const root = await fs.mkdtemp('D:/tmp/wenyun-desktop/mj-reference-');
const env = { ...process.env, WENYUN_DESKTOP_PROFILE: path.join(root, 'profile'), WENYUN_DESKTOP_DATA_HOME: path.join(root, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await _electron.launch({ executablePath: path.join(build.output, 'win-unpacked/Wenyun.exe'), env, timeout: 60_000 });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '画布工坊', exact: true }).waitFor({ timeout: 30_000 });
  // 只在独立测试进程拦截上传与生成，验证真实安装包，不访问付费模型。
  await app.evaluate(() => {
    const original = globalThis.fetch;
    globalThis.mjCheck = { uploads: 0, generations: 0, bytes: 0, payload: null };
    const publicUrl = `https://xn--v5z30ywuk.com/image-tasks/references/${Date.now()+86400000}-${'a'.repeat(48)}.png`;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'xn--v5z30ywuk.com' && url.pathname === '/image-tasks/reference-uploads') {
        if (new Headers(init.headers).get('authorization') !== 'Bearer mj-smoke-only') throw new Error('上传鉴权不一致');
        globalThis.mjCheck.uploads++;
        globalThis.mjCheck.bytes = init.body.byteLength;
        return new Response(JSON.stringify({ url: publicUrl }), { status: 201, headers: { 'content-type': 'application/json' } });
      }
      if (url.hostname === 'api.xn--v5z30ywuk.com' && url.pathname === '/v1/midjourney/generations') {
        const payload = JSON.parse(init.body.toString());
        if (payload.image !== publicUrl || payload.image.includes('data:')) throw new Error('生成请求没有使用公网参考图');
        globalThis.mjCheck.generations++; globalThis.mjCheck.payload = payload;
        return new Response(JSON.stringify({ status: 'completed', data: { image_urls: ['https://example.com/result.png'] } }), { headers: { 'content-type': 'application/json' } });
      }
      return original(input, init);
    };
  });
  const result = await page.evaluate(async () => {
    const request = { method: 'POST', headers: { Authorization: 'Bearer mj-smoke-only', 'Content-Type': 'application/json', 'X-Wenyun-Task-Client-Version': '2', 'X-Wenyun-Idempotency-Key': 'mj-reference-once' }, body: JSON.stringify({ model: 'mj-v8.2', prompt: '参考图测试', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', n: 1 }) };
    const response = await fetch('/image-tasks?endpoint=/midjourney/generations', request);
    if (response.status !== 202) throw new Error('任务受理失败');
    const task = await response.json();
    for (let n=0;n<100;n++) {
      const status = await (await fetch('/image-tasks/'+task.taskId, { headers: { Authorization: 'Bearer '+task.accessToken } })).json();
      if (status.status === 'failed') throw new Error(status.error.message);
      if (status.status === 'succeeded') {
        const result = await (await fetch('/image-tasks/'+task.taskId+'/result', { headers: { Authorization: 'Bearer '+task.accessToken } })).json();
        const reused = await (await fetch('/image-tasks?endpoint=/midjourney/generations', request)).json();
        return { result, reused: reused.reused, sameTask: reused.taskId === task.taskId };
      }
      await new Promise(resolve => setTimeout(resolve,50));
    }
    throw new Error('任务没有结束');
  });
  const counts = await app.evaluate(() => globalThis.mjCheck);
  assert.equal(counts.uploads, 1); assert.equal(counts.generations, 1); assert.ok(counts.bytes > 0);
  assert.equal(result.reused, true); assert.equal(result.sameTask, true);
  assert.deepEqual(result.result.data.image_urls, ['https://example.com/result.png']);
  await fs.writeFile(path.join(root, 'verification.json'), JSON.stringify({ version: build.version, counts, result }, null, 2));
  console.log('桌面安装包 MJ 参考图上传、转换、结果读取和提交防重：通过');
  console.log(`验证记录：${root}`);
} finally {
  if (app) {
    const closed = app.waitForEvent('close', { timeout: 30_000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
  }
}
