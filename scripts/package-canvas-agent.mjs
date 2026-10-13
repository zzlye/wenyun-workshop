import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'canvas-agent');
const entries = {};
// 采用白名单打包，只分发启动所需源码，不收集令牌、会话、依赖和本机配置。
function include(relative) {
    const file = path.join(source, relative);
    if (fs.statSync(file).isDirectory()) {
        for (const name of fs.readdirSync(file).sort()) include(`${relative}/${name}`);
    } else if (!relative.endsWith('.test.ts')) {
        const bytes = fs.readFileSync(file);
        entries[`wenyun-canvas-agent/${relative}`] = [relative.endsWith('.cmd') ? Buffer.from(bytes.toString('utf8').replace(/\r?\n/g, '\r\n')) : bytes, { mtime: new Date('2026-01-01T00:00:00Z') }];
    }
}
for (const relative of ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'agent-instructions.md', 'LICENSE', 'UPSTREAM.md', 'README.md', 'launcher.mjs', '启动画布助手.cmd', '登录Codex.cmd']) include(relative);
const output = path.join(root, 'public', 'downloads', 'wenyun-canvas-agent.zip');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, zipSync(entries, { level: 6 }));
console.log(`已生成 Canvas Agent 启动包（${Object.keys(entries).length} 个文件）`);
