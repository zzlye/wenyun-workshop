const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDesktopUpdater, UPDATE_FEED } = require('../updates.cjs');

test('桌面更新固定 HTTPS 发布源，下载和安装必须分别确认', async () => {
  const engine = new EventEmitter();
  let feed, downloads = 0, installs = 0, checks = 0;
  engine.setFeedURL = value => { feed = value; };
  engine.checkForUpdates = async () => { checks++; };
  engine.downloadUpdate = async () => { downloads++; };
  engine.quitAndInstall = () => { installs++; };
  const answers = [1, 0, 1, 0];
  const messages = [];
  const updater = createDesktopUpdater({ autoUpdater: engine, enabled: true, getWindow: () => ({}),
    dialog: { showMessageBox: async (_window, value) => { messages.push(value); return { response: answers.shift() }; } },
    install: async action => action(),
  });
  try {
    assert.equal(feed.url, UPDATE_FEED);
    assert.ok(UPDATE_FEED.startsWith('https://'));
    assert.equal(engine.autoDownload, false);
    assert.equal(engine.autoInstallOnAppQuit, false);
    assert.equal(engine.allowDowngrade, false);
    engine.emit('update-available', { version: '0.4.14' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(downloads, 0);
    engine.emit('update-available', { version: '0.4.14' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(downloads, 1);
    engine.emit('update-downloaded');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(installs, 0);
    await updater.check(true);
    assert.equal(installs, 1);
    assert.equal(checks, 0);
  } finally { updater.dispose(); }
});

test('后台检查失败不弹窗，不退出程序', async () => {
  const engine = new EventEmitter();
  engine.setFeedURL = () => {};
  engine.checkForUpdates = async () => { engine.emit('error', new Error('offline')); throw new Error('offline'); };
  let messages = 0;
  const updater = createDesktopUpdater({ autoUpdater: engine, enabled: true, getWindow: () => ({}), dialog: { showMessageBox: async () => { messages++; return { response: 0 }; } }, install: () => { throw new Error('不能安装'); } });
  try {
    await updater.check();
    assert.equal(messages, 0);
    await updater.check(true);
    assert.equal(messages, 1);
  } finally { updater.dispose(); }
});

test('重复更新事件只弹一次提示，退出后不继续下载', async () => {
  const engine = new EventEmitter();
  engine.setFeedURL = () => {};
  let resolveDialog, messages = 0, downloads = 0;
  engine.downloadUpdate = async () => { downloads++; };
  const updater = createDesktopUpdater({ autoUpdater: engine, enabled: true, getWindow: () => ({}),
    dialog: { showMessageBox: () => { messages++; return new Promise(resolve => { resolveDialog = resolve; }); } }, install: () => {},
  });
  engine.emit('update-available', { version: '0.4.14' });
  engine.emit('update-available', { version: '0.4.14' });
  assert.equal(messages, 1);
  updater.dispose();
  resolveDialog({ response: 0 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(downloads, 0);
  engine.emit('update-downloaded');
  assert.equal(messages, 1);
});
