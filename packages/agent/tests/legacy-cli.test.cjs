const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { makeLegacy } = require('./legacy-fixture.cjs');
const { loadIdentity } = require('../dist/adapters/identity');
const { AgentState } = require('../dist/adapters/sqlite/state');
const { openProtectedSecrets } = require('../dist/adapters/secrets/protected');
const { createAiSecretStorage } = require('../../../apps/desktop/src/ai-secret-storage.cjs');
const { bridgeLegacyAgentSecrets } = require('../../../apps/desktop/src/legacy-agent-secrets.cjs');
const cli = path.resolve(__dirname, '../bin/alune-agent.cjs');
async function setup(t, cipher) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-legacy-cli-'));
  const legacy = makeLegacy(root, cipher),
    target = path.join(root, 'agent');
  const agentId = await loadIdentity(target),
    state = await AgentState.open(target, agentId);
  const secrets = await openProtectedSecrets(target, agentId, state.document('credential-key'), {
    backend: 'file',
    allowInitialize: true,
  });
  secrets.close();
  await state.close();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, legacy, target, agentId };
}
async function run(f, storage, ciphertexts) {
  const child = spawn(
    process.execPath,
    [cli, 'legacy-import', '--source', f.legacy.source, '--data-dir', f.target],
    { stdio: ['ignore', 'pipe', 'pipe', ...(storage ? ['ipc'] : [])], windowsHide: true },
  );
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (value) => (stdout += value));
  child.stderr.on('data', (value) => (stderr += value));
  const dispose = storage ? bridgeLegacyAgentSecrets(child, storage, ciphertexts) : () => {};
  const timeout = setTimeout(() => child.kill('SIGKILL'), 45000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timeout);
    dispose();
  }
}
test(
  'legacy-import CLI supports standalone source keys and duplicate execution reports the existing receipt',
  { timeout: 90000 },
  async (t) => {
    const f = await setup(t);
    const first = await run(f);
    assert.equal(first.code, 0, first.stderr);
    const receipt = JSON.parse(first.stdout);
    assert.equal(receipt.counts.hosts, 1);
    assert.equal(receipt.alreadyImported, false);
    const second = await run(f);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).alreadyImported, true);
    assert.doesNotMatch(
      first.stdout + first.stderr + second.stdout + second.stderr,
      /fixture-import-|fixture-ssh-password|aes-gcm:|safe-storage:/,
    );
  },
);
test(
  'desktop safeStorage migration uses only the dedicated inherited IPC channel and exact ciphertext allowlist',
  { timeout: 90000 },
  async (t) => {
    const values = new Map();
    let decryptions = 0;
    const cipher = createAiSecretStorage({
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'fixture-native-store',
      encryptString(value) {
        const key = randomBytes(48);
        values.set(key.toString('base64'), value);
        return key;
      },
      decryptString(value) {
        decryptions++;
        const plain = values.get(value.toString('base64'));
        if (plain === undefined) throw Error('Unknown fixture ciphertext');
        return plain;
      },
    });
    const f = await setup(t, cipher);
    decryptions = 0;
    const refused = await run(f);
    assert.notEqual(refused.code, 0);
    assert.equal(decryptions, 0);
    const allowed = [...values.keys()].map((key) => 'safe-storage:' + key);
    const result = await run(f, cipher, allowed);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).counts.tokens, 1);
    assert.equal(decryptions, allowed.length);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /fixture-import-|fixture-ssh-password|aes-gcm:|safe-storage:/,
    );
  },
);
