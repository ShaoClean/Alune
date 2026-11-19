const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AgentState } = require('../dist/adapters/sqlite/state');
const {
  createRecoveryBackup,
  restoreRecoveryBackup,
} = require('../dist/adapters/migration/recovery');
const { openProtectedSecrets } = require('../dist/adapters/secrets/protected');
const { HostProfilesStore, AccessTokensStore } = require('../dist/modules/accounts');
const { AiSettingsStore, ProxySettingsStore } = require('../dist/modules/settings');
const { seedRecoveryState } = require('./recovery-fixture.cjs');
const passphrase = Buffer.from('fixture-recovery-passphrase-only');
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-full-recovery-'));
  const directory = path.join(root, 'agent'),
    agentId = randomUUID();
  const state = await AgentState.open(directory, agentId);
  t.after(async () => {
    await state.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(directory, 'identity.json'), JSON.stringify({ agentId }), {
    mode: 0o600,
  });
  const saved = await seedRecoveryState(state, { backend: 'file' });
  const output = path.join(root, 'fixture.alune-recovery');
  return { root, saved, directory, agentId, state, output };
}
async function verifyCredentials(state, saved) {
  const cipher = await openProtectedSecrets(
    state.root,
    state.agentId,
    state.document('credential-key'),
    { allowInitialize: false },
  );
  try {
    assert.equal(
      new HostProfilesStore(state.database, cipher).credential(saved.hostId).password,
      'fixture-ssh-password',
    );
    assert.equal(
      new AccessTokensStore(state.database, cipher).credential(saved.repoId, saved.remote, 'gitlab').token,
      'fixture-recovery-token',
    );
    assert.equal(
      new AiSettingsStore(state.document('ai-settings'), cipher).key('openai'),
      'fixture-recovery-ai-key',
    );
    assert.equal(
      new ProxySettingsStore(state.document('network-proxy'), cipher).snapshot().credentials
        .password,
      'fixture-recovery-proxy-password',
    );
    assert.deepEqual(state.document('workspace-preferences').read(), saved.workspace);
  } finally {
    cipher.close();
  }
}
test(
  'encrypted recovery restores identity, database and every credential after original keys and identity are lost',
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t);
    const original = f.state.document('credential-key').read();
    const master = fs.readFileSync(path.join(f.directory, 'keys', original.keyId + '.key'));
    const receipt = await createRecoveryBackup(f.state, f.output, passphrase);
    assert.equal(receipt.scope, 'identity-state-and-credentials');
    const bytes = fs.readFileSync(f.output);
    for (const needle of [
      'SQLite format',
      'fixture-ssh-password',
      'fixture-recovery-token',
      'fixture-recovery-ai-key',
      'fixture-recovery-proxy-password',
      master.toString('base64'),
    ])
      assert.equal(bytes.includes(Buffer.from(needle)), false);
    await assert.rejects(
      createRecoveryBackup(f.state, f.output, passphrase),
      (e) => e.kind === 'conflict',
    );
    await f.state.close();
    fs.writeFileSync(path.join(f.directory, 'identity.json'), '{broken identity');
    fs.rmSync(path.join(f.directory, 'keys'), { recursive: true });
    const restored = await restoreRecoveryBackup(f.directory, f.output, passphrase, {
      secretOptions: { backend: 'file' },
    });
    assert.equal(restored.agentId, f.agentId);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(f.directory, 'identity.json'))).agentId,
      f.agentId,
    );
    const state = await AgentState.open(f.directory, f.agentId);
    try {
      assert.notEqual(state.document('credential-key').read().keyId, original.keyId);
      await verifyCredentials(state, f.saved);
      assert(
        fs.existsSync(
          path.join(f.directory, 'state/generations', f.state.generation, 'state.sqlite'),
        ),
      );
      assert(
        fs
          .readdirSync(path.join(f.directory, 'recovery'))
          .some(
            (name) =>
              name.endsWith('.identity.json') &&
              fs.readFileSync(path.join(f.directory, 'recovery', name), 'utf8') ===
                '{broken identity',
          ),
      );
    } finally {
      await state.close();
      master.fill(0);
    }
  },
);
test(
  'wrong passphrases, tampering and cancellation cannot publish recovery state',
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t);
    await createRecoveryBackup(f.state, f.output, passphrase);
    const before = fs.readFileSync(path.join(f.directory, 'state/current.json'));
    await f.state.close();
    await assert.rejects(
      restoreRecoveryBackup(f.directory, f.output, Buffer.from('fixture-wrong-passphrase'), {
        secretOptions: { backend: 'file' },
      }),
      (e) => e.kind === 'corrupt',
    );
    const bad = path.join(f.root, 'tampered.alune-recovery');
    const bytes = fs.readFileSync(f.output);
    bytes[bytes.length - 1] ^= 1;
    fs.writeFileSync(bad, bytes, { mode: 0o600 });
    await assert.rejects(
      restoreRecoveryBackup(f.directory, bad, passphrase, { secretOptions: { backend: 'file' } }),
      (e) => e.kind === 'corrupt',
    );
    await assert.rejects(
      restoreRecoveryBackup(f.directory, f.output, passphrase, { signal: AbortSignal.abort() }),
      (e) => e.name === 'AbortError',
    );
    assert.deepEqual(fs.readFileSync(path.join(f.directory, 'state/current.json')), before);
    const state = await AgentState.open(f.directory, f.agentId);
    try {
      await verifyCredentials(state, f.saved);
    } finally {
      await state.close();
    }
  },
);
test(
  'full recovery respects writer ownership and refuses a different Agent identity',
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t);
    await createRecoveryBackup(f.state, f.output, passphrase);
    const before = fs.readFileSync(path.join(f.directory, 'state/current.json'));
    await assert.rejects(
      restoreRecoveryBackup(f.directory, f.output, passphrase, {
        secretOptions: { backend: 'file' },
      }),
      (e) => e.kind === 'busy',
    );
    assert.deepEqual(fs.readFileSync(path.join(f.directory, 'state/current.json')), before);
    const other = path.join(f.root, 'other');
    fs.mkdirSync(other, { mode: 0o700 });
    const identity = JSON.stringify({ agentId: randomUUID() });
    fs.writeFileSync(path.join(other, 'identity.json'), identity, { mode: 0o600 });
    await assert.rejects(
      restoreRecoveryBackup(other, f.output, passphrase, { secretOptions: { backend: 'file' } }),
      (e) => e.kind === 'conflict',
    );
    assert.equal(fs.readFileSync(path.join(other, 'identity.json'), 'utf8'), identity);
    assert.equal(fs.existsSync(path.join(other, 'state/current.json')), false);
  },
);
