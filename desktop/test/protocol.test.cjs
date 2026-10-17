const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProtocolHandler, resolveProxy, isAppUrl, isAppDocumentUrl } = require('../protocol.cjs');

test('固定代理及本机异步任务不依赖网站部署', () => {
  assert.equal(resolveProxy(new URL('wenyun://app/api-proxy/wenyun/images/edits?q=1')).url.href, 'https://api.xn--v5z30ywuk.com/v1/images/edits?q=1');
  assert.equal(resolveProxy(new URL('wenyun://app/newapi-proxy/public/api/user/self')).url.href, 'https://1520635.xyz:3901/api/user/self');
  assert.equal(resolveProxy(new URL('wenyun://app/image-tasks/one'), 'http://127.0.0.1:2345').url.href, 'http://127.0.0.1:2345/image-tasks/one');
});

test('本机任务提交和认领使用独立直连，系统代理只处理远端接口', async () => {
  const localCalls = [];
  const remoteCalls = [];
  const handler = createProtocolHandler({
    webRoot: 'D:/tmp/unused-web', taskOrigin: 'http://127.0.0.1:2345',
    fetch: async (url) => { remoteCalls.push(url); return new Response('remote'); },
    fetchLocal: async (url, init) => { localCalls.push({ url, method: init.method, body: init.body }); return new Response('{}'); },
  });
  await handler(new Request('wenyun://app/image-tasks?endpoint=/images/edits', { method: 'POST', body: 'reference' }));
  await handler(new Request('wenyun://app/image-tasks/recover'));
  assert.equal(localCalls.length, 2);
  assert.equal(Buffer.from(localCalls[0].body).toString(), 'reference');
  assert.equal(localCalls[1].url, 'http://127.0.0.1:2345/image-tasks/recover');
  assert.deepEqual(remoteCalls, []);
  await handler(new Request('wenyun://app/newapi-proxy/wenyun/api/user/self'));
  assert.deepEqual(remoteCalls, ['https://api.xn--v5z30ywuk.com/api/user/self']);
});

test('本机连接失败保留安全错误码和诊断号，不泄露异常中的密钥', async () => {
  const events = [];
  const handler = createProtocolHandler({
    webRoot: 'D:/tmp/unused-web', taskOrigin: 'http://127.0.0.1:2345',
    fetch: async () => { throw Error('不应请求远端'); },
    fetchLocal: async () => { throw Error('net::ERR_CONNECTION_RESET https://secret.invalid/?key=private-token'); },
    onTaskDiagnostic: event => events.push(event),
  });
  const response = await handler(new Request('wenyun://app/image-tasks', { method: 'POST', body: 'private-prompt' }));
  const payload = await response.json();
  assert.equal(response.status, 502);
  assert.match(payload.error.message, /ERR_CONNECTION_RESET/);
  assert.equal(events[0].stage, 'connect_local');
  assert.equal(events[0].operation, 'submit');
  assert.equal(events[0].id, response.headers.get('X-Wenyun-Diagnostic-Id'));
  assert.doesNotMatch(JSON.stringify({ events, payload }), /private-|secret.invalid/);
});

test('提交内容读取失败时不会调用本机任务服务，并记录发生阶段', async () => {
  let requests = 0;
  const events = [];
  const handler = createProtocolHandler({
    webRoot: 'D:/tmp/unused-web', taskOrigin: 'http://127.0.0.1:2345',
    fetch: async () => { requests++; return new Response('{}'); },
    onTaskDiagnostic: event => events.push(event),
  });
  const request = new Request('wenyun://app/image-tasks', { method: 'POST', body: 'fixture' });
  request.arrayBuffer = async () => { throw Error('net::ERR_UPLOAD_FILE_CHANGED'); };
  const response = await handler(request);
  assert.match((await response.json()).error.message, /ERR_UPLOAD_FILE_CHANGED/);
  assert.equal(requests, 0);
  assert.equal(events[0].stage, 'read_body');
});

test('自定义接口只允许 HTTP(S)，禁止 URL 中夹带账号', () => {
  assert.equal(resolveProxy(new URL('wenyun://app/desktop-api/https/custom.example/v1/images/generations')).url.href, 'https://custom.example/v1/images/generations');
  assert.throws(() => resolveProxy(new URL('wenyun://app/desktop-api/https/user:password@custom.example/v1')));
  assert.equal(resolveProxy(new URL('wenyun://app/desktop-api/file/C:/secret')), null);
});

test('账户登录、支付和刷新会话均连接西米露新域名', () => {
  for (const path of ['/newapi-proxy/wenyun/api/user/login', '/newapi-proxy/wenyun/api/user/alipay-receipt/pay', '/api/user/auth/refresh']) {
    const route = resolveProxy(new URL(`wenyun://app${path}`));
    assert.equal(route.url.origin, 'https://api.xn--v5z30ywuk.com');
    assert.equal(route.cookies, true);
  }
});

test('接口代理及外部网页不能成为拥有桌面权限的页面', () => {
  assert.ok(isAppUrl('wenyun://app/canvas/abc'));
  assert.ok(isAppDocumentUrl('wenyun://app/canvas/abc'));
  assert.ok(!isAppUrl('https://app/'));
  assert.ok(!isAppUrl('wenyun://app.evil/'));
  assert.ok(!isAppDocumentUrl('wenyun://app/desktop-api/https/evil.example/'));
  assert.ok(!isAppDocumentUrl('wenyun://app/newapi-proxy/wenyun/'));
  assert.ok(!isAppDocumentUrl('wenyun://app/api/user/self'));
});

test('请求体与图像参数完整保留，响应流不被重复编码', async () => {
  let observed;
  const handler = createProtocolHandler({ webRoot: 'D:/tmp/unused-web', fetch: async (url, options) => {
    observed = { url, options };
    return new Response('data: chunk\n\n', { headers: { 'content-type': 'text/event-stream', 'content-encoding': 'gzip', 'content-length': '10' } });
  } });
  const payload = { model: 'test', quality: 'high', background: 'transparent', size: '4096x4096', response_format: 'url' };
  const response = await handler(new Request('wenyun://app/api-proxy/wenyun/images/generations', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-key', origin: 'wenyun://app', cookie: 'local-secret' }, body: JSON.stringify(payload) }));
  assert.deepEqual(JSON.parse(Buffer.from(observed.options.body).toString()), payload);
  assert.equal(observed.options.headers.get('authorization'), 'Bearer test-key');
  assert.equal(observed.options.headers.get('cookie'), null);
  assert.equal(observed.options.headers.get('origin'), 'https://api.xn--v5z30ywuk.com');
  assert.equal(response.headers.get('content-encoding'), null);
  assert.equal(await response.text(), 'data: chunk\n\n');
});

test('素材代理拒绝写请求且不转发账号凭证', async () => {
  let options;
  const handler = createProtocolHandler({ webRoot: 'D:/tmp/unused-web', fetch: async (_url, init) => { options = init; return new Response('image'); } });
  const endpoint = 'wenyun://app/asset-proxy/https/cdn.example/image.png';
  assert.equal((await handler(new Request(endpoint, { method: 'POST' }))).status, 405);
  await handler(new Request(endpoint, { headers: { authorization: 'Bearer secret', cookie: 'secret' } }));
  assert.equal(options.headers.get('authorization'), null);
  assert.equal(options.credentials, 'omit');
});

test('无效来源和静态路径穿越不会读取文件', async () => {
  let requested = false;
  const handler = createProtocolHandler({ webRoot: 'D:/tmp/unused-web', fetch: async () => { requested = true; return new Response('bad'); } });
  assert.equal((await handler(new Request('wenyun://evil/'))).status, 403);
  assert.equal((await handler(new Request('wenyun://app/%2e%2e%2fsecret.txt'))).status, 403);
  assert.equal((await handler(new Request('wenyun://app/api/unknown'))).status, 404);
  assert.equal(requested, false);
});
