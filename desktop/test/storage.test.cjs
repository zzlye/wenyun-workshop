const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { DiskStore } = require('../storage.cjs');

async function fixture(t) {
  const base = path.resolve('D:/tmp/wenyun-desktop-tests');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'storage-'));
  t.after(async () => {
    // 测试清理只允许触及本轮创建的临时子目录。
    if (path.dirname(root) !== base) throw new Error('临时目录越界');
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, store: new DiskStore(root) };
}

test('任务和画布状态在重新打开后保持完整', async (t) => {
  const { root, store } = await fixture(t);
  await store.put('tasks', 'one', { id: 'one', prompt: '中文提示词', quality: 'high' });
  await store.put('canvas-state', 'canvas:index', JSON.stringify({ nodes: [1, 2] }));
  await store.flush();
  const restarted = new DiskStore(root);
  assert.deepEqual(await restarted.all('tasks'), [{ id: 'one', prompt: '中文提示词', quality: 'high' }]);
  assert.equal(await restarted.get('canvas-state', 'canvas:index'), '{"nodes":[1,2]}');
});

test('并发写入保持调用顺序且不丢其他记录', async (t) => {
  const { store } = await fixture(t);
  const writes = [];
  for (let index = 0; index < 30; index++) {
    writes.push(store.put('tasks', 'shared', { id: 'shared', version: index }));
    writes.push(store.put('tasks', `task-${index}`, { id: `task-${index}` }));
  }
  await Promise.all(writes);
  assert.equal((await store.get('tasks', 'shared')).version, 29);
  assert.equal((await store.keys('tasks')).length, 31);
});

test('图片使用原始字节写盘并可以重启读取', async (t) => {
  const { root, store } = await fixture(t);
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=', 'base64');
  const image = { id: 'transparent', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, width: 1, height: 1, source: 'upload' };
  await store.put('images', image.id, image);
  const files = await fs.readdir(path.join(root, '图片/生图工坊'));
  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith('.png'));
  assert.deepEqual(await fs.readFile(path.join(root, '图片/生图工坊', files[0])), bytes);
  assert.deepEqual(await new DiskStore(root).get('images', image.id), image);
  const metadata = await fs.readFile(path.join(root, '记录/images.json'), 'utf8');
  assert.ok(!metadata.includes('base64'));
});

test('画布图片和视频不改变类型及字节', async (t) => {
  const { root, store } = await fixture(t);
  for (const [scope, mimeType] of [['canvas-images', 'image/webp'], ['canvas-media', 'video/mp4']]) {
    await store.put(scope, 'file:one', { bytes: Uint8Array.from([0, 255, 128, 32]), mimeType });
    const value = await new DiskStore(root).get(scope, 'file:one');
    assert.equal(value.mimeType, mimeType);
    assert.deepEqual(Array.from(value.bytes), [0, 255, 128, 32]);
  }
});

test('特殊编号和目录穿越输入不能逃出数据目录', async (t) => {
  const { store } = await fixture(t);
  await store.put('tasks', '__proto__', { id: 'safe' });
  assert.deepEqual(await store.get('tasks', '__proto__'), { id: 'safe' });
  assert.equal(await store.get('tasks', 'constructor'), null);
  await store.put('canvas-images', '../../outside', { bytes: new Uint8Array([1]), mimeType: 'image/png' });
  assert.deepEqual(await store.keys('canvas-images'), ['../../outside']);
  await assert.rejects(store.get('../../outside', 'test'));
  assert.throws(() => store.mediaPath('canvas-images', '../../outside.png'));
});

test('清空只删除登记的媒体，保留用户放进文件夹的文件', async (t) => {
  const { root, store } = await fixture(t);
  await store.put('canvas-images', 'one', { bytes: new Uint8Array([1]), mimeType: 'image/png' });
  const extra = path.join(root, '图片/画布', '用户备份.txt');
  await fs.writeFile(extra, '保留');
  await store.clear('canvas-images');
  assert.equal(await fs.readFile(extra, 'utf8'), '保留');
  assert.deepEqual(await store.keys('canvas-images'), []);
});

test('对话替换失败时保留原记录，成功后清除旧记录', async (t) => {
  const { root, store } = await fixture(t);
  await store.replace('agentConversations', [{ id: 'old', name: '旧对话' }]);
  await assert.rejects(store.replace('agentConversations', [{ name: '缺少编号' }]));
  assert.equal((await new DiskStore(root).all('agentConversations'))[0].id, 'old');
  await assert.rejects(store.flush());
  await store.replace('agentConversations', [{ id: 'new' }]);
  await store.flush();
  assert.deepEqual(await new DiskStore(root).keys('agentConversations'), ['new']);
});

test('损坏的记录不会被后续写入覆盖', async (t) => {
  const { root } = await fixture(t);
  await fs.mkdir(path.join(root, '记录'));
  const file = path.join(root, '记录/tasks.json');
  await fs.writeFile(file, '{broken');
  const store = new DiskStore(root);
  await assert.rejects(store.put('tasks', 'new', {}));
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

test('主要配置经过系统加密适配器，不写入素材目录', async (t) => {
  const { root } = await fixture(t);
  const options = { privateRoot: path.join(root, 'profile'), encrypt: (value) => Buffer.from(value).reverse(), decrypt: (value) => Buffer.from(value).reverse().toString() };
  const store = new DiskStore(path.join(root, 'media'), options);
  await store.put('settings', 'config', 'private-key');
  const file = await fs.readFile(path.join(root, 'profile/settings.enc'), 'utf8');
  assert.ok(!file.includes('private-key'));
  assert.equal(await new DiskStore(path.join(root, 'media'), options).get('settings', 'config'), 'private-key');
});
