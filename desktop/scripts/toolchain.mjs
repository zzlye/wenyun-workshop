import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const repo = path.dirname(root);
export const toolRoot = path.resolve(process.env.WENYUN_DESKTOP_TOOLCHAIN || 'D:/tools/wenyun-desktop-toolchain');
export const tempRoot = path.resolve(process.env.WENYUN_DESKTOP_BUILD_HOME || 'D:/tmp/wenyun-desktop');
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repo, stdio: 'inherit', windowsHide: true, ...options });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`命令执行失败，退出码 ${code}：${path.basename(command)}`)));
  });
}

export function npm(args, options) { return run(process.execPath, [npmCli, ...args], options); }

export async function getToolchain() {
  const requirements = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).devDependencies;
  await fs.mkdir(toolRoot, { recursive: true });
  const require = createRequire(path.join(toolRoot, 'package.json'));
  let ready = true;
  for (const [name, version] of Object.entries(requirements)) {
    try { if (require(`${name}/package.json`).version !== version) ready = false; }
    catch { ready = false; }
  }
  if (!ready) {
    for (const name of ['package.json', 'package-lock.json']) await fs.copyFile(path.join(root, name), path.join(toolRoot, name));
    await npm(['ci', '--prefix', toolRoot, '--no-audit', '--no-fund']);
  }
  return { electron: require('electron'), builder: require.resolve('electron-builder/cli.js') };
}

export async function prepareWeb() {
  const version = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8')).version;
  const desktop = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (version !== desktop.version) throw new Error('桌面版和网页版的版本号不一致');
  await fs.mkdir(tempRoot, { recursive: true });
  const buildRoot = await fs.mkdtemp(path.join(tempRoot, 'build-'));
  const appRoot = path.join(buildRoot, 'app');
  await fs.mkdir(appRoot);
  await npm(['run', 'build', '--', '--outDir', path.join(appRoot, 'web')]);
  await npm(['run', 'agent:build']);
  return { version, desktop, appRoot, buildRoot };
}

export async function prepareAgentDependencies() {
  const runtime = path.resolve('D:/tools/wenyun-desktop-agent-runtime');
  await fs.mkdir(runtime, { recursive: true });
  // 只安装锁定的生产依赖，安装路径和发布内容都不读取开发者的登录凭据。
  for (const name of ['package.json', 'package-lock.json']) await fs.copyFile(path.join(repo, 'canvas-agent', name), path.join(runtime, name));
  await npm(['ci', '--prefix', runtime, '--omit=dev', '--no-audit', '--no-fund']);
  return runtime;
}

// 更新组件只将锁定的运行依赖打入安装包，不携带构建工具和开发目录。
export async function prepareUpdateDependencies() {
  const runtime = path.resolve('D:/tools/wenyun-desktop-update-runtime');
  await fs.mkdir(runtime, { recursive: true });
  for (const name of ['package.json', 'package-lock.json']) await fs.copyFile(path.join(root, name), path.join(runtime, name));
  await npm(['ci', '--prefix', runtime, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
  return runtime;
}
