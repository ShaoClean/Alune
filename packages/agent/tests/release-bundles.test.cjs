const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  { createHash } = require('node:crypto');
const { readBundle } = require('../dist/adapters/ssh/bundles');
const { version } = require('../dist/version.json'),
  { PROTOCOL_VERSION } = require('@alune/protocol');
test('desktop catalog resolves immutable remote assets and rejects missing targets', async () => {
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
      JSON.stringify({
        target: 'linux-x64',
        version,
        protocol: PROTOCOL_VERSION,
        sha256: sum,
        manifestSha256: '0'.repeat(64),
      }),
    );
    fs.writeFileSync(path.join(dir, 'ssh-bundles', 'linux-x64', 'agent.tar.gz'), bytes);
    const bundle = await readBundle(dir, 'linux-x64');
    assert.equal(bundle.sha256, sum);
    assert.equal(
      bundle.url,
      `https://github.com/ShaoClean/Alune/releases/download/v${version}/alune-agent-${version}-linux-x64.tar.gz`,
    );
    await assert.rejects(readBundle(dir, 'win32-x64'), /catalog/);
  } finally {
    if (previous === undefined) delete process.env.ALUNE_AGENT_RELEASE_CATALOG;
    else process.env.ALUNE_AGENT_RELEASE_CATALOG = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
