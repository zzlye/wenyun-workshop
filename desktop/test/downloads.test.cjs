const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { DownloadManager } = require('../downloads.cjs');

async function fixture(t) {
  const base = path.resolve('D:/tmp/wenyun-desktop-tests');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'downloads-'));
  t.after(async () => {
    // 只清理本测试创建的临时目录。
    if (path.dirname(root) !== base) throw new Error('临时目录越界');
    await fs.rm(root, { recursive: true, force: true });
  });
  const profile = path.join(root, 'profile');
  const directory = path.join(root, 'downloads');
  await fs.mkdir(directory);
  const manager = new DownloadManager(profile);
  await manager.initialize();
  return { root, profile, directory, manager };
}

const bytes = () => new TextEncoder().encode('原始图片字节').buffer;

test('默认关闭，选择目录后重启保留，关闭后不继续写入', async t => {
  const { manager, profile, directory } = await fixture(t);
  assert.deepEqual(manager.info(), { enabled: false, directory: '' });
  await manager.choose(directory);
  const restarted = new DownloadManager(profile);
  await restarted.initialize();
  assert.deepEqual(restarted.info(), { enabled: true, directory });
  await restarted.save('图.png', bytes());
  assert.equal(await fs.readFile(path.join(directory, '图.png'), 'utf8'), '原始图片字节');
  await restarted.disable();
  await assert.rejects(restarted.save('不应写入.png', bytes()), /关闭/);
  await manager.initialize();
  assert.equal(manager.info().enabled, false);
});

test('重复和并发下载不会覆盖原文件，更换目录后只写入新位置', async t => {
  const { manager, directory, root } = await fixture(t);
  await manager.choose(directory);
  await fs.writeFile(path.join(directory, '图.png'), '旧图片');
  await Promise.all([manager.save('图.png', bytes()), manager.save('图.png', bytes())]);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['图 (1).png', '图 (2).png', '图.png']);
  assert.equal(await fs.readFile(path.join(directory, '图.png'), 'utf8'), '旧图片');
  const next = path.join(root, 'new-downloads');
  await fs.mkdir(next);
  await manager.choose(next);
  await manager.save('新图.png', bytes());
  assert.deepEqual(await fs.readdir(next), ['新图.png']);
  assert.equal((await fs.readdir(directory)).length, 3);
});

test('拒绝越界路径、保留文件名，目录丢失时明确报错', async t => {
  const { manager, directory } = await fixture(t);
  await manager.choose(directory);
  for (const name of ['../越界.png', '..\\越界.png', 'C:\\越界.png', 'CON.png', '图.png:数据']) {
    await assert.rejects(manager.save(name, bytes()), /文件名无效/);
  }
  await fs.rmdir(directory);
  await assert.rejects(manager.save('图.png', bytes()), /文件夹不可写/);
});
