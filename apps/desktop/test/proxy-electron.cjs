// Run with Electron, after building @alune/ssh-client. Exercises both updater
// download implementations on the host OS; never launches an installer.
const { app, session, autoUpdater: nativeUpdater } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { createHash, X509Certificate } = require('node:crypto');
const { NsisUpdater, AppImageUpdater } = require('electron-updater');
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
const { createElectronUpdater } = require('../src/electron-updater-adapter.cjs');
const { createProxyBridge } = require('../../../packages/ssh-client/dist');
const { listen, httpProxy, socksProxy, tlsOptions } = require('../../../packages/ssh-client/tests/helpers/proxy-fixture.cjs');

const root = process.env.ALUNE_PROXY_TEST_DIR;
if (!root) throw new Error('Run npm run test:proxy -w desktop with an isolated data directory');
app.setPath('userData', root);
app.whenReady().then(async () => {
  const payload = Buffer.from('fixture update package, not executable');
  const sha512 = createHash('sha512').update(payload).digest('base64');
  const requested = [];
  let extension = 'exe';
  const origin = await listen(https.createServer(tlsOptions, (request, response) => {
    const url = request.url.split('?')[0]; requested.push(url);
    if (url.endsWith('.atom')) return response.end('<feed><entry><title>Fixture</title><link href="https://github.com/ShaoClean/alune/releases/tag/v0.5.0"/><content>Proxy test</content></entry></feed>');
    if (url.endsWith('/latest')) return response.end('{"tag_name":"v0.5.0"}');
    if (url.endsWith('.yml')) return response.end(`version: 0.5.0\nfiles:\n  - url: Alune-0.5.0.${extension}\n    sha512: ${sha512}\n    size: ${payload.length}\npath: Alune-0.5.0.${extension}\nsha512: ${sha512}\n`);
    if (url.endsWith('.blockmap')) { response.writeHead(404); return response.end(); }
    if (url.includes('/releases/download/')) { response.writeHead(302, { location: `https://release-assets.githubusercontent.com/package.${extension}` }); return response.end(); }
    response.setHeader('Content-Length', payload.length); response.end(payload);
  }));
  const credentials = { username: 'fixture', password: 'protected-fixture' };
  const map = () => ({ host: '127.0.0.1', port: origin.port });
  const http = await httpProxy({ credentials, map }), socks = await socksProxy({ credentials, map });
  let snapshot = { revision: 'first', enabled: true, protocol: 'http', host: '127.0.0.1', port: http.port, credentials };
  const bridge = await createProxyBridge(() => snapshot);
  try {
    for (const [name, Updater, fileExtension] of [['nsis', NsisUpdater, 'exe'], ['appimage', AppImageUpdater, 'AppImage']]) {
      extension = fileExtension;
      snapshot = { ...snapshot, revision: `http-${name}`, protocol: 'http', port: http.port };
      const configuration = path.join(root, `${name}.yml`); fs.writeFileSync(configuration, `updaterCacheDirName: ${name}\n`);
      process.env.APPIMAGE = path.join(root, 'old.AppImage'); fs.writeFileSync(process.env.APPIMAGE, 'old fixture');
      const updater = new Updater(undefined, { version: '0.4.0', name, isPackaged: true, appUpdateConfigPath: configuration, userDataPath: root, baseCachePath: root, whenReady: () => app.whenReady() });
      updater.httpExecutor = new ElectronHttpExecutor();
      updater.isUpdateSupported = () => true;
      if (name === 'appimage') updater.disableDifferentialDownload = true;
      updater.netSession.setCertificateVerifyProc((request, callback) => {
        const expected = new X509Certificate(tlsOptions.cert).fingerprint256;
        callback(new X509Certificate(request.certificate.data).fingerprint256 === expected ? 0 : -2);
      });
      const adapter = createElectronUpdater({ updater, nativeUpdater, proxyBridge: async () => ({ port: bridge.port, revision: snapshot.revision }), logger: { info() {}, warn() {}, error() {}, debug() {} } });
      const info = await adapter.check(); assert.equal(info.version, '0.5.0');
      const oldCount = http.records.length;
      snapshot = { ...snapshot, revision: `socks-${name}`, protocol: 'socks5', port: socks.port };
      const downloaded = await adapter.download(AbortSignal.timeout(20_000), () => {});
      assert.equal(fs.readFileSync(downloaded, 'utf8'), payload.toString());
      assert.equal(http.records.length, oldCount, 'new download must not reuse the old Chromium proxy tunnel');
      assert.ok(socks.records.some((record) => record.host === 'release-assets.githubusercontent.com'));
      await updater.netSession.closeAllConnections();
      const hits = requested.length;
      snapshot = { ...snapshot, revision: `unreachable-${name}`, port: 1 };
      await assert.rejects(adapter.check());
      assert.equal(requested.length, hits, 'failed proxy must never reach the update origin directly');
    }
    assert.ok(requested.some((url) => url.endsWith('.atom')));
    assert.ok(requested.some((url) => url.endsWith('.yml')));
    assert.ok(requested.some((url) => url.endsWith('.blockmap')));
    assert.equal(await session.fromPartition('alune-proxy-internal').resolveProxy('http://127.0.0.1:3000'), 'DIRECT');
    console.log('ELECTRON_PROXY_PASSED: NsisUpdater, AppImageUpdater, metadata, blockmap, SHA512 package, redirect, saved revision, internal loopback');
  } finally {
    bridge.close(); http.close(); socks.close(); origin.close();
  }
}).then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
