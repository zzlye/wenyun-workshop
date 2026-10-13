const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { DiskStore } = require('../storage.cjs');
const { DataDirectoryManager, migrateDataDirectory } = require('../data-directory.cjs');

async function fixture(t) {
  const base = path.resolve('D:/tmp/wenyun-desktop-tests');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'location-'));
  const options = { profileRoot: path.join(root, 'profile'), softwareDirectory: path.join(root, 'software'), legacyDirectory: path.join(root, 'legacy') };
  await fs.mkdir(options.softwareDirectory);
  t.after(async () => {
    // 清理范围固定在本轮测试目录，不能触及真实软件及用户数据。
    if (path.dirname(root) !== base) throw new Error('测试清理路径越界');
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, options, manager: new DataDirectoryManager(options) };
}

test('首次使用默认在软件旁创建输出目录，不使用文档目录', async (t) => {
  const { manager, options } = await fixture(t);
  assert.equal(await manager.initialize(), path.join(options.softwareDirectory, '输出'));
  assert.equal(await new DataDirectoryManager(options).initialize(), manager.defaultDirectory);
});

test('升级自动迁移旧数据并保留原件及透明图片字节', async (t) => {
  const { manager, options } = await fixture(t);
  const old = new DiskStore(options.legacyDirectory);
  const image = { id: 'one', dataUrl: 'data:image/png;base64,AP+AAA==' };
  await old.put('images', 'one', image);
  await old.put('tasks', 'one', { id: 'one', quality: 'high' });
  const target = await manager.initialize();
  assert.equal(target, manager.defaultDirectory);
  assert.deepEqual(await new DiskStore(target).get('images', 'one'), image);
  assert.deepEqual(await new DiskStore(options.legacyDirectory).get('images', 'one'), image);
});

test('迁移与新写入顺序执行，新任务只进入新位置且重启继续使用新位置', async (t) => {
  const { root, manager, options } = await fixture(t);
  const source = await manager.initialize();
  const store = new DiskStore(source, { privateRoot: options.profileRoot });
  await store.put('tasks', 'before', { id: 'before' });
  const destination = path.join(root, 'new-data');
  const moving = store.relocate(destination, (directory) => manager.save(directory));
  const saving = store.put('tasks', 'after', { id: 'after' });
  await moving;
  await saving;
  assert.equal(await new DataDirectoryManager(options).initialize(), destination);
  assert.equal((await store.get('tasks', 'after')).id, 'after');
  assert.equal(await new DiskStore(source).get('tasks', 'after'), null);
  assert.equal((await new DiskStore(source).get('tasks', 'before')).id, 'before');
});

test('拒绝非空目录，既不覆盖目标文件也不影响后续保存', async (t) => {
  const { root, manager } = await fixture(t);
  const store = new DiskStore(await manager.initialize());
  const destination = path.join(root, 'occupied');
  await fs.mkdir(destination);
  await fs.writeFile(path.join(destination, 'keep.txt'), '用户文件');
  await assert.rejects(store.relocate(destination, (directory) => manager.save(directory)), /空文件夹/);
  await store.put('tasks', 'one', { id: 'one' });
  await store.flush();
  assert.equal(await fs.readFile(path.join(destination, 'keep.txt'), 'utf8'), '用户文件');
  assert.equal(store.root, manager.defaultDirectory);
});

test('配置写入失败时保持原目录，保留已校验的新副本', async (t) => {
  const { root, manager } = await fixture(t);
  const store = new DiskStore(await manager.initialize());
  await store.put('tasks', 'one', { id: 'one' });
  const destination = path.join(root, 'copy');
  await assert.rejects(store.relocate(destination, async () => { throw new Error('配置写入失败'); }), /配置写入失败/);
  assert.equal(store.root, manager.defaultDirectory);
  assert.equal((await new DiskStore(destination).get('tasks', 'one')).id, 'one');
  await store.flush();
});

test('拒绝互相包含的目录和软件运行资源目录', async (t) => {
  const { root, manager, options } = await fixture(t);
  const source = await manager.initialize();
  await assert.rejects(migrateDataDirectory(source, path.join(source, 'child'), async () => {}), /不能位于/);
  await assert.rejects(manager.validateTarget(root, source), /配置目录/);
  await assert.rejects(manager.validateTarget(path.join(options.softwareDirectory, 'resources'), source), /输出/);
  await assert.rejects(manager.validateTarget(options.profileRoot, source), /配置目录/);
});

test('迁移拒绝联接点，不复制外部目录内容', async (t) => {
  const { root, manager } = await fixture(t);
  const source = await manager.initialize();
  const external = path.join(root, 'external');
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'private.txt'), '不能复制');
  await fs.symlink(external, path.join(source, 'link'), 'junction');
  await assert.rejects(migrateDataDirectory(source, path.join(root, 'copy'), async () => {}), /链接/);
  assert.equal(await fs.readFile(path.join(external, 'private.txt'), 'utf8'), '不能复制');
  assert.deepEqual((await fs.readdir(root)).filter((name) => name.startsWith('.wenyun-transfer-')), []);
});

test('保存失败尚未解决时不迁移，缺失的已选磁盘不能被当成空数据重建', async (t) => {
  const { root, manager } = await fixture(t);
  const source = await manager.initialize();
  const store = new DiskStore(source);
  await assert.rejects(store.put('images', 'bad', { id: 'bad', dataUrl: 'invalid' }));
  await assert.rejects(store.relocate(path.join(root, 'new'), (directory) => manager.save(directory)), /未保存/);
  await manager.save(path.join(root, 'missing-drive'));
  await assert.rejects(manager.initialize(), /原数据目录无法访问/);
});

test('损坏的位置配置不回退到默认空数据', async (t) => {
  const { manager } = await fixture(t);
  await manager.initialize();
  await fs.writeFile(manager.configFile, '{broken');
  await assert.rejects(manager.initialize());
  assert.equal(await fs.readFile(manager.configFile, 'utf8'), '{broken');
});

test('位置配置丢失后先找回软件旁的现有数据，不用旧备份覆盖', async (t) => {
  const { root, manager, options } = await fixture(t);
  const store = new DiskStore(await manager.initialize());
  await store.put('tasks', 'new', { id: 'new' });
  await new DiskStore(options.legacyDirectory).put('tasks', 'old', { id: 'old' });
  await fs.rm(manager.configFile);
  const destination = path.join(root, 'recovered');
  assert.equal(await manager.initialize(destination), destination);
  assert.equal((await new DiskStore(destination).get('tasks', 'new')).id, 'new');
  assert.equal(await new DiskStore(destination).get('tasks', 'old'), null);
});

test('卸载脚本只清理指定运行文件，保留输出和其他用户文件', async () => {
  const { createUninstallInclude } = await import('../scripts/installer.mjs');
  const script = createUninstallInclude([{ name: 'electron.exe', directory: false }, { name: 'resources', directory: true }, { name: 'locales', directory: true }, { name: 'ffmpeg.dll', directory: false }]);
  assert.ok(script.includes('RMDir /r "$INSTDIR\\resources"'));
  assert.ok(!script.includes('RMDir /r "$INSTDIR"'));
  assert.ok(!script.includes('Delete "$INSTDIR\\*'));
  assert.throws(() => createUninstallInclude([{ name: '输出', directory: true }]));
  assert.throws(() => createUninstallInclude([{ name: '../data', directory: true }]));
});
