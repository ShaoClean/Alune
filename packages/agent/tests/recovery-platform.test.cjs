const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { AgentState } = require('../dist/adapters/sqlite/state');
const {
  createRecoveryBackup,
  restoreRecoveryBackup,
} = require('../dist/adapters/migration/recovery');
const { openProtectedSecrets } = require('../dist/adapters/secrets/protected');
const { AccessTokensStore, HostProfilesStore } = require('../dist/modules/accounts');
const { seedRecoveryState } = require('./recovery-fixture.cjs');
test(
  'native credential recovery creates a fresh local protection record after the original is lost or damaged',
  { skip: !['darwin', 'win32'].includes(process.platform), timeout: 120000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-native-recovery-'));
    const keychain = path.join(root, 'fixture.keychain-db');
    const password = randomBytes(24).toString('base64');
    const security = (...args) =>
      execFileSync('/usr/bin/security', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000,
      });
    const secretOptions =
      process.platform === 'darwin' ? { backend: 'keychain', keychain } : { backend: 'dpapi' };
    let created = false,
      state,
      restored;
    try {
      if (process.platform === 'darwin') {
        security('create-keychain', '-p', password, keychain);
        created = true;
        security('unlock-keychain', '-p', password, keychain);
      }
      const directory = path.join(root, 'agent'),
        agentId = randomUUID();
      state = await AgentState.open(directory, agentId);
      fs.writeFileSync(path.join(directory, 'identity.json'), JSON.stringify({ agentId }), {
        mode: 0o600,
      });
      const saved = await seedRecoveryState(state, secretOptions);
      const descriptor = state.document('credential-key').read();
      const output = path.join(root, 'native.recovery'),
        phrase = Buffer.from('fixture-native-recovery-passphrase');
      await createRecoveryBackup(state, output, phrase, undefined, secretOptions);
      if (process.platform === 'darwin') {
        security('lock-keychain', keychain);
        await assert.rejects(
          createRecoveryBackup(
            state,
            path.join(root, 'locked.recovery'),
            phrase,
            undefined,
            secretOptions,
          ),
          (e) => e.kind === 'unavailable',
        );
        assert.equal(fs.existsSync(path.join(root, 'locked.recovery')), false);
        security('unlock-keychain', '-p', password, keychain);
        security(
          'delete-generic-password',
          '-s',
          'io.alune.agent.master.v1',
          '-a',
          descriptor.keyId,
          keychain,
        );
      } else
        fs.writeFileSync(
          path.join(directory, 'keys', descriptor.keyId + '.dpapi'),
          'fixture-corrupt-key',
        );
      await state.close();
      await restoreRecoveryBackup(directory, output, phrase, { secretOptions });
      phrase.fill(0);
      restored = await AgentState.open(directory, agentId);
      const next = restored.document('credential-key').read();
      assert.notEqual(next.keyId, descriptor.keyId);
      assert.equal(next.backend, secretOptions.backend);
      const cipher = await openProtectedSecrets(
        directory,
        agentId,
        restored.document('credential-key'),
        { ...secretOptions, allowInitialize: false },
      );
      try {
        assert.equal(
          new HostProfilesStore(restored.database, cipher).credential(saved.hostId).password,
          'fixture-ssh-password',
        );
        assert.equal(
          new AccessTokensStore(restored.database, cipher).credential(saved.repoId, saved.remote, 'gitlab').token,
          'fixture-recovery-token',
        );
      } finally {
        cipher.close();
      }
      if (process.platform === 'win32')
        assert.equal(
          fs.readFileSync(path.join(directory, 'keys', descriptor.keyId + '.dpapi'), 'utf8'),
          'fixture-corrupt-key',
        );
    } finally {
      await restored?.close();
      await state?.close();
      if (created) security('delete-keychain', keychain);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
