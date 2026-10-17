const { app, BrowserWindow, Menu, protocol, net, session, ipcMain, shell, dialog, safeStorage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createDesktopUpdater } = require('./updates.cjs');
const { DiskStore } = require('./storage.cjs');
const { DataDirectoryManager } = require('./data-directory.cjs');
const { AgentRuntime } = require('./agent-runtime.cjs');
const { APP_ORIGIN, isAppUrl, isAppDocumentUrl, createProtocolHandler } = require('./protocol.cjs');
const { createTaskDiagnostics } = require('./diagnostics.cjs');

app.setName('西米露桌面版');
const profileRoot = path.resolve(process.env.WENYUN_DESKTOP_PROFILE || path.join(app.getPath('appData'), 'WenyunDesktop'));
app.setPath('userData', profileRoot);
protocol.registerSchemesAsPrivileged([{ scheme: 'wenyun', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let window;
let store;
let agent;
let taskServer;
let closing = false;
let allowClose = false;
let closeRequest = null;
let changingDirectory = false;
let updater;

function checkSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppDocumentUrl(event.senderFrame.url)) throw new Error('不允许的桌面操作来源');
}

function handle(name, action) {
  ipcMain.handle(name, (event, ...args) => { checkSender(event); return action(...args); });
}

async function openExternal(value) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) await shell.openExternal(url.href);
  } catch { /* 不向系统传递自定义协议或无法识别的链接。 */ }
}

async function openPayment(order) {
  const url = new URL(order?.url);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('支付地址无效');
  if (order.kind === 'redirect') return shell.openExternal(url.href);
  if (order.kind !== 'form' || !order.fields || typeof order.fields !== 'object' || Array.isArray(order.fields)) throw new Error('支付订单格式无效');
  const entries = Object.entries(order.fields);
  if (entries.length > 100 || entries.some(([key, value]) => key.length > 256 || typeof value !== 'string' || value.length > 8192)) throw new Error('支付订单字段无效');
  const encoded = new URLSearchParams(entries).toString();
  if (encoded.length > 65536) throw new Error('支付订单内容过长');
  // 支付页面使用独立、无桌面桥的隔离窗口，不能访问软件数据和配置。
  const payment = new BrowserWindow({
    title: `支付 · ${url.host}`, width: 1000, height: 800, parent: window,
    webPreferences: { partition: `payment-${Date.now()}`, nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  payment.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  payment.webContents.setWindowOpenHandler(({ url: link }) => { void openExternal(link); return { action: 'deny' }; });
  payment.webContents.on('will-attach-webview', (event) => event.preventDefault());
  payment.webContents.on('will-navigate', (event, target) => {
    try { if (!['https:', 'http:'].includes(new URL(target).protocol)) event.preventDefault(); }
    catch { event.preventDefault(); }
  });
  try {
    await payment.loadURL(url.href, { postData: [{ type: 'rawData', bytes: Buffer.from(encoded) }], extraHeaders: 'Content-Type: application/x-www-form-urlencoded' });
  } catch (error) {
    payment.destroy();
    throw error;
  }
}

async function prepareClose(installUpdate) {
  if (closing) return;
  closing = true;
  const result = await new Promise((resolve) => {
    const id = Date.now();
    const timeout = setTimeout(() => { closeRequest = null; resolve({ error: '页面未能确认保存完成' }); }, 15_000);
    closeRequest = { id, resolve: (value) => { clearTimeout(timeout); closeRequest = null; resolve(value); } };
    window.webContents.send('desktop:prepare-close', id);
  });
  let error = result?.error;
  try { await store.flush(); } catch (cause) { error = cause.message; }
  // 更新不得通过“仍然退出”强行中断正在生成或尚未保存的工作。
  if (installUpdate && (error || result?.busy)) {
    await dialog.showMessageBox(window, { type: 'info', title: '暂不能安装更新', message: error || '请等待当前任务完成后再安装更新。', buttons: ['确定'] });
    closing = false;
    return;
  }
  if (error || result?.busy) {
    const answer = await dialog.showMessageBox(window, {
      type: 'warning', title: '退出西米露',
      message: error ? '有数据尚未保存，仍要退出吗？' : '还有任务正在进行，仍要退出吗？',
      detail: error || '退出会中断本机正在进行的任务，上游已受理的请求可能仍会计费。',
      buttons: ['返回软件', '仍然退出'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (answer.response === 0) { closing = false; return; }
  }
  allowClose = true;
  await agent.stop();
  taskServer?.stopTasks();
  taskServer?.closeAllConnections();
  taskServer?.close();
  updater?.dispose();
  if (installUpdate) { installUpdate(); return; }
  window.destroy();
  app.quit();
}

async function start() {
  const directories = new DataDirectoryManager({
    profileRoot,
    softwareDirectory: app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'))) : __dirname,
    legacyDirectory: path.join(app.getPath('documents'), '西米露桌面版'),
    override: process.env.WENYUN_DESKTOP_DATA_HOME,
  });
  let dataRoot;
  try { dataRoot = await directories.initialize(); }
  catch (error) {
    const answer = await dialog.showMessageBox({ type: 'error', title: '存储位置不可用', message: '无法使用当前存储位置', detail: error.message, buttons: ['选择其他文件夹', '退出'], defaultId: 0, cancelId: 1 });
    if (answer.response !== 0) { app.quit(); return; }
    const selection = await dialog.showOpenDialog({ title: '选择本地数据存储位置', properties: ['openDirectory', 'createDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) { app.quit(); return; }
    dataRoot = await directories.initialize(selection.filePaths[0]);
  }
  store = new DiskStore(dataRoot, {
    privateRoot: profileRoot,
    encrypt: (value) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭证加密不可用，无法保存配置');
      return safeStorage.encryptString(value);
    },
    decrypt: (value) => safeStorage.decryptString(value),
  });
  const runtimeRoot = app.isPackaged ? path.join(process.resourcesPath, 'canvas-agent') : path.join(__dirname, '../canvas-agent');
  agent = new AgentRuntime({ home: path.join(profileRoot, 'canvas-agent'), runtimeRoot });
  const serverFile = app.isPackaged ? path.join(process.resourcesPath, 'server/image-tasks.mjs') : path.join(__dirname, '../server/image-tasks.mjs');
  const { createImageTaskServer } = await import(pathToFileURL(serverFile).href);
  taskServer = createImageTaskServer({
    upstreamBaseUrl: 'https://api.xn--v5z30ywuk.com/v1',
    storageDirectory: path.join(profileRoot, 'image-tasks'),
    // 本机保存续查凭据时使用系统加密，安装升级不会抹掉未完成任务。
    journalCodec: {
      encode: value => safeStorage.encryptString(value.toString()),
      decode: value => Buffer.from(safeStorage.decryptString(value)),
    },
    taskTtlMs: 24 * 60 * 60 * 1000,
  });
  await new Promise((resolve, reject) => { taskServer.once('error', reject); taskServer.listen(0, '127.0.0.1', resolve); });
  // 本机任务通信使用独立直连会话，防止系统代理把提交转发到远端或拦截。
  const localTaskSession = session.fromPartition('wenyun-local-tasks', { cache: false });
  await localTaskSession.setProxy({ mode: 'direct' });
  const taskDiagnostics = createTaskDiagnostics(path.join(profileRoot, 'logs'));
  protocol.handle('wenyun', createProtocolHandler({
    webRoot: app.isPackaged ? path.join(__dirname, 'web') : (process.env.WENYUN_DESKTOP_WEB_ROOT || path.join(__dirname, 'web')),
    taskOrigin: `http://127.0.0.1:${taskServer.address().port}`,
    fetch: (url, options) => net.fetch(url, options),
    fetchLocal: (url, options) => localTaskSession.fetch(url, options),
    onTaskDiagnostic: taskDiagnostics.report,
  }));

  handle('desktop:check-updates', () => updater?.check(true));
  handle('desktop:info', () => ({ version: app.getVersion(), dataDirectory: store.root }));
  handle('desktop:open-data', async () => { const error = await shell.openPath(store.root); if (error) throw new Error('数据目录无法打开'); });
  handle('desktop:change-data', async () => {
    if (changingDirectory || closing) throw new Error('请等待当前操作完成');
    changingDirectory = true;
    try {
      const selection = await dialog.showOpenDialog(window, { title: '选择本地数据存储位置', defaultPath: store.root, properties: ['openDirectory', 'createDirectory'] });
      if (selection.canceled || !selection.filePaths[0]) return null;
      const next = await directories.validateTarget(selection.filePaths[0], store.root);
      if (path.relative(store.root, next) === '') return { dataDirectory: store.root };
      const answer = await dialog.showMessageBox(window, {
        type: 'question', title: '更换存储位置', message: '将现有数据迁移到新位置？',
        detail: `${next}\n\n迁移成功后使用新位置，原目录保留备份。`,
        buttons: ['迁移数据', '取消'], defaultId: 0, cancelId: 1, noLink: true,
      });
      if (answer.response !== 0) return null;
      await store.relocate(next, (directory) => directories.save(directory));
      return { dataDirectory: store.root };
    } finally { changingDirectory = false; }
  });
  handle('desktop:open-payment', openPayment);
  handle('desktop:store', (operation, scope, ...args) => {
    if (!['get', 'all', 'keys', 'put', 'remove', 'clear', 'replace'].includes(operation)) throw new Error('本地存储操作无效');
    return store[operation](scope, ...args);
  });
  handle('desktop:flush', () => store.flush());
  handle('desktop:agent-start', () => agent.ensure());
  handle('desktop:agent-login', () => agent.login());
  ipcMain.on('desktop:close-ready', (event, id, result) => {
    try { checkSender(event); } catch { return; }
    if (closeRequest?.id === id) closeRequest.resolve(result);
  });

  window = new BrowserWindow({
    title: '西米露', width: 1440, height: 940, minWidth: 760, minHeight: 600,
    icon: app.isPackaged ? path.join(__dirname, 'icon.png') : undefined,
    show: false, backgroundColor: '#ffffff', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  updater = app.isPackaged
    ? createDesktopUpdater({ autoUpdater: require('electron-updater').autoUpdater, enabled: true, dialog, getWindow: () => window, install: prepareClose })
    : { check: () => dialog.showMessageBox(window, { message: '请使用安装版检查更新', buttons: ['确定'] }), dispose() {} };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ label: '打开数据目录', click: () => { void shell.openPath(store.root); } }, { type: 'separator' }, { label: '退出', accelerator: 'Alt+F4', click: () => window.close() }] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '帮助', submenu: [{ label: '检查更新', click: () => { void updater.check(true); } }] },
    { label: '视图', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }] },
  ]));
  window.webContents.setWindowOpenHandler(({ url }) => { void openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (!isAppDocumentUrl(url)) { event.preventDefault(); void openExternal(url); } });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(isAppUrl(details.requestingUrl) && permission === 'clipboard-sanitized-write');
  });
  window.webContents.session.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
  });
  window.on('close', (event) => {
    if (allowClose) return;
    event.preventDefault();
    if (changingDirectory) {
      void dialog.showMessageBox(window, { type: 'info', message: '正在更换存储位置，请完成后再退出。' });
      return;
    }
    void prepareClose();
  });
  window.once('ready-to-show', () => window.show());
  await window.loadURL(`${APP_ORIGIN}/wenyun`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start).catch(async (error) => {
    await agent?.stop();
    taskServer?.stopTasks();
    taskServer?.closeAllConnections();
    taskServer?.close();
    dialog.showErrorBox('西米露启动失败', error.message);
    app.exit(1);
  });
}
