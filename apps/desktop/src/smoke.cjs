const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { writeFileSync } = require('node:fs');

module.exports = async ({ window, origin, token }) => {
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(`${origin}/api/connections`)).status, 401);
  assert.equal((await fetch(`${origin}/api/connections`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(`${origin}/api/missing`, { headers })).status, 404);
  assert.equal((await fetch(`${origin}/repositories/example`, { headers })).status, 200);
  assert.deepEqual(await (await fetch(`${origin}/api/connections`, { headers })).json(), []);
  const created = await (await fetch(`${origin}/api/connections`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Desktop smoke', host: '127.0.0.1', port: 22, username: 'smoke', authType: 'password', password: 'test-only' }),
  })).json();
  assert.ok(created.id);
  const connections = await (await fetch(`${origin}/api/connections`, { headers })).json();
  assert.equal(connections.length, 1);
  assert.equal(connections[0].password, undefined);

  // Verify renderer sandbox, real UI mounting and the main-process request credential.
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (document.querySelector('.app-shell')) return resolve(true);
      if (Date.now() - started > 10000) return reject(new Error('React UI did not mount'));
      setTimeout(check, 50);
    };
    check();
  })`);
  const renderer = await window.webContents.executeJavaScript(`(async () => ({
    node: typeof process,
    require: typeof require,
    status: (await fetch('/api/connections')).status,
    text: document.body.innerText,
  }))()`);
  assert.equal(renderer.node, 'undefined');
  assert.equal(renderer.require, 'undefined');
  assert.equal(renderer.status, 200);
  assert.match(renderer.text, /RemoteGit/);
  if (process.env.REMOTE_GIT_SMOKE_SCREENSHOT) {
    writeFileSync(process.env.REMOTE_GIT_SMOKE_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  }
  await window.loadURL(`${origin}/repositories`);
  await new Promise((resolve) => {
    window.webContents.once('did-finish-load', resolve);
    window.webContents.reload();
  });
  // The native WebSocket verifies Electron also adds credentials to upgrade requests.
  assert.equal(await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const socket = new WebSocket(${JSON.stringify(origin.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket')});
    socket.onmessage = (event) => { socket.close(); resolve(event.data.startsWith('0')); };
    socket.onerror = () => reject(new Error('WebSocket failed'));
  })`), true);
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/socket.io/?EIO=4&transport=websocket`);
    socket.on('unexpected-response', (_request, response) => {
      try { assert.ok([400, 403].includes(response.statusCode)); response.resume(); socket.terminate(); resolve(); } catch (error) { reject(error); }
    });
    socket.on('open', () => { socket.close(); reject(new Error('Unauthenticated WebSocket accepted')); });
    socket.on('error', () => {});
  });
  assert.equal((await fetch(`${origin}/api/connections/${created.id}`, { method: 'DELETE', headers })).status, 200);
  console.log('Desktop smoke passed: UI, routing, SQLite CRUD, HTTP/WebSocket authentication and renderer sandbox.');
};
