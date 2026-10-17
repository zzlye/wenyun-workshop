import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('D:/tools/playwright/package.json');
const { _electron } = require('playwright');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const buildInfo = process.argv.find(argument => argument.startsWith('--build-info='))?.slice('--build-info='.length) || 'D:/tmp/wenyun-desktop/latest-build.json';
const build = JSON.parse(await fs.readFile(buildInfo, 'utf8'));
const root = await fs.mkdtemp('D:/tmp/wenyun-desktop/submission-proxy-');
const sourceMode = process.argv.includes('--source');
const expectedFailure = process.argv.includes('--expect-blocked');
const proxyRequests = [];

// 模拟会拦截本机上传的系统代理，所有上游生成都在隔离测试进程中返回固定图片。
const proxy = http.createServer((req, res) => {
  const url = new URL(req.url);
  proxyRequests.push({ method: req.method, path: url.pathname });
  if (url.hostname !== '127.0.0.1' || req.method === 'POST') {
    res.writeHead(502); res.end('fixture proxy rejected upload'); return;
  }
  const forward = http.request(url, { method: req.method, headers: req.headers }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  forward.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(forward);
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, WENYUN_DESKTOP_PROFILE: path.join(root, 'profile'), WENYUN_DESKTOP_DATA_HOME: path.join(root, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
if (sourceMode) env.WENYUN_DESKTOP_WEB_ROOT = path.join(build.appRoot, 'web');
let app;
try {
  app = await _electron.launch({
    executablePath: sourceMode ? 'D:/tools/wenyun-desktop-toolchain/node_modules/electron/dist/electron.exe' : path.join(build.output, 'win-unpacked/Wenyun.exe'),
    args: sourceMode ? [path.join(repo, 'desktop')] : [], env,
  });
  const page = await app.firstWindow();
  const referencePolicyErrors = [];
  page.on('console', message => {
    if (message.type() === 'error' && /data:image/.test(message.text()) && /Content Security Policy/.test(message.text())) referencePolicyErrors.push('参考图读取被安全策略拦截');
  });
  await page.getByRole('button', { name: '画布工坊', exact: true }).waitFor();
  await page.addLocatorHandler(page.getByRole('button', { name: '今日不再提醒', exact: true }), button => button.click());
  await app.evaluate(() => {
    const original = globalThis.fetch;
    globalThis.submitFixture = { posts: [], gets: 0, references: [] };
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname !== 'api.xn--v5z30ywuk.com' || !url.pathname.startsWith('/v1/')) return original(input, init);
      if (init?.method === 'POST') {
        globalThis.submitFixture.posts.push(url.pathname);
        if (url.pathname.endsWith('/edits')) {
          const form = await new Response(init.body, { headers: init.headers }).formData();
          const image = form.get('image') || form.get('image[]');
          globalThis.submitFixture.references.push({ size: image?.size, type: image?.type });
        }
        return Response.json({ task_id: 'async_local_ui', status: 'pending' }, { status: 202 });
      }
      if (url.pathname === '/v1/tasks/async_local_ui') {
        globalThis.submitFixture.gets++;
        return Response.json({ task_id: 'async_local_ui', status: 'succeeded', response_status_code: 200, result: { data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }] } });
      }
      throw Error('测试禁止未声明的远端请求');
    };
  });
  await page.evaluate(async () => {
    const module = await import(document.querySelector('script[type="module"][src]').getAttribute('src'));
    window.submitTestStore = Object.values(module).find(value => value?.getState?.().tasks && value?.getState?.().settings);
    const state = window.submitTestStore.getState();
    window.submitTestStore.setState({ settings: { ...state.settings, apiKey: 'fixture-key', profiles: state.settings.profiles.map(profile => ({ ...profile, apiKey: 'fixture-key' })) } });
  });
  await app.evaluate(async ({ session }, port) => {
    await session.defaultSession.setProxy({ proxyRules: `http=127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
    await session.defaultSession.closeAllConnections();
  }, proxy.address().port);
  const outcomes = [];
  let referenceBytes = 0;
  for (const edit of [false, true]) {
    if (edit) {
      const dataUrl = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const context = canvas.getContext('2d'); context.fillStyle = '#2783ed'; context.fillRect(0, 0, 64, 64);
        return canvas.toDataURL();
      });
      const referenceBuffer = Buffer.from(dataUrl.split(',')[1], 'base64');
      referenceBytes = referenceBuffer.length;
      await page.locator('input[type="file"][accept="image/*"][multiple]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: referenceBuffer });
      await page.waitForFunction(() => window.submitTestStore.getState().inputImages.length === 1);
    }
    const previous = await page.evaluate(() => window.submitTestStore.getState().tasks.map(task => task.id));
    await page.evaluate(edit => window.submitTestStore.getState().setPrompt(edit ? '本机图生图验证' : '本机文生图验证'), edit);
    await page.getByRole('button', { name: '生成图像', exact: true }).click();
    await page.waitForFunction(previous => window.submitTestStore.getState().tasks.some(task => !previous.includes(task.id) && ['done', 'error'].includes(task.status)), previous, { timeout: 30000 });
    const outcome = await page.evaluate(previous => {
      const task = window.submitTestStore.getState().tasks.find(task => !previous.includes(task.id));
      return { status: task.status, error: task.error, hasId: !!task.imageTaskId };
    }, previous);
    outcomes.push(outcome);
    assert.equal(outcome.status, expectedFailure ? 'error' : 'done', JSON.stringify({ edit, outcome, upstream: await app.evaluate(() => globalThis.submitFixture), proxyRequests }));
    if (expectedFailure) assert.match(outcome.error, /未找到已受理任务/);
    else assert.equal(outcome.hasId, true);
    // 新任务完成后会自动打开详情，先关闭浮层再执行下一次真实按钮点击。
    await page.keyboard.press('Escape');
    await page.locator('.workshop-detail-overlay').waitFor({ state: 'hidden' });
  }
  const upstream = await app.evaluate(() => globalThis.submitFixture);
  assert.deepEqual(upstream.posts, expectedFailure ? [] : ['/v1/images/generations', '/v1/images/edits']);
  if (!expectedFailure) {
    assert.equal(proxyRequests.filter(request => request.path.startsWith('/image-tasks')).length, 0);
    assert.deepEqual(upstream.references, [{ size: referenceBytes, type: 'image/png' }]);
    assert.deepEqual(referencePolicyErrors, []);
  }
  const report = { version: await page.evaluate(async () => (await window.wenyunDesktop.info()).version), expectedFailure, outcomes, upstream, proxyRequests, referencePolicyErrors };
  await fs.writeFile(path.join(root, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  console.log(`桌面提交对照完成：${root}`);
} finally {
  if (app) await app.close();
  proxy.closeAllConnections();
  await new Promise(resolve => proxy.close(resolve));
}
