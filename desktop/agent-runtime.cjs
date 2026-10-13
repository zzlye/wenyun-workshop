const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { atomicWrite } = require('./storage.cjs');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('exit', resolve);
      killer.once('error', resolve);
    });
  } else {
    child.kill('SIGTERM');
  }
}

class AgentRuntime {
  constructor({ home, runtimeRoot, executable = process.execPath }) {
    this.home = home;
    this.runtimeRoot = runtimeRoot;
    this.executable = executable;
    this.child = null;
    this.loginChild = null;
    this.starting = null;
    this.connection = null;
    this.closing = false;
  }

  env() { return { ...process.env, ELECTRON_RUN_AS_NODE: '1', WENYUN_AGENT_HOME: this.home }; }

  ensure() {
    if (this.closing) return Promise.reject(new Error('桌面程序正在退出'));
    if (this.starting) return this.starting;
    if (this.connection && this.child?.exitCode === null && this.child?.signalCode === null) return Promise.resolve(this.connection);
    this.starting = this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  async start() {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const configFile = path.join(this.home, 'canvas-agent.json');
    let config = {};
    try { config = JSON.parse(await fs.readFile(configFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('本机助手配置无法读取'); }
    const token = config.token || crypto.randomBytes(32).toString('hex');
    await atomicWrite(configFile, JSON.stringify({ ...config, url, token, origins: ['wenyun://app'] }));
    if (this.closing) throw new Error('桌面程序正在退出');
    const child = spawn(this.executable, [path.join(this.runtimeRoot, 'dist/index.js')], {
      cwd: this.home, env: { ...this.env(), PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    });
    this.child = child;
    let spawnError;
    child.once('error', (error) => { spawnError = error; });
    // 只保留启动错误供诊断，不记录 stdout 中的连接令牌。
    let stderr = '';
    child.stderr.on('data', (data) => { stderr = `${stderr}${data}`.slice(-2048); });
    child.once('exit', () => { if (this.child === child) this.connection = null; });
    try {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && !this.closing) {
        if (spawnError || child.exitCode !== null) throw new Error('本机助手启动失败，请检查安装文件是否完整');
        try {
          const response = await fetch(`${url}/config`, { headers: { 'x-canvas-agent-token': token }, signal: AbortSignal.timeout(800) });
          const info = await response.json();
          if (response.ok && info.ok && info.url === url) {
            this.connection = { url, token };
            return this.connection;
          }
        } catch { /* 服务尚未就绪时继续等待，不向用户暴露内部令牌。 */ }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(stderr.includes('EADDRINUSE') ? '本机助手端口被占用，请重新连接' : '本机助手启动超时，请重新连接');
    } catch (error) {
      await stopChild(child);
      throw error;
    }
  }

  async login() {
    if (this.loginChild?.exitCode === null) throw new Error('登录窗口已经打开');
    await fs.mkdir(this.home, { recursive: true });
    const entry = path.join(this.runtimeRoot, 'node_modules/@openai/codex/bin/codex.js');
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, [entry, 'login'], { cwd: this.home, env: this.env(), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      this.loginChild = child;
      child.stderr.resume();
      const timeout = setTimeout(() => { void stopChild(child); }, 10 * 60_000);
      child.once('error', () => { clearTimeout(timeout); reject(new Error('无法打开 Codex 登录')); });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error('Codex 登录未完成，请重试'));
      });
    });
  }

  async stop() {
    this.closing = true;
    await stopChild(this.loginChild);
    await stopChild(this.child);
    await this.starting?.catch(() => undefined);
  }
}

module.exports = { AgentRuntime };
