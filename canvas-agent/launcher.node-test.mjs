import assert from 'node:assert/strict';
import test from 'node:test';
import { runningAgent, validateLocalConfig } from './launcher.mjs';

const config = { url: 'http://127.0.0.1:17371', token: 'test-token' };

test('本机配置保留令牌和回环地址', () => {
    assert.deepEqual(validateLocalConfig(config), config);
});

test('拒绝远程地址、用户名和附加路径，防止令牌发送给第三方', () => {
    for (const url of ['https://example.com', 'http://127.0.0.1:17371/v1', 'http://user@127.0.0.1:17371', 'http://127.0.0.1:17371/?token=other']) {
        assert.throws(() => validateLocalConfig({ ...config, url }));
    }
    assert.throws(() => validateLocalConfig({ ...config, token: '' }));
});

test('未启动服务时继续启动，连接异常不误报为可用端口', async () => {
    assert.equal(await runningAgent(config, async () => { throw new Error('fetch failed', { cause: { code: 'ECONNREFUSED' } }); }), false);
    await assert.rejects(runningAgent(config, async () => { throw new Error('timeout'); }), /端口没有正常响应/);
});

test('复用已有服务前校验协议和令牌，不重复启动', async () => {
    const requests = [];
    const result = await runningAgent(config, async (url, init) => {
        requests.push([url, init]);
        return Response.json(url.endsWith('/config') ? { protocolVersion: 6, url: config.url } : { ok: true });
    });
    assert.equal(result, true);
    assert.equal(requests.length, 2);
    assert.equal(requests[1][1].headers['x-canvas-agent-token'], config.token);
    assert.equal(requests.some(([url]) => url.includes(config.token)), false);
});

test('端口被其他服务占用时不继续发送令牌', async () => {
    let calls = 0;
    await assert.rejects(runningAgent(config, async () => { calls++; return Response.json({ ok: true }); }), /端口已被其他服务占用/);
    assert.equal(calls, 1);
});

test('已有服务拒绝令牌时明确失败', async () => {
    await assert.rejects(runningAgent(config, async url => url.endsWith('/config')
        ? Response.json({ protocolVersion: 6, url: config.url })
        : new Response('', { status: 401 })), /令牌与本机配置不一致/);
});
