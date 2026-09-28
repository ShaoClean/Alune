const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { connectProxySocket, createProxyDispatcher, createProxyBridge, SSHConnection } = require('../dist');
const { listen, httpProxy, socksProxy, forwardingSSH } = require('./helpers/proxy-fixture.cjs');

const config = (port, protocol = 'http') => ({ revision: 'fixture-1', enabled: true, protocol, host: '127.0.0.1', port });

for (const protocol of ['http', 'socks5']) test(`${protocol}: routes HTTP, credentials and proxy-side DNS; never sends proxy authorization to the origin`, async (t) => {
  const received = [];
  const origin = await listen(http.createServer((request, response) => { received.push(request.headers); response.end('via-proxy'); })); t.after(origin.close);
  const credentials = { username: 'test-user', password: 'test-password' };
  const proxy = await (protocol === 'http' ? httpProxy : socksProxy)({ credentials }); t.after(proxy.close);
  const dispatcher = createProxyDispatcher({ ...config(proxy.port, protocol), credentials }); t.after(() => dispatcher.destroy());
  const response = await fetch(`http://unresolvable.fixture.test:${origin.port}/`, { dispatcher });
  assert.equal(await response.text(), 'via-proxy');
  assert.equal(proxy.records[0].host, 'unresolvable.fixture.test');
  assert.equal(received[0]['proxy-authorization'], undefined);
  if (protocol === 'socks5') assert.equal(proxy.records[0].domain, true);
  await assert.rejects(connectProxySocket({ ...config(proxy.port, protocol), credentials: { ...credentials, password: 'wrong-secret' } }, 'unresolvable.fixture.test', origin.port), (error) => error.code === 'PROXY_AUTH' && !error.message.includes('wrong-secret'));
});

test('HTTPS proxies reject an untrusted certificate and closed proxies never fall back to direct', async (t) => {
  let hits = 0;
  const origin = await listen(http.createServer((_request, response) => { hits++; response.end('direct'); })); t.after(origin.close);
  const proxy = await httpProxy({ secure: true }); t.after(proxy.close);
  await assert.rejects(connectProxySocket(config(proxy.port, 'https'), '127.0.0.1', origin.port), (error) => error.code === 'PROXY_TLS');
  assert.equal(hits, 0);
  const refused = await httpProxy({ status: 403 }); t.after(refused.close);
  const dispatcher = createProxyDispatcher(config(refused.port)); t.after(() => dispatcher.destroy());
  await assert.rejects(fetch(`http://127.0.0.1:${origin.port}/`, { dispatcher }));
  assert.equal(hits, 0);
});

test('bridge preserves old tunnels and uses saved changes for new requests', async (t) => {
  const origin = await listen(http.createServer((_request, response) => response.end('ok'))); t.after(origin.close);
  const a = await httpProxy(), b = await socksProxy(); t.after(a.close); t.after(b.close);
  let saved = config(a.port);
  const bridge = await createProxyBridge(() => saved); t.after(bridge.close);
  const old = await connectProxySocket(config(bridge.port), 'origin.fixture.test', origin.port); t.after(() => old.destroy());
  saved = config(b.port, 'socks5');
  const dispatcher = createProxyDispatcher(config(bridge.port)); t.after(() => dispatcher.destroy());
  assert.equal(await (await fetch(`http://origin.fixture.test:${origin.port}/`, { dispatcher })).text(), 'ok');
  assert.equal(a.records.length, 1); assert.equal(b.records.length, 1);
  assert.equal(old.destroyed, false);
});

test('SSH connects through the proxy; forwarding, busy tasks, and disconnect cleanup are distinct', { skip: process.platform === 'win32' }, async (t) => {
  const server = await forwardingSSH(); t.after(server.close);
  const proxy = await socksProxy(); t.after(proxy.close);
  const connection = new SSHConnection({ host: 'ssh.fixture.test', port: server.port, username: 'test', proxy: config(proxy.port, 'socks5') });
  connection.on('error', () => {}); t.after(() => connection.disconnect());
  await connection.connect(); await connection.prepareGitProxy();
  assert.equal(connection.connected, true); assert.equal(connection.forwarding, 'ready');
  assert.equal(proxy.records[0].host, 'ssh.fixture.test'); assert.equal(server.forwards.size, 1);
  const running = connection.execCommand('sleep 0.2');
  assert.ok(connection.activeTasks > 0); await running; assert.equal(connection.activeTasks, 0);
  connection.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(server.forwards.size, 0);
});

test('forwarding denied or forced wildcard binding leaves SSH usable and closes the listener', { skip: process.platform === 'win32' }, async (t) => {
  for (const options of [{ deny: true }, { wildcard: true }]) {
    const server = await forwardingSSH(options), proxy = await httpProxy(); t.after(server.close); t.after(proxy.close);
    const connection = new SSHConnection({ host: '127.0.0.1', port: server.port, username: 'test', proxy: config(proxy.port) }); connection.on('error', () => {}); t.after(() => connection.disconnect());
    await connection.connect(); await assert.rejects(connection.prepareGitProxy());
    assert.equal(connection.connected, true); assert.equal(connection.forwarding, options.deny ? 'denied' : 'error');
    await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(server.forwards.size, 0);
    assert.equal((await connection.execCommand('printf ssh-ok')).stdout, 'ssh-ok');
  }
});
