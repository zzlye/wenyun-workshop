const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SCOPES = new Set(['tasks', 'images', 'thumbnails', 'agentConversations', 'canvas-state', 'canvas-images', 'canvas-media', 'settings']);
const MEDIA_DIRS = { images: '图片/生图工坊', thumbnails: '缩略图', 'canvas-images': '图片/画布', 'canvas-media': '视频与音频' };
const DATA_FIELDS = { images: 'dataUrl', thumbnails: 'thumbnailDataUrl' };
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };

async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function validateKey(key) {
  if (typeof key !== 'string' || !key || key.length > 1024) throw new Error('本地记录编号无效');
}

function decodeDataUrl(value) {
  const match = typeof value === 'string' && value.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);
  if (!match) throw new Error('图片数据格式无效，未写入本地文件');
  if (match[2] && !/^[A-Za-z0-9+/]*={0,2}$/.test(match[3])) throw new Error('图片编码无效');
  return { mimeType: match[1], bytes: match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3])) };
}

class DiskStore {
  constructor(root, { privateRoot = root, encrypt, decrypt } = {}) {
    this.root = path.resolve(root);
    this.privateRoot = path.resolve(privateRoot);
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.cache = new Map();
    this.queue = Promise.resolve();
    this.errors = new Map();
  }

  documentPath(scope) {
    if (!SCOPES.has(scope)) throw new Error('不允许访问此本地存储区域');
    return scope === 'settings'
      ? path.join(this.privateRoot, 'settings.enc')
      : path.join(this.root, '记录', `${scope}.json`);
  }

  async read(scope) {
    const file = this.documentPath(scope);
    if (this.cache.has(scope)) return this.cache.get(scope);
    let records = Object.create(null);
    try {
      const raw = await fs.readFile(file);
      const json = scope === 'settings' ? this.decrypt?.(raw) : raw.toString('utf8');
      if (typeof json !== 'string') throw new Error('系统无法解密本地配置');
      const document = JSON.parse(json);
      if (document.version !== 1 || !document.records || typeof document.records !== 'object' || Array.isArray(document.records)) throw new Error('本地数据格式无效');
      records = Object.assign(Object.create(null), document.records);
    } catch (error) {
      // 数据损坏时不能当作空数据继续写入，避免覆盖用户已有素材。
      if (error.code !== 'ENOENT') throw error;
    }
    this.cache.set(scope, records);
    return records;
  }

  async save(scope, records) {
    const json = JSON.stringify({ version: 1, records });
    const content = scope === 'settings' ? this.encrypt?.(json) : json;
    if (content == null) throw new Error('系统无法加密本地配置');
    await atomicWrite(this.documentPath(scope), content);
    this.cache.set(scope, records);
  }

  mutate(scope, key, operation) {
    this.documentPath(scope);
    const errorKey = `${scope}:${key}`;
    // 所有落盘操作按顺序完成，防止旧快照覆盖新快照或退出时仍有写入。
    const pending = this.queue.then(operation).then((result) => {
      this.errors.delete(errorKey);
      if (key === '*') for (const existing of this.errors.keys()) if (existing.startsWith(`${scope}:`)) this.errors.delete(existing);
      return result;
    }, (error) => {
      this.errors.set(errorKey, error);
      throw error;
    });
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  async materialize(scope, item) {
    if (!item) return null;
    const value = structuredClone(item.value);
    if (!item.media) return value;
    const bytes = await fs.readFile(this.mediaPath(scope, item.media.file));
    if (DATA_FIELDS[scope]) return { ...value, [DATA_FIELDS[scope]]: `data:${item.media.mimeType};base64,${bytes.toString('base64')}` };
    return { bytes: new Uint8Array(bytes), mimeType: item.media.mimeType };
  }

  mediaPath(scope, file) {
    if (!MEDIA_DIRS[scope] || !/^[a-f0-9]{64}-[a-f0-9]{64}\.[a-z0-9]+$/.test(file)) throw new Error('本地素材路径无效');
    return path.join(this.root, MEDIA_DIRS[scope], file);
  }

  async createMedia(scope, key, input) {
    if (!MEDIA_DIRS[scope] || !input || typeof input.mimeType !== 'string' || input.mimeType.length > 128 || /[\r\n]/.test(input.mimeType)) throw new Error('素材类型无效');
    if (!(input.bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(input.bytes)) throw new Error('素材内容无效');
    const bytes = input.bytes instanceof ArrayBuffer ? Buffer.from(input.bytes) : Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
    if (bytes.length > 600 * 1024 * 1024) throw new Error('单个本地素材不能超过 600 MB');
    const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
    const file = `${hash(key)}-${hash(bytes)}.${EXTENSIONS[input.mimeType] || 'bin'}`;
    // 原文件直接写盘，不经过画布重绘，保留透明通道、分辨率及原始编码。
    await atomicWrite(this.mediaPath(scope, file), bytes);
    return { file, mimeType: input.mimeType };
  }

  async removeMedia(scope, item, replacement) {
    if (item?.media && item.media.file !== replacement?.media?.file) await fs.rm(this.mediaPath(scope, item.media.file), { force: true });
  }

  async get(scope, key) {
    validateKey(key);
    await this.queue;
    const records = await this.read(scope);
    return Object.hasOwn(records, key) ? this.materialize(scope, records[key]) : null;
  }

  async all(scope) {
    await this.queue;
    const result = [];
    for (const item of Object.values(await this.read(scope))) result.push(await this.materialize(scope, item));
    return result;
  }

  async keys(scope) {
    await this.queue;
    return Object.keys(await this.read(scope));
  }

  put(scope, key, value) {
    validateKey(key);
    const cloned = structuredClone(value);
    return this.mutate(scope, key, async () => {
      const records = Object.assign(Object.create(null), await this.read(scope));
      const old = records[key];
      let item = { value: cloned };
      if (DATA_FIELDS[scope]) {
        if (cloned?.id !== key) throw new Error('图片编号不匹配');
        const input = decodeDataUrl(cloned[DATA_FIELDS[scope]]);
        const media = await this.createMedia(scope, key, input);
        delete cloned[DATA_FIELDS[scope]];
        item = { value: cloned, media };
      } else if (scope === 'canvas-images' || scope === 'canvas-media') {
        item = { value: null, media: await this.createMedia(scope, key, cloned) };
      }
      Object.defineProperty(records, key, { value: item, enumerable: true, writable: true, configurable: true });
      await this.save(scope, records);
      await this.removeMedia(scope, old, item);
      return key;
    });
  }

  remove(scope, key) {
    validateKey(key);
    return this.mutate(scope, key, async () => {
      const records = Object.assign(Object.create(null), await this.read(scope));
      const old = records[key];
      delete records[key];
      await this.save(scope, records);
      await this.removeMedia(scope, old);
    });
  }

  clear(scope) {
    return this.mutate(scope, '*', async () => {
      const old = await this.read(scope);
      await this.save(scope, {});
      // 只删除索引登记的素材，不递归删除目录或用户自行放入的文件。
      for (const item of Object.values(old)) await this.removeMedia(scope, item);
    });
  }

  replace(scope, values) {
    if (scope !== 'agentConversations' || !Array.isArray(values)) throw new Error('不支持替换此类本地数据');
    const cloned = structuredClone(values);
    return this.mutate(scope, '*', async () => {
      const records = Object.create(null);
      for (const value of cloned) {
        validateKey(value?.id);
        records[value.id] = { value };
      }
      await this.save(scope, records);
    });
  }

  async flush() {
    await this.queue;
    if (this.errors.size) throw new Error(`本地保存尚未完成：${this.errors.values().next().value.message}`);
  }
}

module.exports = { DiskStore, atomicWrite };
