const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AgentState } = require('../dist/adapters/sqlite/state');
const { openProtectedSecrets } = require('../dist/adapters/secrets/protected');
const { HostProfilesStore, initializeHostProfiles } = require('../dist/modules/accounts');
const profile = {
  name: 'Fixture',
  host: 'fixture.invalid',
  port: 22,
  username: 'fixture',
  authType: 'password',
  privateKeyPath: null,
};
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-hosts-'));
  const state = await AgentState.open(root, randomUUID());
  const cipher = await openProtectedSecrets(root, state.agentId, state.document('credential-key'), {
    backend: 'file',
    allowInitialize: true,
  });
  t.after(async () => {
    cipher.close();
    await state.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  initializeHostProfiles(state.database);
  const hosts = new HostProfilesStore(state.database, cipher);
  const create = (input) => {
    const before = hosts.list();
    const ids = new Set(before.hosts.map((host) => host.id));
    const added = hosts.save(null, input, before.revision).hosts.filter((host) => !ids.has(host.id));
    assert.equal(added.length, 1);
    return added[0];
  };
  return { root, state, cipher, hosts, create };
}
test(
  'host passwords are encrypted and bound to both profile and destination',
  { timeout: 30000 },
  async (t) => {
    const { state, hosts, create } = await fixture(t);
    const first = create({ ...profile, password: 'fixture-password-one' });
    const second = create({ ...profile, name: 'Second', password: 'fixture-password-two' });
    assert.equal(hosts.credential(first.id).password, 'fixture-password-one');
    assert.doesNotMatch(JSON.stringify(hosts.list()), /fixture-password|aes-gcm:|password_secret/);
    const row = (id) =>
      state.database.prepare('SELECT password_secret FROM connections WHERE id = ?').get(id);
    const original = row(first.id).password_secret;
    state.database
      .prepare('UPDATE connections SET password_secret = ? WHERE id = ?')
      .run(row(second.id).password_secret, first.id);
    assert.throws(
      () => hosts.credential(first.id),
      (e) => e.kind === 'unavailable',
    );
    state.database
      .prepare('UPDATE connections SET password_secret = ? WHERE id = ?')
      .run(original, first.id);
    const before = hosts.list();
    assert.throws(
      () => hosts.save(first.id, { ...profile, host: 'another.invalid' }, before.revision),
      (e) => e.kind === 'conflict',
    );
    assert.deepEqual(hosts.list(), before);
    hosts.save(first.id, { ...profile, host: 'another.invalid', password: null }, before.revision);
    assert.equal(hosts.credential(first.id).password, undefined);
  },
);
test(
  'key passphrases require explicit replacement for another key path and host deletion preserves repository references',
  { timeout: 30000 },
  async (t) => {
    const { state, hosts, create, root } = await fixture(t);
    const keyProfile = {
      ...profile,
      authType: 'privateKey',
      privateKeyPath: path.join(root, 'key'),
    };
    const host = create({ ...keyProfile, passphrase: 'fixture-key-passphrase' });
    assert.equal(hosts.credential(host.id).passphrase, 'fixture-key-passphrase');
    assert.throws(
      () =>
        hosts.save(
          host.id,
          { ...keyProfile, privateKeyPath: path.join(root, 'other-key') },
          hosts.list().revision,
        ),
      (e) => e.kind === 'conflict',
    );
    state.database
      .prepare(
        'INSERT INTO repositories (id,connection_id,source,name,path,created_at) VALUES (?,?,?,?,?,?)',
      )
      .run('repo', host.id, 'ssh', 'Fixture', '/fixture', new Date().toISOString());
    assert.throws(
      () => hosts.delete(host.id, hosts.list().revision),
      (e) => e.kind === 'conflict',
    );
    state.database.prepare('DELETE FROM repositories WHERE id = ?').run('repo');
    hosts.delete(host.id, hosts.list().revision);
    assert.equal(hosts.list().hosts.length, 0);
    assert(state.database.prepare('SELECT id FROM resource_ids WHERE id = ?').get(host.id));
  },
);
