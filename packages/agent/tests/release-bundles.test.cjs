const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  { createHash } = require('node:crypto');
const { readBundle } = require('../dist/adapters/ssh/bundles');
const { version } = require('../dist/version.json'),
  { PROTOCOL_VERSION } = require('@alune/protocol');
test('desktop pins gate SSH downloads: no download on reconnect, redirect allowlist, checksum before upload', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-release-pins-')),
    file = path.join(dir, 'catalog.json'),
    previous = process.env.ALUNE_AGENT_RELEASE_CATALOG;
  const bytes = Buffer.from('isolated archive'),
    sum = createHash('sha256').update(bytes).digest('hex');
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        version,
        targets: {
          'linux-x64': { protocol: PROTOCOL_VERSION, sha256: sum, manifestSha256: '0'.repeat(64) },
        },
      }),
    );
    process.env.ALUNE_AGENT_RELEASE_CATALOG = file;
    fs.mkdirSync(path.join(dir, 'ssh-bundles', 'linux-x64'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'ssh-bundles', 'linux-x64', 'release.json'),
      JSON.stringify({ target: 'linux-x64', version, protocol: PROTOCOL_VERSION, sha256: sum, manifestSha256: '0'.repeat(64) }),
    );
    fs.writeFileSync(path.join(dir, 'ssh-bundles', 'linux-x64', 'agent.tar.gz'), bytes);
    const calls = [];
    const bundle = await readBundle(dir, 'linux-x64', async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, 'manual');
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://release-assets.githubusercontent.com/fixture' },
          })
        : new Response(bytes);
    });
    assert.equal(bundle.sha256, sum);
    assert.deepEqual(await bundle.bytes(), bytes);
    assert.equal(calls.length, 0);
    fs.rmSync(path.join(dir, 'ssh-bundles', 'linux-x64', 'agent.tar.gz'));
    const remoteBundle = await readBundle(dir, 'linux-x64', async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, 'manual');
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://release-assets.githubusercontent.com/fixture' },
          })
        : new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
    });
    const progressEvents = [];
    assert.deepEqual(
      await remoteBundle.bytes((progress) => progressEvents.push(progress)),
      bytes,
    );
    assert.equal(calls.length, 2);
    assert.ok(progressEvents.length >= 2);
    assert.equal(progressEvents[0].transferred, 0);
    assert.equal(progressEvents[0].total, bytes.length);
    assert.equal(progressEvents.at(-1).transferred, bytes.length);
    assert.equal(progressEvents.at(-1).percent, 100);
    // Verified download is cached locally and reused without re-downloading.
    assert.deepEqual(await remoteBundle.bytes(), bytes);
    assert.equal(calls.length, 2);
    fs.rmSync(path.join(dir, 'ssh-bundles', 'linux-x64', 'agent.tar.gz'));
    const failed = await readBundle(dir, 'linux-x64', async () => {
      throw new Error('network reset');
    });
    await assert.rejects(failed.bytes(), /SSH release download failed: network reset/);
    const bad = await readBundle(
      dir,
      'linux-x64',
      async () => new Response(Buffer.from('tampered')),
    );
    await assert.rejects(bad.bytes(), /checksum mismatch/);
    assert.equal(fs.existsSync(path.join(dir, 'ssh-bundles', 'linux-x64', 'agent.tar.gz')), false);
    const redirect = await readBundle(
      dir,
      'linux-x64',
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
    );
    await assert.rejects(redirect.bytes(), /redirect/);
    await assert.rejects(readBundle(dir, 'win32-x64'), /catalog/);
  } finally {
    if (previous === undefined) delete process.env.ALUNE_AGENT_RELEASE_CATALOG;
    else process.env.ALUNE_AGENT_RELEASE_CATALOG = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
