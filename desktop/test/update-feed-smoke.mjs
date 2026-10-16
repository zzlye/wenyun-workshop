import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire('D:/tools/playwright/package.json');
const { _electron } = require('playwright');
const build = JSON.parse(await fs.readFile('D:/tmp/wenyun-desktop/latest-build.json', 'utf8'));
const testRoot = await fs.mkdtemp('D:/tmp/wenyun-desktop/update-feed-');
const env = { ...process.env, WENYUN_DESKTOP_PROFILE: path.join(testRoot, 'profile'), WENYUN_DESKTOP_DATA_HOME: path.join(testRoot, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
let instance;

try {
  instance = await _electron.launch({ executablePath: path.join(build.output, 'win-unpacked/Wenyun.exe'), env, timeout: 60_000 });
  const page = await instance.firstWindow();
  await page.getByRole('button', { name: '画布工坊', exact: true }).waitFor({ timeout: 30_000 });
  await instance.evaluate(({ app, dialog }, cachePath) => {
    const { createRequire } = process.mainModule.require('node:module');
    const { join } = process.mainModule.require('node:path');
    const require = createRequire(join(app.getAppPath(), 'package.json'));
    const engine = require('electron-updater').autoUpdater;
    globalThis.updateFeedQA = { messages: [], errors: [], downloaded: null, installCalls: 0, progress: 0 };
    globalThis.updateFeedEngine = engine;
    // 检查正式发布源，但缓存、版本模拟和弹窗回答仅发生在独立测试进程。
    Object.defineProperty(engine.app, 'baseCachePath', { get: () => cachePath });
    engine.disableDifferentialDownload = true;
    dialog.showMessageBox = async (_window, options) => {
      globalThis.updateFeedQA.messages.push(options.message);
      return { response: options.buttons?.[0] === '下载更新' ? 0 : (options.cancelId ?? 0) };
    };
    engine.quitAndInstall = () => { globalThis.updateFeedQA.installCalls++; throw new Error('测试不能执行安装'); };
    engine.on('error', error => globalThis.updateFeedQA.errors.push(error.message));
    engine.on('download-progress', progress => { globalThis.updateFeedQA.progress = progress.percent; });
    engine.on('update-downloaded', info => { globalThis.updateFeedQA.downloaded = { version: info.version, file: info.downloadedFile, sha512: info.sha512 || info.files?.[0]?.sha512 }; });
  }, path.join(testRoot, 'cache'));

  await page.evaluate(() => window.wenyunDesktop.checkForUpdates());
  const current = await instance.evaluate(() => globalThis.updateFeedQA);
  assert.deepEqual(current.errors, []);
  assert.ok(current.messages.includes('当前已是最新版本'));
  console.log('正式版本检查在线更新源：通过，当前版本不会重复升级');

  await instance.evaluate(() => {
    const engine = globalThis.updateFeedEngine;
    // 只模拟测试进程的旧版本，不修改安装包或线上清单，避免给客户推送假版本。
    engine.currentVersion = new engine.currentVersion.constructor('0.0.0');
  });
  await page.evaluate(() => window.wenyunDesktop.checkForUpdates());
  let state;
  let reported = -1;
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    state = await instance.evaluate(() => globalThis.updateFeedQA);
    assert.deepEqual(state.errors, []);
    if (state.downloaded && state.messages.some(message => message.startsWith('更新已下载'))) break;
    const progress = Math.floor(state.progress / 20) * 20;
    if (progress > reported) { console.log(`在线下载安装包：${progress}%`); reported = progress; }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  assert.ok(state?.downloaded, '正式更新源下载未完成');
  assert.ok(state.messages.some(message => message.startsWith('发现新版本')));
  assert.ok(state.messages.some(message => message.startsWith('更新已下载')));
  assert.equal(state.installCalls, 0);
  assert.equal(state.downloaded.version, build.version);
  const downloadPath = path.resolve(state.downloaded.file);
  assert.ok(downloadPath.toLowerCase().startsWith(path.resolve(testRoot).toLowerCase() + path.sep));
  const bytes = await fs.readFile(downloadPath);
  assert.equal(createHash('sha512').update(bytes).digest('base64'), state.downloaded.sha512);
  const original = await fs.readFile(path.join(build.output, `Wenyun-${build.version}-Setup-x64.exe`));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), createHash('sha256').update(original).digest('hex'));
  await fs.writeFile(path.join(testRoot, 'verification.json'), JSON.stringify({ ...state, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2));
  console.log('弹窗提醒、在线完整下载、安装确认和文件校验：全部通过，未执行安装');
  console.log(`验证记录：${testRoot}`);
} finally {
  if (instance) {
    const closed = instance.waitForEvent('close', { timeout: 30_000 });
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
  }
}
