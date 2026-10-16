const UPDATE_FEED = 'https://xn--v5z30ywuk.com/desktop-updates/';

/** 仅检查官方发布源；下载和安装分别确认，绝不自动退出正在工作的窗口。 */
function createDesktopUpdater({ autoUpdater, enabled, dialog, getWindow, install }) {
  let checking = false;
  let downloading = false;
  let ready = false;
  let manual = false;
  let disposed = false;
  let prompting = false;
  const show = async options => {
    const window = getWindow();
    // 窗口退出期间放弃提示，避免异步事件触发未处理异常或重复弹窗。
    if (disposed || !window || window.isDestroyed?.()) return { response: options.cancelId ?? 1 };
    try { return await dialog.showMessageBox(window, { title: '西米露更新', noLink: true, ...options }); }
    catch { return { response: options.cancelId ?? 1 }; }
  };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED });

  async function installReady() {
    if (disposed || prompting) return;
    prompting = true;
    try {
      const answer = await show({ type: 'question', message: '更新已下载，保存后安装？', buttons: ['安装更新', '稍后'], defaultId: 1, cancelId: 1 });
      if (answer.response === 0 && !disposed) await install(() => autoUpdater.quitAndInstall(false, true));
    } catch { await show({ type: 'warning', message: '暂时无法安装更新，请稍后重试。', buttons: ['确定'] }); }
    finally { prompting = false; }
  }
  autoUpdater.on('update-available', async info => {
    if (disposed || prompting || downloading || ready) return;
    prompting = true;
    const answer = await show({ type: 'info', message: `发现新版本 ${info.version}`, buttons: ['下载更新', '稍后'], defaultId: 1, cancelId: 1 });
    prompting = false;
    if (answer.response !== 0 || disposed) return;
    downloading = true;
    try { await autoUpdater.downloadUpdate(); } catch { /* 错误统一由更新器事件显示。 */ }
    finally { downloading = false; }
  });
  autoUpdater.on('update-downloaded', () => { if (!disposed) { ready = true; void installReady(); } });
  autoUpdater.on('update-not-available', () => { if (manual) void show({ type: 'info', message: '当前已是最新版本', buttons: ['确定'] }); });
  autoUpdater.on('error', () => {
    // 后台检查失败不打扰正常生成，手动检查和下载失败才提示。
    if (manual || downloading) void show({ type: 'warning', message: '暂时无法获取更新，请稍后重试。', buttons: ['确定'] });
  });

  async function check(userInitiated = false) {
    if (disposed) return;
    if (!enabled) {
      if (userInitiated) await show({ type: 'info', message: '请使用安装版检查更新', buttons: ['确定'] });
      return;
    }
    if (ready) { if (userInitiated) await installReady(); return; }
    if (checking || downloading) return;
    checking = true; manual = userInitiated;
    try { await autoUpdater.checkForUpdates(); } catch { /* 保留现有版本，不影响主程序。 */ }
    finally { checking = false; manual = false; }
  }
  const first = enabled ? setTimeout(() => { void check(); }, 30_000) : null;
  const timer = enabled ? setInterval(() => { void check(); }, 4 * 60 * 60 * 1000) : null;
  first?.unref?.(); timer?.unref?.();
  return { check, dispose() { disposed = true; clearTimeout(first); clearInterval(timer); } };
}

module.exports = { createDesktopUpdater, UPDATE_FEED };
