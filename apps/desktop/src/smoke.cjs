const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { writeFileSync } = require('node:fs');

module.exports = async ({ window, origin, token, updates, closeBackend, backend, version }) => {
  if (process.env.REMOTE_GIT_SMOKE_PHASE === 'restore') {
    await require('./sidebar-smoke.cjs')({ window, origin, token, restore: true });
    return;
  }
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
  await waitForUI(window, `document.querySelector('.sidebar-footer__version')?.textContent === ${JSON.stringify(`v${version}`)}`);
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
  assert.ok(renderer.text.includes(`v${version}`));
  assert.deepEqual(await window.webContents.executeJavaScript(`Object.keys(window.desktopUpdates).sort()`),
    ['cancel', 'check', 'download', 'getState', 'install', 'openFile', 'revealFile', 'subscribe'].sort());
  assert.equal(await window.webContents.executeJavaScript(`typeof window.desktopUpdates.send`), 'undefined');
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="设置"]').click()`);
  await waitForUI(window, `document.querySelector('[data-testid="update-panel"]') && document.body.innerText.includes('检查更新')`);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.replace(/\\s/g, '') === '检查更新').click()`);
  await waitForUI(window, `document.body.innerText.includes('发现新版本')`);
  assert.equal(updates.getState().status, 'available');
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.replace(/\\s/g, '') === '下载更新').click()`);
  await waitForUI(window, `document.body.innerText.includes('正在下载安装包')`);
  // Refresh while downloading: the main process owns the operation and snapshot.
  await new Promise((resolve) => {
    window.webContents.once('did-finish-load', resolve);
    window.webContents.reload();
  });
  await waitForUI(window, `document.querySelector('.app-shell') && window.desktopUpdates`);
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="设置"]').click()`);
  await waitForUI(window, `document.body.innerText.includes('安装包已下载并通过校验')`);
  assert.equal(updates.getState().status, 'downloaded');
  assert.equal(updates.getState().installMode, 'restart');
  assert.equal(updates.adapter.installs, 0);
  await waitForUI(window, `Array.from(document.querySelectorAll('[data-testid="update-panel"] button')).some(button => button.textContent.replace(/\\s/g, '') === '重启安装')`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="update-panel"]').innerText.includes('打开安装包')`), false);
  assert.equal(await window.webContents.executeJavaScript(`window.desktopUpdates.getState().then(state => state.latestVersion)`), updates.getState().latestVersion);
  assert.equal(await window.webContents.executeJavaScript(`new Promise(resolve => {
    const frame = document.createElement('iframe');
    frame.src = '/';
    frame.onload = async () => {
      try { await frame.contentWindow.desktopUpdates.check(); resolve(false); }
      catch { resolve(true); }
      finally { frame.remove(); }
    };
    document.body.append(frame);
  })`), true);
  if (process.env.REMOTE_GIT_SMOKE_SCREENSHOT) {
    // Hidden packaged windows can throttle the modal entrance animation indefinitely.
    const style = await window.webContents.insertCSS('.ant-modal, .ant-modal-mask { animation: none !important; transition: none !important; opacity: 1 !important; transform: none !important; }');
    try {
      writeFileSync(process.env.REMOTE_GIT_SMOKE_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    } finally { await window.webContents.removeInsertedCSS(style); }
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
  await require('./repository-loading-smoke.cjs')({ window, origin, token, backend });
  await require('./sidebar-smoke.cjs')({ window, origin, token, restore: false });
  // Keep an upgraded connection alive to reproduce shutdown hangs seen in packaged apps.
  const pendingSocket = new WebSocket(`${origin.replace('http:', 'ws:')}/socket.io/?EIO=4&transport=websocket`, { headers });
  await new Promise((resolve, reject) => { pendingSocket.once('open', resolve); pendingSocket.once('error', reject); });
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="设置"]').click()`);
  await waitForUI(window, `Array.from(document.querySelectorAll('[data-testid="update-panel"] button')).some(button => button.textContent.replace(/\\s/g, '') === '重启安装')`);
  let timeout;
  try {
    await Promise.race([
      Promise.all([
        new Promise((resolve) => pendingSocket.once('close', resolve)),
        (async () => {
          await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="update-panel"] button')).find(button => button.textContent.replace(/\\s/g, '') === '重启安装').click()`);
          await waitForUI(window, `document.body.innerText.includes('正在准备更新并重启安装')`);
          await updates.active?.promise;
          assert.equal(updates.adapter.installs, 1);
          assert.equal(updates.getState().status, 'installing');
        })(),
      ]),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Backend did not close its live connections')), 3000); }),
    ]);
  } finally { clearTimeout(timeout); pendingSocket.terminate(); }
  await assert.rejects(fetch(`${origin}/api/connections`, { headers }));
  console.log('Desktop smoke passed: UI, routing, SQLite CRUD, authentication, sandbox, update settings, download across refresh, restart-install button and backend shutdown.');
};

async function waitForUI(window, condition) {
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (${condition}) return resolve(true);
      if (Date.now() - started > 10000) return reject(new Error('Expected update UI did not appear'));
      setTimeout(check, 50);
    };
    check();
  })`);
}

// Only selected by the isolated --smoke-test boot path; never connects to GitHub or installs.
module.exports.createUpdateAdapter = (version) => ({
  installs: 0,
  async check() { return { version: require('semver').inc(version, 'patch'), releaseNotes: 'Smoke release notes' }; },
  async download(signal, progress) {
    for (let percent = 0; percent <= 100; percent += 10) {
      signal.throwIfAborted();
      progress({ percent, transferred: percent, total: 100, bytesPerSecond: 100 });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return '/mock/verified-installer';
  },
  async install() { this.installs++; },
  async openFile() {},
});
