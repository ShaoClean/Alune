// Runs with the bundled Node ABI. Electron alone owns legacy safeStorage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { AgentState } = require('../../../packages/agent/dist/adapters/sqlite/state');
const { importLegacyState } = require('../../../packages/agent/dist/modules/migration/legacy');
const { legacyIpcDecryptor } = require('../../../packages/agent/dist/adapters/secrets/legacy-ipc');
const { openProtectedSecrets } = require('../../../packages/agent/dist/adapters/secrets/protected');
const { createRecoveryBackup, restoreRecoveryBackup } = require('../../../packages/agent/dist/adapters/migration/recovery');
const { HostProfilesStore, AccessTokensStore } = require('../../../packages/agent/dist/modules/accounts');
const { AiSettingsStore, ProxySettingsStore } = require('../../../packages/agent/dist/modules/settings');
const root = fs.realpathSync(process.env.ALUNE_CRITICAL_FIXTURE);
assert.equal(path.dirname(root), fs.realpathSync(require('node:os').tmpdir()));
assert.match(path.basename(root), /^alune-critical-native-/);
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'fixture-marker.json'))).version, 1);
const f = JSON.parse(fs.readFileSync(path.join(root, 'legacy-fixture.json')));
const directory = path.join(root, 'agent'), keychain = path.join(root, 'destination.keychain-db');
const secretOptions = { backend: 'keychain', keychain };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function snapshot(dir) {
  const rows = {};
  function walk(at, prefix = '') {
    for (const e of fs.readdirSync(at, { withFileTypes: true })) {
      const file = path.join(at, e.name), name = prefix + e.name;
      if (e.isDirectory()) walk(file, name + '/');
      else if (e.isFile()) rows[name] = digest(fs.readFileSync(file));
      else if (e.isSymbolicLink()) rows[name] = { link: fs.readlinkSync(file) };
      else assert.fail('unexpected file type');
    }
  }
  walk(dir); return rows;
}
async function verify(state) {
  const cipher = await openProtectedSecrets(directory, state.agentId, state.document('credential-key'), { ...secretOptions, allowInitialize: false });
  try {
    const host = new HostProfilesStore(state.database, cipher).credential(f.hostId);
    assert.equal(host.password, 'critical-fixture-ssh-password');
    assert.equal(host.passphrase, undefined, 'password hosts must not expose unused key passphrases');
    assert.equal(new HostProfilesStore(state.database, cipher).credential(f.keyHostId).passphrase, 'critical-fixture-key-passphrase');
    assert.equal(new AccessTokensStore(state.database, cipher).credential(f.repoId, f.remote, 'gitlab').token, 'critical-fixture-token');
    assert.equal(new AiSettingsStore(state.document('ai-settings'), cipher).key('openai'), 'critical-fixture-ai-key');
    assert.equal(new ProxySettingsStore(state.document('network-proxy'), cipher).snapshot().credentials.password, 'critical-fixture-proxy-password');
    assert.deepEqual(state.document('workspace-preferences').read(), f.workspace);
  } finally { cipher.close(); }
}
async function main() {
  const sourceBefore = snapshot(f.source), gitBefore = snapshot(f.repository);
  const agentId = randomUUID();
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'identity.json'), JSON.stringify({ agentId }), { mode: 0o600 });
  let state = await AgentState.open(directory, agentId);
  const bridge = legacyIpcDecryptor();
  const phrase = Buffer.from('critical-fixture-recovery-passphrase');
  try {
    // No old-host decryption authority: fail closed, with no partial import.
    await assert.rejects(importLegacyState(state, f.source, { secretOptions }));
    assert.equal(state.database.prepare('SELECT count(*) n FROM imports').get().n, 0);
    assert.equal(state.database.prepare('SELECT count(*) n FROM connections').get().n, 0);
    assert.deepEqual(snapshot(f.source), sourceBefore);
    const receipt = await importLegacyState(state, f.source, { secretOptions, decryptSafeStorage: bridge.decrypt });
    assert.equal(receipt.alreadyImported, false);
    assert.equal(receipt.counts.tokens, 1);
    assert.equal(receipt.counts.hosts, 2);
    await verify(state);
    const duplicate = await importLegacyState(state, f.source, { secretOptions, decryptSafeStorage: () => assert.fail('duplicate must not decrypt again') });
    assert.equal(duplicate.alreadyImported, true);
    assert.deepEqual(snapshot(f.source), sourceBefore);
    const descriptor = state.document('credential-key').read();
    assert.equal(descriptor.backend, 'keychain');
    const recovery = path.join(root, 'encrypted.alune-recovery');
    await createRecoveryBackup(state, recovery, phrase, undefined, { keychain });
    const bytes = fs.readFileSync(recovery);
    for (const needle of ['SQLite format', 'critical-fixture-token', 'critical-fixture-ai-key', 'critical-fixture-ssh-password', 'critical-fixture-proxy-password']) assert(!bytes.includes(Buffer.from(needle)));
    await state.close(); state = undefined;
    execFileSync('/usr/bin/security', ['delete-generic-password', '-s', 'io.alune.agent.master.v1', '-a', descriptor.keyId, keychain], { stdio: 'pipe' });
    fs.writeFileSync(path.join(directory, 'identity.json'), '{controlled damaged identity');
    const beforeWrongPhrase = snapshot(directory);
    await assert.rejects(restoreRecoveryBackup(directory, recovery, Buffer.from('incorrect-fixture-passphrase'), { secretOptions }));
    assert.deepEqual(snapshot(directory), beforeWrongPhrase);
    await restoreRecoveryBackup(directory, recovery, phrase, { secretOptions });
    state = await AgentState.open(directory, agentId);
    const next = state.document('credential-key').read();
    assert.equal(next.backend, 'keychain'); assert.notEqual(next.keyId, descriptor.keyId);
    await verify(state);
    assert.deepEqual(snapshot(f.repository), gitBefore);
    assert.deepEqual(snapshot(f.source), sourceBefore);
    fs.writeFileSync(path.join(root, 'node-result.json'), JSON.stringify({
      result: 'passed', imported: receipt.counts, nativeBackend: next.backend,
      sourceUnchanged: true, gitUnchanged: true, duplicateWithoutDecryption: true,
      missingDecryptAuthorityRefused: true, wrongRecoveryPhraseUnchanged: true,
      originalKeyAndIdentityLost: true, recoveredCredentialKinds: ['ssh-password', 'key-passphrase', 'token', 'ai-key', 'proxy-password'],
      workspaceRestored: true, freshNativeKey: true,
    }, null, 2));
  } finally {
    bridge.close(); phrase.fill(0); await state?.close();
    if (process.connected) process.disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
