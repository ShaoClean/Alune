const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { SSHConnection } = require('../dist');
const { listen, forwardingSSH } = require('./helpers/proxy-fixture.cjs');

test('keepalive drops a connection whose network went silent so the next request reconnects', { skip: process.platform === 'win32' }, async (t) => {
  const server = await forwardingSSH(); t.after(server.close);
  // A relay that can stop forwarding without closing either side, like a NAT dropping an idle mapping.
  let silent = false;
  const sockets = new Set();
  const relay = await listen(net.createServer((client) => {
    const upstream = net.connect(server.port, '127.0.0.1');
    for (const socket of [client, upstream]) { sockets.add(socket); socket.on('error', () => {}); }
    client.on('data', (chunk) => { if (!silent) upstream.write(chunk); });
    upstream.on('data', (chunk) => { if (!silent) client.write(chunk); });
  }));
  t.after(() => { for (const socket of sockets) socket.destroy(); relay.close(); });

  const connection = new SSHConnection({ host: '127.0.0.1', port: relay.port, username: 'test', keepaliveInterval: 100, keepaliveCountMax: 2 });
  connection.on('error', () => {}); t.after(() => connection.disconnect());
  await connection.connect();
  assert.equal((await connection.execCommand('echo ok')).stdout.trim(), 'ok');

  silent = true;
  const started = Date.now();
  await new Promise((resolve) => connection.once('disconnect', resolve));
  assert.equal(connection.connected, false);
  assert.ok(Date.now() - started < 2000);
});
