const fs = require('node:fs/promises');
const path = require('node:path');

class DownloadManager {
  constructor(profileRoot) {
    this.file = path.join(profileRoot, 'download-location.json');
    this.state = { enabled: false, directory: '' };
  }

  async initialize() {
    try {
      const value = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (typeof value.directory === 'string' && path.isAbsolute(value.directory)) {
        this.state = { enabled: value.enabled === true, directory: value.directory };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('读取下载位置失败');
    }
  }

  info() { return { ...this.state }; }

  async persist(state) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(`${this.file}.tmp`, JSON.stringify(state));
    await fs.rename(`${this.file}.tmp`, this.file);
    this.state = state;
    return this.info();
  }

  async choose(directory) {
    const resolved = path.resolve(directory);
    if (!(await fs.stat(resolved)).isDirectory()) throw new Error('请选择有效的下载文件夹');
    await fs.access(resolved, require('node:fs').constants.W_OK);
    return this.persist({ enabled: true, directory: resolved });
  }

  disable() { return this.persist({ ...this.state, enabled: false }); }

  async save(filename, bytes) {
    if (!this.state.enabled) throw new Error('下载位置已关闭，请重新点击下载');
    if (typeof filename !== 'string' || !filename || filename.length > 240 || /[\x00-\x1f<>:"/\\|?*]/.test(filename) || /[. ]$/.test(filename) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(filename)) throw new Error('下载文件名无效');
    if (!(bytes instanceof ArrayBuffer)) throw new Error('下载内容无效');
    const directory = this.state.directory;
    const { name, ext } = path.parse(filename);
    for (let index = 0; index < 10000; index++) {
      const target = path.join(directory, index ? `${name} (${index})${ext}` : filename);
      let file;
      try {
        // 独占创建防止并发下载重名，也不会跟随已有同名软链接写入其他位置。
        file = await fs.open(target, 'wx');
      } catch (error) {
        if (error.code === 'EEXIST') continue;
        throw new Error('下载文件夹不可写，请检查磁盘或在设置中更改位置');
      }
      try {
        await file.writeFile(Buffer.from(bytes));
        await file.close();
        return;
      } catch {
        await file.close().catch(() => {});
        await fs.unlink(target).catch(() => {});
        throw new Error('保存下载失败，请检查磁盘空间和文件夹权限');
      }
    }
    throw new Error('同名文件过多，请更换下载位置');
  }
}

module.exports = { DownloadManager };
