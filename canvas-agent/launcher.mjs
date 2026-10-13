import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// 只从本机配置读取令牌，禁止把它发送到中转站或任意远程地址。
export function validateLocalConfig(config) {
    const url = new URL(config.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !config.token) {
        throw new Error('本机 Agent 配置无效，请检查 canvas-agent.json 中的服务地址。');
    }
    return { url: url.origin, token: config.token };
}

export async function runningAgent(config, request = fetch) {
    const response = await request(`${config.url}/config`, { signal: AbortSignal.timeout(2000) }).catch(error => {
        if (error.cause?.code === 'ECONNREFUSED') return null;
        throw new Error('本机端口没有正常响应，请检查已有启动窗口。');
    });
    if (!response) return false;
    const info = await response.json().catch(() => ({}));
    if (!response.ok || info.protocolVersion !== 6 || info.url !== config.url) throw new Error('端口已被其他服务占用，请检查已有启动窗口。');
    const auth = await request(`${config.url}/agent/codex/workspace`, { headers: { 'x-canvas-agent-token': config.token }, signal: AbortSignal.timeout(2000) });
    if (!auth.ok) throw new Error('已有 Agent 的令牌与本机配置不一致，请使用原启动窗口中的令牌。');
    return true;
}

function showConnection(config) {
    console.log(`\n服务地址：${config.url}\n连接令牌：${config.token}`);
    if (process.platform === 'win32') {
        // 通过标准输入复制，令牌不拼入命令行；失败时仍可从启动窗口手动复制。
        const copied = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', '$value = [Console]::In.ReadToEnd(); Set-Clipboard -Value $value'], { input: config.token, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, timeout: 10000 });
        console.log(copied.status === 0 ? '令牌已复制。回到画布，粘贴到连接令牌后点击连接。' : '自动复制失败，请手动复制上面的连接令牌。');
    }
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || `命令执行失败：${path.basename(command)}（${result.status}）`);
}

function npm(args) {
    // Windows 的 npm 是批处理入口，参数全部由本脚本固定，不接受网页或用户拼接。
    if (process.platform === 'win32') run('cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`]);
    else run('npm', args);
}

export async function launch() {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('请安装 Node.js 22 或更新的 LTS 版本后重试。');
    const configFile = path.join(process.env.WENYUN_AGENT_HOME || path.join(homedir(), '.wenyun-canvas-agent'), 'canvas-agent.json');
    if (existsSync(configFile)) {
        const config = validateLocalConfig(JSON.parse(readFileSync(configFile, 'utf8')));
        if (await runningAgent(config)) {
            console.log('Canvas Agent 已在运行，无需重复启动。');
            showConnection(config);
            return;
        }
    }
    const hash = createHash('sha256').update(readFileSync(path.join(root, 'package-lock.json'))).digest('hex');
    const stamp = path.join(root, 'node_modules', '.wenyun-launcher-lock');
    const codex = path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== hash || !existsSync(codex) || !existsSync(path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'))) {
        console.log('首次启动或版本更新，正在准备依赖，请稍候……');
        npm(['ci', '--include=dev', '--include=optional', '--no-audit', '--no-fund']);
        writeFileSync(stamp, hash);
    }
    console.log('正在准备画布助手……');
    npm(['run', 'build']);
    const login = spawnSync(process.execPath, [codex, 'login', 'status'], { cwd: root, stdio: 'ignore' });
    if (login.error) throw login.error;
    if (login.status !== 0) {
        console.log('未检测到 Codex 登录。首次对话前，请双击同目录的“登录Codex.cmd”完成登录；已有自定义模型配置的用户可继续使用原配置。');
    }
    const { loadConfig } = await import('./dist/config.js');
    const config = loadConfig(true);
    // 与服务保持同一端口规则，避免继承其他应用的 PORT 后显示错误地址。
    config.url = `http://127.0.0.1:${Number(process.env.PORT) || Number(new URL(config.url).port) || 17371}`;
    if (await runningAgent(validateLocalConfig(config))) {
        showConnection(config);
        return;
    }
    console.log('正在启动，请保持此窗口打开。');
    const { startHttpServer } = await import('./dist/server/http.js');
    startHttpServer();
    for (let attempt = 0; attempt < 40; attempt++) {
        if (await runningAgent(config)) {
            showConnection(config);
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('启动超时，请检查端口占用或安全软件设置。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    launch().catch(error => { console.error(`\n${error.message}`); process.exitCode = 1; });
}
