import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const { _electron } = createRequire('D:/tools/playwright/package.json')('playwright');
const build = JSON.parse(await fs.readFile('D:/tmp/wenyun-desktop/latest-build.json', 'utf8'));
const root = await fs.mkdtemp('D:/tmp/wenyun-desktop/video-reference-');
const env = { ...process.env, WENYUN_DESKTOP_PROFILE: path.join(root, 'profile'), WENYUN_DESKTOP_DATA_HOME: path.join(root, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await _electron.launch({ executablePath: path.join(build.output, 'win-unpacked/Wenyun.exe'), env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '画布工坊', exact: true }).waitFor({ timeout: 30000 });
  await app.evaluate(() => {
    const original = globalThis.fetch;
    globalThis.videoReferenceCheck = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'xn--v5z30ywuk.com' && url.pathname === '/image-tasks/media-reference-uploads') {
        const headers = new Headers(init.headers);
        if (headers.get('authorization') !== 'Bearer video-smoke-only') throw new Error('上传鉴权不一致');
        let size = 0;
        for await (const chunk of init.body) size += chunk.length;
        const type = headers.get('content-type');
        globalThis.videoReferenceCheck.push({ size, type, streamed: init.duplex === 'half' });
        const extension = { 'image/png': 'png', 'audio/wav': 'wav', 'video/mp4': 'mp4' }[type];
        return new Response(JSON.stringify({ url: `https://xn--v5z30ywuk.com/image-tasks/media-references/${Date.now()+86400000}-${'a'.repeat(48)}.${extension}`, expires_in: 86400 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      return original(input, init);
    };
  });
  const urls = await page.evaluate(async () => {
    const result = [];
    for (const type of ['image/png', 'audio/wav', 'video/mp4']) {
      const blob = new Blob([new Uint8Array(1024)], { type });
      const r = await fetch('/image-tasks/media-reference-uploads', { method: 'POST', headers: { Authorization: 'Bearer video-smoke-only', 'Content-Type': type }, body: blob });
      if (r.status !== 201) throw new Error(await r.text());
      result.push((await r.json()).url);
    }
    return result;
  });
  const counts = await app.evaluate(() => globalThis.videoReferenceCheck);
  assert.equal(counts.length, 3);
  assert.ok(counts.every(item => item.size === 1024 && item.streamed));
  assert.ok(urls.every(url => url.startsWith('https://xn--v5z30ywuk.com/image-tasks/media-references/')));
  await fs.writeFile(path.join(root, 'verification.json'), JSON.stringify({ version: build.version, counts, urls, generationRequests: 0 }, null, 2));
  console.log('桌面安装包图片、音频、视频上传及远程 URL 返回：通过');
  console.log(`验证记录：${root}`);
} finally {
  if (app) {
    const closed = app.waitForEvent('close', { timeout: 30000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
  }
}
