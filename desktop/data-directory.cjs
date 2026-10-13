const fs = require('node:fs/promises');
const { createReadStream, constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function writableDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('请选择完整的本地文件夹路径');
  await fs.mkdir(directory, { recursive: true });
  const root = await fs.realpath(directory);
  if (root === path.parse(root).root) throw new Error('不能直接使用磁盘根目录，请新建一个文件夹');
  const probe = path.join(root, `.wenyun-write-${crypto.randomUUID()}`);
  try { await fs.writeFile(probe, '', { flag: 'wx' }); }
  finally { await fs.rm(probe, { force: true }); }
  return root;
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function copyVerified(source, target) {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    // 不跟随链接或联接点，避免把数据目录之外的文件一起迁移。
    const stat = await fs.lstat(from);
    if (stat.isSymbolicLink()) throw new Error('数据目录中含有链接，请移除链接后重试');
    if (stat.isDirectory()) {
      await fs.mkdir(to);
      await copyVerified(from, to);
    } else if (stat.isFile()) {
      await fs.copyFile(from, to, constants.COPYFILE_EXCL);
      if (await hashFile(from) !== await hashFile(to)) throw new Error('文件复制校验失败，原目录已保留');
      const handle = await fs.open(to, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
    } else {
      throw new Error('数据目录中含有不支持的文件类型');
    }
  }
}

async function migrateDataDirectory(source, destination, commit) {
  const from = await fs.realpath(source);
  const requested = path.resolve(destination);
  if (contains(from, requested) && path.relative(from, requested) !== '') throw new Error('新目录不能位于当前数据目录内');
  const target = await writableDirectory(requested);
  if (path.relative(from, target) === '') return from;
  if (contains(from, target) || contains(target, from)) throw new Error('新旧数据目录不能互相包含');
  if ((await fs.readdir(target)).length) throw new Error('请选择空文件夹，避免覆盖已有数据');
  const parent = path.dirname(target);
  const staging = await fs.mkdtemp(path.join(parent, '.wenyun-transfer-'));
  let published = false;
  try {
    await copyVerified(from, staging);
    // 完整复制并校验后才发布新目录；失败或断电时，原目录始终保持完整。
    await fs.rmdir(target);
    await fs.rename(staging, target);
    published = true;
    await commit(target);
    return target;
  } finally {
    // 只清理本次创建、位于选定目标父目录内的临时副本，绝不删除用户数据目录。
    if (!published && path.dirname(path.resolve(staging)) === parent && path.basename(staging).startsWith('.wenyun-transfer-')) {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
}

class DataDirectoryManager {
  constructor({ profileRoot, softwareDirectory, legacyDirectory, override }) {
    this.profileRoot = path.resolve(profileRoot);
    this.softwareDirectory = path.resolve(softwareDirectory);
    this.defaultDirectory = path.join(this.softwareDirectory, '输出');
    this.legacyDirectory = legacyDirectory;
    this.override = override;
    this.configFile = path.join(this.profileRoot, 'data-location.json');
  }

  async read() {
    let raw;
    try { raw = await fs.readFile(this.configFile, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const value = JSON.parse(raw);
    if (value.version !== 1 || typeof value.directory !== 'string' || !path.isAbsolute(value.directory)) throw new Error('存储位置配置损坏，原文件已保留');
    return value.directory;
  }

  async save(directory) {
    // 延迟加载，避免存储队列与迁移工具之间形成初始化循环。
    const { atomicWrite } = require('./storage.cjs');
    await atomicWrite(this.configFile, JSON.stringify({ version: 1, directory }));
  }

  async validateTarget(directory, source) {
    const target = await writableDirectory(directory);
    const software = await fs.realpath(this.softwareDirectory);
    const output = path.join(software, '输出');
    const profile = await fs.realpath(this.profileRoot);
    if (contains(profile, target) || contains(target, profile)) throw new Error('不能将软件配置目录用作素材存储位置');
    if (contains(software, target) && path.relative(output, target) !== '') throw new Error('软件目录内请使用“输出”文件夹，或选择软件目录外的空文件夹');
    if (source) {
      const current = await fs.realpath(source);
      if (path.relative(current, target) === '') return target;
      if (contains(current, target) || contains(target, current)) throw new Error('新旧数据目录不能互相包含');
    }
    if ((await fs.readdir(target)).length) throw new Error('请选择空文件夹，避免覆盖已有数据');
    return target;
  }

  async initialize(selected) {
    await fs.mkdir(this.profileRoot, { recursive: true });
    const saved = await this.read();
    // 配置缺失时优先找回软件旁的已有数据，再兼容旧版文档目录；测试目录不读取真实数据。
    let source = saved;
    if (!saved && !this.override) {
      for (const candidate of [this.defaultDirectory, this.legacyDirectory].filter(Boolean)) {
        try {
          if ((await fs.readdir(path.join(candidate, '记录'))).length) { source = candidate; break; }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    if (source) {
      try { await fs.access(source); }
      catch { throw new Error(`原数据目录无法访问，请连接对应磁盘后重试：${source}`); }
    }
    const target = selected || saved || this.override || this.defaultDirectory;
    if (source && path.relative(path.resolve(source), path.resolve(target)) !== '') {
      const next = await this.validateTarget(target, source);
      return migrateDataDirectory(source, next, (directory) => this.save(directory));
    }
    const root = selected && !source ? await this.validateTarget(target) : await writableDirectory(target);
    if (!saved) await this.save(root);
    return root;
  }
}

module.exports = { DataDirectoryManager, migrateDataDirectory, contains };
