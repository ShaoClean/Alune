const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AgentState } = require('../dist/adapters/sqlite/state');
const { initializeAgentAccessTokens } = require('../dist/adapters/sqlite/access-tokens');
const { AccessTokensStore } = require('../dist/modules/accounts');
const { openProtectedSecrets } = require('../dist/adapters/secrets/protected');
const { openStateKernel } = require('../dist/bootstrap/state-kernel');
const remote = {
  name: 'origin',
  host: 'fixture.invalid:8443',
  project: 'team/project',
  webUrl: 'https://fixture.invalid:8443/team/project',
  provider: 'gitlab',
};
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-token-core-'));
  const agentId = randomUUID();
  const state = await AgentState.open(root, agentId);
  const cipher = await openProtectedSecrets(root, agentId, state.document('credential-key'), {
    backend: 'file',
    allowInitialize: true,
  });
  t.after(async () => {
    cipher.close();
    await state.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  initializeAgentAccessTokens(state.database);
  state.database
    .prepare('INSERT INTO repositories (id,source,name,path,created_at) VALUES (?,?,?,?,?)')
    .run('repo', 'local', 'Fixture', root, new Date().toISOString());
  const tokens = new AccessTokensStore(state.database, cipher);
  const save = (name, value) =>
    tokens
      .save(null, { name, value, revision: tokens.list().revision })
      .tokens.find((t) => t.name === name);
  const apply = (id) =>
    tokens.apply('repo', remote, {
      remote: remote.name,
      target: remote.webUrl,
      provider: 'gitlab',
      tokenId: id,
      revision: tokens.list().revision,
    });
  return { root, agentId, state, cipher, tokens, save, apply };
}
test(
  'Agent token ciphertext is bound to stable IDs and target changes cannot revive credentials',
  { timeout: 30000 },
  async (t) => {
    const { state, tokens, save, apply } = await fixture(t);
    const a = save('A', 'fixture-token-A');
    const b = save('B', 'fixture-token-B');
    const secret = (id) =>
      state.database
        .prepare('SELECT ciphertext FROM access_token_secrets WHERE token_id = ?')
        .get(id).ciphertext;
    const original = secret(a.id);
    state.database
      .prepare('UPDATE access_token_secrets SET ciphertext = ? WHERE token_id = ?')
      .run(secret(b.id), a.id);
    const before = tokens.list();
    assert.throws(
      () => apply(a.id),
      (e) => e.kind === 'unavailable',
    );
    assert.deepEqual(tokens.list(), before);
    state.database
      .prepare('UPDATE access_token_secrets SET ciphertext = ? WHERE token_id = ?')
      .run(original, a.id);
    apply(a.id);
    assert.equal(tokens.credential('repo', remote, 'gitlab').token, 'fixture-token-A');
    tokens.reconcile('repo', [{ ...remote, webUrl: 'https://another.invalid/team/project' }]);
    tokens.reconcile('repo', [remote]);
    assert.equal(tokens.selection('repo', remote).status, 'target-changed');
    assert.throws(
      () => tokens.credential('repo', remote, 'gitlab'),
      (e) => e.kind === 'conflict',
    );
    assert.doesNotMatch(JSON.stringify(tokens.list()), /fixture-token-|aes-gcm:|ciphertext/);
  },
);
test(
  'token replacement invalidates active snapshots and deletion removes secrets and bindings',
  { timeout: 30000 },
  async (t) => {
    const { state, tokens, save, apply } = await fixture(t);
    const token = save('Fixture', 'fixture-original');
    apply(token.id);
    const active = tokens.credential('repo', remote, 'gitlab');
    const revision = tokens.list().revision;
    tokens.save(token.id, { name: 'Renamed', value: 'fixture-replaced', revision });
    assert.throws(active.assertCurrent, (e) => e.kind === 'conflict');
    assert.throws(
      () => tokens.delete(token.id, { revision }),
      (e) => e.kind === 'conflict',
    );
    assert.equal(tokens.credential('repo', remote, 'gitlab').token, 'fixture-replaced');
    tokens.delete(token.id, { revision: tokens.list().revision });
    assert.equal(tokens.selection('repo', remote).status, 'token-deleted');
    assert.equal(
      state.database.prepare('SELECT token_id FROM access_token_secrets').all().length,
      0,
    );
    assert.equal(
      state.database.prepare('SELECT token_id FROM access_token_bindings').get().token_id,
      null,
    );
    assert.equal(tokens.credential('unbound-repository', remote, 'gitlab').token, '');
  },
);
test(
  'a failed transactional token save rolls back all rows and never reports raw storage errors',
  { timeout: 30000 },
  async (t) => {
    const { state, tokens, cipher } = await fixture(t);
    const port = {
      exec: (sql) => state.database.exec(sql),
      transaction: (work) => state.database.transaction(work),
      prepare(sql) {
        if (sql.startsWith('INSERT OR REPLACE INTO access_token_secrets'))
          throw Error('fixture-secret-in-native-error');
        return state.database.prepare(sql);
      },
    };
    const failing = new AccessTokensStore(port, cipher);
    const before = tokens.list();
    assert.throws(
      () => failing.save(null, { name: 'Fail', value: 'fixture-value', revision: before.revision }),
      (e) => e.kind === 'unavailable' && !e.message.includes('fixture-secret'),
    );
    assert.deepEqual(tokens.list(), before);
    assert.equal(
      state.database.prepare('SELECT count(*) AS count FROM access_token_secrets').get().count,
      0,
    );
  },
);
test(
  'missing token revision does not reset existing tokens or retain a failed kernel writer lock',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    f.save('Retained', 'fixture-retained');
    f.state.database.exec('DELETE FROM access_token_state');
    await f.state.close();
    await assert.rejects(
      openStateKernel(f.root, f.agentId, undefined, { backend: 'file' }),
      (e) => e.kind === 'corrupt',
    );
    const state = await AgentState.open(f.root, f.agentId);
    try {
      assert.equal(state.database.prepare('SELECT name FROM access_tokens').get().name, 'Retained');
      assert.equal(
        state.database.prepare('SELECT revision FROM access_token_state').get(),
        undefined,
      );
    } finally {
      await state.close();
    }
  },
);
