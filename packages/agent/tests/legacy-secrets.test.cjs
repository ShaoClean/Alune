const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  localSecretStorage,
  readLegacySecretStorage,
  agentFileSecretStorage,
} = require('../dist/adapters/secrets/file');

test('legacy imports read existing AES credentials without creating or replacing source keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-legacy-cipher-'));
  try {
    const missing = path.join(root, 'missing');
    const reader = readLegacySecretStorage(missing);
    assert.equal(reader.available, false);
    assert.equal(fs.existsSync(missing), false);
    const legacy = localSecretStorage(root);
    const cipher = legacy.encrypt('fixture-provider-secret');
    const key = fs.readFileSync(path.join(root, 'ai-master-key'));
    assert.equal(readLegacySecretStorage(root).decrypt(cipher), 'fixture-provider-secret');
    assert.deepEqual(fs.readFileSync(path.join(root, 'ai-master-key')), key);
    if (process.platform !== 'win32') {
      fs.chmodSync(path.join(root, 'ai-master-key'), 0o644);
      assert.equal(readLegacySecretStorage(root).available, false);
      assert.equal(fs.statSync(path.join(root, 'ai-master-key')).mode & 0o777, 0o644);
      assert.equal(localSecretStorage(root).available, true);
      assert.equal(fs.statSync(path.join(root, 'ai-master-key')).mode & 0o777, 0o600);
    }
    fs.writeFileSync(path.join(root, 'ai-master-key'), 'damaged');
    assert.equal(readLegacySecretStorage(root).available, false);
    assert.equal(fs.readFileSync(path.join(root, 'ai-master-key'), 'utf8'), 'damaged');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Agent file cipher uses a separate key and an explicit create decision', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-agent-cipher-'));
  try {
    const legacy = localSecretStorage(root);
    const old = legacy.encrypt('fixture');
    assert.equal(agentFileSecretStorage(root, false).available, false);
    assert.equal(fs.existsSync(path.join(root, 'agent-master-key')), false);
    const current = agentFileSecretStorage(root, true);
    assert.equal(current.available, true);
    assert.throws(() => current.decrypt(old));
    const saved = current.encrypt('new fixture');
    assert.equal(agentFileSecretStorage(root, false).decrypt(saved), 'new fixture');
    assert.equal(legacy.decrypt(old), 'fixture');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
