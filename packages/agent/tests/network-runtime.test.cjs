const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { ProxyRuntime } = require('../dist/adapters/network/runtime');
const { spawnAgent } = require('@alune/agent-client/node');
const fixture = path.resolve(__dirname, 'settings-fixture.cjs');
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
function throughBridge(port, target) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: target }, (response) => {
      let body = '';
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode, body }));
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}
test(
  'explicit fetch and updater bridge fail closed when proxy authentication fails',
  { timeout: 30000 },
  async (t) => {
    let direct = 0,
      auth = '';
    const destination = http.createServer((_request, response) => {
      direct++;
      response.end('fixture-destination');
    });
    const badProxy = http.createServer();
    badProxy.on('connect', (request, socket) => {
      auth = request.headers['proxy-authorization'];
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');
    });
    const destinationPort = await listen(destination),
      proxyPort = await listen(badProxy);
    let snapshot = {
      revision: 'first',
      enabled: false,
      protocol: 'http',
      host: '127.0.0.1',
      port: proxyPort,
    };
    const settings = {
      snapshot: () => snapshot,
      read: () => ({
        ...snapshot,
        authEnabled: Boolean(snapshot.credentials),
        hasCredentials: Boolean(snapshot.credentials),
        secretStorageAvailable: true,
      }),
    };
    const runtime = new ProxyRuntime(settings);
    t.after(async () => {
      await runtime.close();
      await close(destination);
      await close(badProxy);
    });
    const target = `http://127.0.0.1:${destinationPort}/fixture`;
    assert.equal(await (await runtime.fetch(target)).text(), 'fixture-destination');
    const bridge = await runtime.updaterBridge();
    assert.equal((await throughBridge(bridge.port, target)).body, 'fixture-destination');
    assert.equal(direct, 2);
    snapshot = {
      ...snapshot,
      revision: 'second',
      enabled: true,
      credentials: { username: 'fixture-user', password: 'fixture-password' },
    };
    await assert.rejects(runtime.fetch(target));
    const failure = await throughBridge(bridge.port, target);
    assert.equal(failure.status, 502);
    assert.equal(direct, 2, 'failed proxy must never reach the destination directly');
    assert.equal(auth, 'Basic ' + Buffer.from('fixture-user:fixture-password').toString('base64'));
    const changed = await runtime.updaterBridge();
    assert.equal(changed.port, bridge.port);
    assert.equal(changed.revision, 'second');
    assert.doesNotMatch(JSON.stringify(changed), /fixture-password|fixture-user/);
    snapshot = { ...snapshot, revision: 'third', enabled: false };
    assert.equal((await throughBridge(bridge.port, target)).body, 'fixture-destination');
    await runtime.close();
    await assert.rejects(runtime.updaterBridge(), (e) => e.kind === 'unavailable');
    assert.throws(
      () => runtime.fetch(target),
      (e) => e.kind === 'unavailable',
    );
  },
);
test(
  'Agent updater port is scoped to its host and closes with the owning process',
  { timeout: 60000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-updater-rpc-'));
    const child = spawnAgent(process.execPath, [fixture, root]);
    t.after(async () => {
      await child.close();
      fs.rmSync(root, { recursive: true, force: true });
    });
    const identity = await child.client.initialize();
    const bridge = await child.client.updaterBridge();
    assert.equal(bridge.agentId, identity.agentId);
    assert.equal(bridge.scope, 'agent-loopback');
    assert.equal(bridge.enabled, false);
    assert(bridge.port > 0);
    const socket = net.connect({ host: '127.0.0.1', port: bridge.port });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    const disconnected = new Promise((resolve) => socket.once('close', resolve));
    await child.close();
    await disconnected;
    assert.equal((await child.exited).code, 0);
    await new Promise((resolve, reject) => {
      const probe = net.connect({ host: '127.0.0.1', port: bridge.port });
      probe.once('connect', () => {
        probe.destroy();
        reject(Error('Owned updater port remained open'));
      });
      probe.once('error', resolve);
    });
  },
);
