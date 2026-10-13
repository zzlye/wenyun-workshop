import fs from 'node:fs/promises';
import path from 'node:path';
import { root, repo, tempRoot, getToolchain, prepareWeb, prepareAgentDependencies, run } from './toolchain.mjs';
import { createUninstallInclude } from './installer.mjs';

const tools = await getToolchain();
const { version, desktop, appRoot, buildRoot } = await prepareWeb();
const runtime = await prepareAgentDependencies();
const output = path.join(buildRoot, 'release');
for (const name of ['main.cjs', 'preload.cjs', 'storage.cjs', 'data-directory.cjs', 'protocol.cjs', 'agent-runtime.cjs', 'README.md']) {
  await fs.copyFile(path.join(root, name), path.join(appRoot, name));
}
await fs.copyFile(path.join(repo, 'LICENSE'), path.join(appRoot, 'LICENSE'));
const iconPng = path.join(appRoot, 'icon.png');
await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/create-icon.ps1'), '-OutputPath', iconPng]);
const png = await fs.readFile(iconPng);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
const iconFile = path.join(buildRoot, 'icon.ico');
await fs.writeFile(iconFile, Buffer.concat([header, png]));
await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: desktop.name, version, description: desktop.description, author: desktop.author, main: desktop.main, private: true }, null, 2));
const installerInclude = path.join(buildRoot, 'installer.nsh');
const electronFiles = await fs.readdir(path.dirname(tools.electron), { withFileTypes: true });
await fs.writeFile(installerInclude, createUninstallInclude(electronFiles.map((entry) => ({ name: entry.name, directory: entry.isDirectory() }))));
const config = {
  appId: 'xyz.zzlye.wenyun.desktop', productName: '西米露', executableName: 'Wenyun',
  electronDist: path.dirname(tools.electron), electronVersion: desktop.devDependencies.electron,
  directories: { output }, asar: true, npmRebuild: false, electronLanguages: ['zh-CN', 'en-US'],
  files: ['*.cjs', 'package.json', 'LICENSE', 'README.md', 'icon.png', 'web/**/*', '!web/downloads/**/*'],
  extraResources: [
    { from: path.join(repo, 'canvas-agent/dist'), to: 'canvas-agent/dist', filter: ['**/*', '!**/*.test.*', '!**/*.map'] },
    { from: path.join(runtime, 'node_modules'), to: 'canvas-agent/node_modules', filter: ['**/*', '!**/*.map', '!**/*.d.ts', '!**/*.d.cts', '!**/*.d.mts', '!**/test/**', '!**/tests/**', '!**/docs/**', '!**/README*', '!**/CHANGELOG*'] },
    { from: path.join(repo, 'canvas-agent/package.json'), to: 'canvas-agent/package.json' },
    { from: path.join(repo, 'canvas-agent/LICENSE'), to: 'canvas-agent/LICENSE' },
    { from: path.join(repo, 'canvas-agent/agent-instructions.md'), to: 'canvas-agent/agent-instructions.md' },
    { from: path.join(repo, 'server'), to: 'server', filter: ['image-tasks.mjs', 'midjourney.mjs'] },
  ],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], signExecutable: false, icon: iconFile, artifactName: 'Wenyun-${version}-Setup-x64.exe' },
  nsis: {
    oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    installerLanguages: ['zh_CN', 'en_US'], displayLanguageSelector: false,
    // 尚未提供自动增量更新，使用整包压缩以减小离线安装文件体积。
    differentialPackage: false,
    deleteAppDataOnUninstall: false, include: installerInclude,
    createDesktopShortcut: true, createStartMenuShortcut: true,
  },
};
const configFile = path.join(buildRoot, 'builder.json');
await fs.writeFile(configFile, JSON.stringify(config, null, 2));
await run(process.execPath, [tools.builder, '--projectDir', appRoot, '--config', configFile, ...(process.argv.includes('--dir') ? ['--dir'] : ['--win', 'nsis', '--x64'])], {
  env: { ...process.env, ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || 'D:/tools/electron-builder-cache', ELECTRON_BUILDER_COMPRESSION_LEVEL: process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL || '7', CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
});
await fs.writeFile(path.join(tempRoot, 'latest-build.json'), JSON.stringify({ version, output, appRoot, buildRoot }, null, 2));
console.log(`桌面版构建完成：${output}`);
