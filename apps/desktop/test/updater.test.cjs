const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { UpdateService, stableVersion } = require('../src/update-service.cjs');
const { createMacUpdater, githubFetch, checksumFor } = require('../src/mac-updater.cjs');
const { createElectronUpdater } = require('../src/electron-updater-adapter.cjs');
const { registerUpdateIPC, trustedSender } = require('../src/update-ipc.cjs');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function service(adapter = {}, options = {}) {
  return new UpdateService({ version: '1.0.0', platform: 'win32', closeBackend: async () => {}, adapter: {
    check: async () => ({ version: '1.1.0', releaseNotes: 'Notes' }), download: async () => '/verified.exe',
    install: async () => {}, ...adapter,
  }, ...options });
}

test('stable SemVer comparison rejects prereleases, invalid tags, equal versions and downgrades', async () => {
  assert.equal(stableVersion('v1.2.3'), '1.2.3');
  for (const value of ['1.1.0-beta.1', 'nonsense', null]) assert.equal(stableVersion(value), null);
  for (const version of ['1.0.0', '0.9.0', '1.1.0-beta.1', 'bad']) {
    const updater = service({ check: async () => ({ version }) });
    assert.equal((await updater.check()).status, 'not-available');
    assert.equal((await updater.download()).status, 'not-available');
  }
  assert.equal((await service({ check: async () => ({ version: '1.10.0' }) }).check()).latestVersion, '1.10.0');
});

test('concurrent checks/downloads share work; snapshots survive UI subscriptions', async () => {
  const check = deferred(), download = deferred();
  let checks = 0, downloads = 0;
  const updater = service({ check: () => { checks++; return check.promise; }, download: () => { downloads++; return download.promise; } });
  const first = updater.check({ background: true });
  const second = updater.check();
  assert.equal(first, second);
  check.resolve({ version: '1.1.0' });
  await first;
  assert.equal(checks, 1);
  assert.equal(updater.getState().background, false);
  const listener = () => {};
  updater.on('state', listener);
  const d1 = updater.download(), d2 = updater.download();
  assert.equal(d1, d2);
  updater.off('state', listener);
  download.resolve('/verified.exe');
  await d1;
  assert.equal(downloads, 1);
  assert.equal(updater.getState().status, 'downloaded');
  assert.equal((await updater.check()).status, 'downloaded');
  assert.equal(checks, 1);
});

test('cancellation is recoverable and a failed download can be retried', async () => {
  let attempts = 0;
  const updater = service({ download: (signal) => {
    attempts++;
    if (attempts === 1) return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    if (attempts === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return '/verified.exe';
  } });
  await updater.check();
  const downloading = updater.download();
  await tick();
  await updater.cancel();
  await downloading;
  assert.equal(updater.getState().status, 'available');
  assert.match((await updater.download()).error.message, /磁盘空间不足/);
  assert.equal((await updater.download()).status, 'downloaded');
});

test('unsupported development mode never contacts the update source', async () => {
  const updater = service({ check: () => assert.fail('must not contact GitHub') }, { supported: false });
  assert.equal((await updater.check()).error.action, 'check');
});

test('install only runs after an explicit request and successful backend cleanup', async () => {
  const order = [], cleanup = deferred();
  const updater = service({ install: async () => { order.push('install'); } }, {
    closeBackend: async () => { order.push('closing'); await cleanup.promise; order.push('closed'); },
  });
  await updater.install();
  await updater.check();
  await updater.download();
  assert.deepEqual(order, []);
  const installing = updater.install();
  await tick();
  assert.deepEqual(order, ['closing']);
  cleanup.resolve();
  await installing;
  assert.deepEqual(order, ['closing', 'closed', 'install']);
});

test('failed or timed-out cleanup never installs, including late cleanup completion', async () => {
  for (const fails of [true, false]) {
    const cleanup = deferred();
    let installed = false;
    const updater = service({ install: async () => { installed = true; } }, {
      cleanupTimeout: 15, closeBackend: () => fails ? Promise.reject(new Error('close failed')) : cleanup.promise,
    });
    await updater.check(); await updater.download();
    assert.equal((await updater.install()).error.action, 'install');
    cleanup.resolve(); await tick();
    assert.equal(installed, false);
  }
});

test('macOS never auto-installs and only opens the verified download path', async () => {
  const opened = [];
  const updater = service({ openFile: async (...args) => opened.push(args), install: () => assert.fail('manual only') }, { platform: 'darwin' });
  await updater.openFile();
  assert.deepEqual(opened, []);
  await updater.check(); await updater.download(); await updater.install(); await updater.openFile(true);
  assert.deepEqual(opened, [['/verified.exe', true]]);
});

test('a manually deleted DMG can be downloaded again', async () => {
  const updater = service({ openFile: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } }, { platform: 'darwin' });
  await updater.check(); await updater.download();
  assert.equal((await updater.openFile()).error.action, 'download');
  assert.equal((await updater.download()).status, 'downloaded');
});

test('IPC rejects other windows, child frames, external origins and all renderer arguments', async () => {
  const frame = { url: 'http://127.0.0.1:4567/repositories' };
  const contents = { mainFrame: frame, getURL: () => frame.url, send() {} };
  const window = { isDestroyed: () => false, webContents: contents };
  const event = { sender: contents, senderFrame: frame };
  const origin = 'http://127.0.0.1:4567';
  assert.equal(trustedSender(event, window, origin), true);
  assert.equal(trustedSender({ ...event, sender: {} }, window, origin), false);
  assert.equal(trustedSender({ ...event, senderFrame: { url: frame.url } }, window, origin), false);
  frame.url = 'https://example.com';
  assert.equal(trustedSender(event, window, origin), false);
  frame.url = origin;
  const handlers = new Map();
  const updater = service();
  const dispose = registerUpdateIPC({ ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: (name) => handlers.delete(name) },
    service: updater, getWindow: () => window, getOrigin: () => origin });
  assert.throws(() => handlers.get('updates:download')(event, 'https://evil.example/payload'));
  assert.equal(handlers.get('updates:state')(event).currentVersion, '1.0.0');
  dispose();
  assert.equal(handlers.size, 0);
  assert.equal(updater.listenerCount('state'), 0);
});

async function macFixture(t, { arch = 'arm64', mutate = () => {}, downloadBody, checksum, fetchError, downloadFetch, idleTimeout } = {}) {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'remote-git-update-test-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const data = Buffer.from('test DMG bytes');
  const name = `RemoteGit-1.1.0-mac-${arch}.dmg`;
  const url = `https://github.com/ShaoClean/remote-git/releases/download/v1.1.0/`;
  const release = { tag_name: 'v1.1.0', body: 'Release notes', draft: false, prerelease: false,
    assets: [
      { name, size: data.length, browser_download_url: url + name },
      { name: 'SHA256SUMS', browser_download_url: url + 'SHA256SUMS' },
    ] };
  mutate(release);
  const requested = [];
  const adapter = createMacUpdater({ version: '1.0.0', arch, cacheDir, idleTimeout, shell: { openPath: async () => '', showItemInFolder() {} }, fetchImpl: async (url, options) => {
    requested.push(url);
    if (fetchError) throw new Error('network unavailable');
    if (url.includes('/releases/latest')) return new Response(JSON.stringify(release));
    if (url.endsWith('/SHA256SUMS')) return new Response(`${checksum || createHash('sha256').update(data).digest('hex')}  ${name}\n`);
    return downloadFetch ? downloadFetch(options.signal) : new Response(downloadBody || data);
  } });
  return { adapter, cacheDir, data, name, requested };
}

test('macOS selects the correct architecture, verifies SHA-256 and atomically completes the DMG', async (t) => {
  for (const arch of ['arm64', 'x64']) {
    const { adapter, cacheDir, data, name, requested } = await macFixture(t, { arch });
    assert.equal((await adapter.check(new AbortController().signal)).version, '1.1.0');
    const progress = [];
    const file = await adapter.download(new AbortController().signal, (value) => progress.push(value));
    assert.equal(file, path.join(cacheDir, name));
    assert.deepEqual(await readFile(file), data);
    assert.deepEqual(await readdir(cacheDir), [name]);
    assert.equal(progress.at(-1).percent, 100);
    assert.ok(requested.at(-1).endsWith(name));
  }
});

test('macOS rejects incomplete, corrupt or oversized downloads and removes partial files', async (t) => {
  for (const options of [{ checksum: '0'.repeat(64) }, { downloadBody: Buffer.from('short') }, { downloadBody: Buffer.alloc(500) }]) {
    const { adapter, cacheDir } = await macFixture(t, options);
    await adapter.check(new AbortController().signal);
    await assert.rejects(adapter.download(new AbortController().signal, () => {}), /校验失败|超过声明大小/);
    assert.deepEqual(await readdir(cacheDir), []);
  }
});

test('macOS removes partial downloads on cancellation and stalled response timeout', async (t) => {
  for (const cancel of [true, false]) {
    const controller = new AbortController();
    const { adapter, cacheDir } = await macFixture(t, {
      idleTimeout: 15,
      downloadFetch: (signal) => new Response(new ReadableStream({
        start(stream) {
          stream.enqueue(Buffer.from('te'));
          signal.addEventListener('abort', () => stream.error(signal.reason), { once: true });
        },
      })),
    });
    await adapter.check(controller.signal);
    await assert.rejects(adapter.download(controller.signal, () => { if (cancel) controller.abort(); }));
    assert.deepEqual(await readdir(cacheDir), []);
  }
});

test('macOS checks handle prereleases, missing assets, unsupported architectures and network failure', async (t) => {
  for (const mutate of [(r) => { r.prerelease = true; }, (r) => { r.draft = true; }, (r) => { r.tag_name = 'v1.0.0'; }]) {
    const { adapter } = await macFixture(t, { mutate });
    assert.equal(await adapter.check(new AbortController().signal), null);
  }
  for (const options of [{ mutate: (r) => { r.assets = []; } }, { arch: 'ia32' }, { fetchError: true },
    { mutate: (r) => { r.assets[0].browser_download_url = 'https://evil.example/installer'; } }]) {
    const { adapter } = await macFixture(t, options);
    await assert.rejects(adapter.check(new AbortController().signal));
  }
  assert.throws(() => checksumFor(`${'a'.repeat(64)}  a.dmg\n${'a'.repeat(64)}  a.dmg`, 'a.dmg'));
});

test('GitHub errors and redirects are bounded and do not follow untrusted hosts', async () => {
  for (const status of [404, 403, 429, 500]) {
    await assert.rejects(githubFetch(async () => new Response('', { status }), 'https://api.github.com/repos/ShaoClean/remote-git/releases/latest', new AbortController().signal), /GitHub|Release/);
  }
  let calls = 0;
  await assert.rejects(githubFetch(async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/payload' } });
  }, 'https://github.com/source', new AbortController().signal), /不受信任/);
  assert.equal(calls, 1);
});

test('Electron adapter disables automatic installation, handles retry cancellation and relays native install errors', async () => {
  const updater = new EventEmitter(), nativeUpdater = new EventEmitter();
  updater.setFeedURL = () => {};
  updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: '1.1.0', releaseNotes: 'Notes' } });
  updater.downloadUpdate = (token) => token.createPromise((resolve, _reject) => { updater.finish = () => resolve(['/verified.exe']); });
  const adapter = createElectronUpdater({ updater, nativeUpdater, logger: { error() {} } });
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  await adapter.check();
  const controller = new AbortController();
  const download = adapter.download(controller.signal, () => {});
  controller.abort();
  await assert.rejects(download);
  const retry = adapter.download(new AbortController().signal, () => {});
  updater.finish();
  assert.equal(await retry, '/verified.exe');
  assert.equal(updater.listenerCount('download-progress'), 0);
  updater.quitAndInstall = () => updater.emit('error', new Error('installer failed'));
  await assert.rejects(adapter.install(), /installer failed/);
  updater.quitAndInstall = () => nativeUpdater.emit('before-quit-for-update');
  await adapter.install();
  assert.equal(nativeUpdater.listenerCount('before-quit-for-update'), 0);
});

test('Electron adapter reports check and stalled-download timeouts', async () => {
  const updater = new EventEmitter();
  updater.setFeedURL = () => {};
  updater.checkForUpdates = () => new Promise(() => {});
  updater.downloadUpdate = (token) => token.createPromise(() => {});
  const adapter = createElectronUpdater({ updater, nativeUpdater: new EventEmitter(), logger: { error() {} }, checkTimeout: 10, idleTimeout: 10 });
  await assert.rejects(adapter.check(), /超时/);
  await assert.rejects(adapter.download(new AbortController().signal, () => {}), /无响应/);
});
