import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('D:/tools/playwright/package.json');
const { _electron } = require('playwright');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const build = JSON.parse(await fs.readFile('D:/tmp/wenyun-desktop/latest-build.json', 'utf8'));
const testRoot = await fs.mkdtemp('D:/tmp/wenyun-desktop/smoke-');
const sourceMode = process.argv.includes('--source');
const executablePath = sourceMode ? 'D:/tools/wenyun-desktop-toolchain/node_modules/electron/dist/electron.exe' : path.join(build.output, 'win-unpacked/Wenyun.exe');
const env = { ...process.env, WENYUN_DESKTOP_PROFILE: path.join(testRoot, 'profile'), WENYUN_DESKTOP_DATA_HOME: path.join(testRoot, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
if (sourceMode) env.WENYUN_DESKTOP_WEB_ROOT = 'D:/tmp/wenyun-desktop/web-qa';
const errors = [];
let app;
let page;
const server = http.createServer(async (request, response) => {
  if (request.url === '/range') {
    response.writeHead(206, { 'content-type': 'video/mp4', 'content-range': 'bytes 0-2/6' });
    response.end(Buffer.from([1, 2, 3]));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString() }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

async function launch() {
  app = await _electron.launch({ executablePath, args: sourceMode ? [path.join(repo, 'desktop')] : [], env, timeout: 60_000 });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '画布工坊', exact: true }).waitFor({ timeout: 30_000 });
  const dismiss = page.getByRole('button', { name: '今日不再提醒', exact: true });
  // 公告可能在首页加载后才出现，操作前统一关闭，避免遮罩造成随机超时。
  await page.addLocatorHandler(dismiss, async (button) => { await button.click(); });
}

async function close() {
  if (!app) return;
  const current = app;
  // 先监听退出事件，避免在进程已经退出后再次调用 close 导致测试空等。
  const closed = current.waitForEvent('close', { timeout: 30_000 });
  await current.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await closed;
  app = null;
}

try {
  await launch();
  console.log('首次启动：通过');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal((await page.evaluate(() => window.wenyunDesktop.info())).version, '0.4.13');
  const echo = await page.evaluate(async (port) => {
    const response = await fetch(`/desktop-api/http/127.0.0.1:${port}/v1/images/generations`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer smoke-test-only' }, body: JSON.stringify({ model: 'mock-image', quality: 'high', background: 'transparent', size: '4096x4096', response_format: 'url' }) });
    return response.json();
  }, server.address().port);
  assert.deepEqual(JSON.parse(echo.body), { model: 'mock-image', quality: 'high', background: 'transparent', size: '4096x4096', response_format: 'url' });
  assert.equal(echo.headers.authorization, 'Bearer smoke-test-only');
  const ranged = await page.evaluate(async (port) => {
    const response = await fetch(`/asset-proxy/http/127.0.0.1:${port}/range`, { headers: { Range: 'bytes=0-2' } });
    return { status: response.status, range: response.headers.get('content-range'), bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  }, server.address().port);
  assert.deepEqual(ranged, { status: 206, range: 'bytes 0-2/6', bytes: [1, 2, 3] });
  console.log('本机接口完整传参及视频分段读取：通过（仅请求本机模拟接口）');
  await page.evaluate(async (port) => {
    await window.wenyunDesktop.openPayment({ kind: 'form', url: `http://127.0.0.1:${port}/mock-payment`, fields: { order: 'test-only-not-a-real-order' } });
  }, server.address().port);
  const paymentWindow = app.windows().find((item) => item !== page);
  assert.ok(paymentWindow);
  assert.equal(await paymentWindow.evaluate(() => typeof window.wenyunDesktop), 'undefined');
  assert.equal(await paymentWindow.evaluate(() => typeof window.require), 'undefined');
  await paymentWindow.close();
  console.log('支付窗口与本地数据权限隔离：通过（未创建真实订单）');

  await page.getByRole('button', { name: '画布工坊', exact: true }).click();
  await page.getByRole('button', { name: '新建画布', exact: true }).first().click();
  await page.getByRole('button', { name: '上传媒体', exact: true }).waitFor();
  const canvasUrl = page.url();
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 384; canvas.height = 256;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2783ed'; context.fillRect(80, 48, 224, 160);
    context.fillStyle = 'rgba(222,159,29,0.5)'; context.fillRect(16, 32, 112, 144);
    return canvas.toDataURL('image/png');
  });
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '上传媒体', exact: true }).click();
  await (await picker).setFiles({ name: '桌面透明测试.png', mimeType: 'image/png', buffer: bytes });
  await page.waitForFunction(() => [...document.images].some((image) => image.naturalWidth === 384));
  const filenames = await fs.readdir(path.join(testRoot, 'data/图片/画布'));
  assert.deepEqual(await fs.readFile(path.join(testRoot, 'data/图片/画布', filenames[0])), bytes);
  console.log('界面导入透明 PNG，原始文件字节保持一致：通过');

  const movedDirectory = path.join(testRoot, 'moved-data');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '数据管理', exact: true }).click();
  await app.evaluate(({ dialog }) => {
    globalThis.directoryDialogs = { open: dialog.showOpenDialog, message: dialog.showMessageBox };
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await page.getByRole('button', { name: '更换位置', exact: true }).click();
  await page.getByRole('button', { name: '更换位置', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.wenyunDesktop.info())).dataDirectory, path.join(testRoot, 'data'));
  await app.evaluate(({ dialog }, destination) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] });
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  }, movedDirectory);
  await page.getByRole('button', { name: '更换位置', exact: true }).click();
  await page.getByText(movedDirectory, { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.wenyunDesktop.info())).dataDirectory, movedDirectory);
  assert.deepEqual(await fs.readFile(path.join(movedDirectory, '图片/画布', filenames[0])), bytes);
  assert.deepEqual(await fs.readFile(path.join(testRoot, 'data/图片/画布', filenames[0])), bytes);
  await page.screenshot({ path: path.join(testRoot, 'storage-directory.png') });
  const occupied = path.join(testRoot, 'occupied');
  await fs.mkdir(occupied);
  await fs.writeFile(path.join(occupied, 'keep.txt'), '已有文件');
  await app.evaluate(({ dialog }, destination) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] }); }, occupied);
  await page.getByRole('button', { name: '更换位置', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '请选择空文件夹' }).waitFor();
  assert.equal((await page.evaluate(() => window.wenyunDesktop.info())).dataDirectory, movedDirectory);
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = globalThis.directoryDialogs.open;
    dialog.showMessageBox = globalThis.directoryDialogs.message;
  });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  console.log('设置中取消、更换、原图迁移和非空目录保护：通过');

  await page.getByRole('button', { name: '打开 Canvas Agent', exact: true }).click();
  await page.getByRole('button', { name: '连接设置，当前已连接' }).waitFor({ timeout: 45_000 });
  const agentUrl = await page.evaluate(async () => (await window.wenyunDesktop.agent.ensure()).url);
  assert.equal(await page.getByLabel('Agent 连接令牌', { exact: true }).count(), 0);
  await page.screenshot({ path: path.join(testRoot, 'agent-connected.png') });
  console.log('内置 Agent 自动启动连接，无需填写令牌：通过');

  await page.evaluate(async () => {
    await window.wenyunDesktop.storage.put('settings', 'smoke-encryption', '仅用于本地验证的值');
    await window.wenyunDesktop.storage.flush();
  });
  await app.evaluate(async ({ session }) => { await session.defaultSession.clearStorageData(); });
  const encrypted = await fs.readFile(path.join(testRoot, 'profile/settings.enc'));
  assert.ok(!encrypted.toString('utf8').includes('仅用于本地验证的值'));
  assert.equal(await page.evaluate(() => localStorage.getItem('gpt-image-playground')), null);
  console.log('系统加密配置，应用数据不依赖浏览器 localStorage：通过');
  await page.evaluate(async () => {
    try { await window.wenyunDesktop.storage.put('canvas-images', 'smoke-failed-write', { invalid: true }); } catch { /* 主动制造一次保存失败，验证退出保护。 */ }
  });
  await app.evaluate(({ dialog }) => {
    globalThis.smokeDialogs = [];
    globalThis.smokeOriginalDialog = dialog.showMessageBox;
    dialog.showMessageBox = async (_window, options) => { globalThis.smokeDialogs.push(options.message); return { response: 0, checkboxChecked: false }; };
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !(await app.evaluate(() => globalThis.smokeDialogs.length))) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await app.evaluate(() => globalThis.smokeDialogs))[0], '有数据尚未保存，仍要退出吗？');
  assert.ok(!page.isClosed());
  await page.evaluate(() => window.wenyunDesktop.storage.remove('canvas-images', 'smoke-failed-write'));
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = globalThis.smokeOriginalDialog; });
  console.log('保存失败时阻止直接退出，取消退出后仍可继续工作：通过');
  await close();
  const stopped = await fetch(`${agentUrl}/health`, { signal: AbortSignal.timeout(1500) }).then(() => false).catch(() => true);
  assert.ok(stopped);
  console.log('正常退出时保存画布并停止内置 Agent：通过');

  await launch();
  assert.equal((await page.evaluate(() => window.wenyunDesktop.info())).dataDirectory, movedDirectory);
  await page.goto(canvasUrl);
  await page.waitForFunction(() => [...document.images].some((image) => image.naturalWidth === 384));
  const alpha = await page.evaluate(async () => {
    const key = (await window.wenyunDesktop.storage.keys('canvas-images'))[0];
    const stored = await window.wenyunDesktop.storage.get('canvas-images', key);
    const bitmap = await createImageBitmap(new Blob([stored.bytes], { type: stored.mimeType }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
    return [context.getImageData(0, 0, 1, 1).data[3], context.getImageData(20, 40, 1, 1).data[3], context.getImageData(150, 100, 1, 1).data[3]];
  });
  assert.deepEqual(alpha, [0, 128, 255]);
  assert.equal(await page.evaluate(() => window.wenyunDesktop.storage.get('settings', 'smoke-encryption')), '仅用于本地验证的值');
  await page.screenshot({ path: path.join(testRoot, 'restarted-canvas.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 720));
  await page.screenshot({ path: path.join(testRoot, 'canvas-960.png') });
  assert.deepEqual(errors, []);
  await close();
  console.log('重启后画布、原图、透明通道和加密配置恢复：通过');
  console.log(`桌面验证完成：${testRoot}`);
} finally {
  if (app) {
    // 验证失败时只关闭本轮应用，绝不终止用户原来运行的画布助手。
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => undefined);
    await close().catch(() => undefined);
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
