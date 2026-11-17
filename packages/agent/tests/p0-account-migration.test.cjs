// Disposable SQLite databases and synthetic ciphers only. No OS credential API.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const Database = require('better-sqlite3');
const { AccessTokensStore } = require('../dist/modules/accounts/access-tokens');
const { initializeAccessTokenTables } = require('../dist/adapters/sqlite/access-tokens');
const { migrateImportedAccessTokens } = require('../dist/adapters/migration/legacy-tokens');
const { StateFault } = require('../dist/ports/state');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const root = path.resolve(__dirname, '../../..');
class HttpException extends Error { constructor(message, status) { super(message); this.status = status; } getStatus() { return this.status; } }
const nest = { HttpException, Injectable: () => () => {}, Inject: () => () => {} };
for (const [name, status] of Object.entries({ BadRequestException: 400, ConflictException: 409, NotFoundException: 404, ServiceUnavailableException: 503 }))
  nest[name] = class extends HttpException { constructor(message) { super(message, status); } };
function frozen(name) {
  const file = 'apps/server/src/access-tokens/' + name + '.ts';
  const source = execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' });
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const mod = { exports: {} };
  vm.compileFunction(output, ['require', 'module', 'exports'], { filename: baseline + '/' + file })(name => {
    if (name === '@nestjs/common') return nest;
    if (name === '../secrets/secrets.module') return { SECRET_STORAGE: Symbol('synthetic') };
    if (name.startsWith('node:')) return require(name);
    throw Error('Unreviewed frozen dependency: ' + name);
  }, mod, mod.exports);
  return mod.exports;
}
const Legacy = frozen('access-tokens.service').AccessTokensService;
const oldMigration = frozen('access-token-migration').migrateImportedAccessTokens;
const remote = { name: 'origin', webUrl: 'https://git.example.invalid/team/repo', provider: 'gitlab' };
const cipher = {
  available: true, description: 'synthetic cipher', encrypt: value => 'aes-gcm:fixture:' + value,
  decrypt: value => { if (!value.startsWith('aes-gcm:fixture:')) throw Error('synthetic unreadable ciphertext'); return value.slice('aes-gcm:fixture:'.length); },
};
function fixture(t, legacy = false) {
  const db = new Database(':memory:'); t.after(() => db.close());
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE repositories(id TEXT PRIMARY KEY,name TEXT); INSERT INTO repositories VALUES('repo','Fixture');");
  const changes = [];
  let store;
  const secrets = { ...cipher };
  if (legacy) store = new Legacy(db, secrets, { server: { emit: (...args) => changes.push(args) } });
  else { initializeAccessTokenTables(db); store = new AccessTokensStore(db, secrets, () => changes.push(['access-tokens:changed'])); }
  const save = (name = 'Fixture', value = 'synthetic-token') => store.save(null, { name, value, revision: store.list().revision }).tokens.find(token => token.name === name);
  const apply = tokenId => store.apply('repo', remote, { remote: remote.name, target: remote.webUrl, provider: 'gitlab', tokenId, revision: store.list().revision });
  const message = fn => { try { fn(); assert.fail('Expected refusal'); } catch (error) { assert(error instanceof HttpException || error instanceof StateFault); return error.message; } };
  return { db, store, secrets, changes, save, apply, message };
}

test('P0 token revisions, transactions and notifications preserve atomic failure boundaries', t => {
  const snapshots = [];
  for (const legacy of [true, false]) {
    const f = fixture(t, legacy), initial = f.store.list();
    assert.equal(f.store.revision(), initial.revision);
    assert.match(f.message(() => f.store.mutate('stale', () => assert.fail('must not run'))), /已变化/);
    assert.deepEqual(f.store.list(), initial); assert.deepEqual(f.changes, []);
    assert.match(f.message(() => f.store.mutate(initial.revision, () => { f.db.prepare("INSERT INTO access_tokens VALUES('rolled-back','name','name','v','date',NULL,NULL)").run(); throw Error('controlled disk failure'); })), /保存失败/);
    assert.deepEqual(f.store.list(), initial); assert.deepEqual(f.changes, []);
    f.store.bump(); assert.notEqual(f.store.revision(), initial.revision);
    f.store.changed(); assert.equal(f.changes.length, 1);
    const token = f.save();
    assert.equal(f.store.row(token.id).name, 'Fixture');
    assert.match(f.message(() => f.store.row('missing')), /已删除/);
    assert.match(f.message(() => f.save('fixture')), /名称已存在/);
    const value = f.store.list();
    assert.doesNotMatch(JSON.stringify(value), /synthetic-token|ciphertext/);
    snapshots.push({ tokenNames: value.tokens.map(t => t.name), changes: f.changes.length });
  }
  assert.deepEqual(snapshots[1], snapshots[0]);
});

test('P0 token binding, credential snapshots and remote changes retain target isolation', t => {
  for (const legacy of [true, false]) {
    const f = fixture(t, legacy), token = f.save();
    assert.equal(f.store.binding('repo', 'origin'), undefined);
    assert.deepEqual(f.store.selection('repo', remote), { status: 'none', tokenId: null, provider: null, version: '' });
    f.apply(token.id);
    assert.equal(f.store.binding('repo', 'origin').target, remote.webUrl);
    assert.equal(f.store.selection('repo', remote).status, 'applied');
    assert.equal(f.store.selection('repo', remote).tokenId, token.id);
    assert.equal(f.store.decrypt(token.id), 'synthetic-token');
    const snapshot = f.store.credential('repo', remote, 'gitlab');
    assert.equal(snapshot.token, 'synthetic-token'); snapshot.assertCurrent();
    assert.match(f.message(() => f.store.credential('repo', { ...remote, webUrl: 'https://foreign.invalid/repo' }, 'gitlab')), /目标或平台已变化/);
    const stable = f.store.list().revision, count = f.changes.length;
    f.store.reconcile('repo', [remote]); assert.equal(f.store.list().revision, stable); assert.equal(f.changes.length, count);
    f.store.reconcile('repo', [{ ...remote, webUrl: 'https://foreign.invalid/repo' }]);
    assert.notEqual(f.store.list().revision, stable); assert.equal(f.changes.length, count + 1);
    assert.equal(f.store.selection('repo', remote).status, 'target-changed');
    assert.equal(f.store.selection('repo', remote).tokenId, null);
    f.store.reconcile('repo', [remote]); assert.equal(f.store.selection('repo', remote).status, 'target-changed');
    assert.match(f.message(snapshot.assertCurrent), /已变化/);
    f.apply(token.id);
    const current = f.store.credential('repo', remote, 'gitlab');
    f.store.delete(token.id, { revision: f.store.list().revision });
    assert.match(f.message(current.assertCurrent), /已变化/);
    assert.equal(f.store.selection('repo', remote).status, 'token-deleted');
    assert.equal(f.db.prepare('SELECT * FROM access_token_secrets').all().length, 0);
  }
});

test('P0 token unreadable secrets preserve rows and refuse credential rebinding', t => {
  for (const legacy of [true, false]) {
    const f = fixture(t, legacy), token = f.save(), before = f.store.list();
    f.secrets.available = false;
    assert.match(f.message(() => f.apply(token.id)), /无法解密/);
    assert.equal(f.store.binding('repo', 'origin'), undefined);
    assert.equal(f.store.list().revision, before.revision);
    assert.match(f.message(() => f.save('Second')), /加密存储不可用/);
    f.secrets.available = true;
    f.db.prepare('UPDATE access_token_secrets SET ciphertext = ? WHERE token_id = ?').run('corrupt', token.id);
    assert.match(f.message(() => f.store.decrypt(token.id)), /无法解密/);
    assert.equal(f.store.list().tokens.length, 1);
  }
});

test('P0 imported token migration rewraps every row atomically and retains failed originals', t => {
  for (const migrate of [oldMigration, migrateImportedAccessTokens]) {
    for (const failure of ['none', 'source', 'destination', 'second-row', 'sql']) {
      const { db, store, save } = fixture(t), a = save('First'), b = save('Second');
      // This adapter preserves the old standalone ciphertext format. Full Agent
      // import uses the separate bound-v1 conversion and recovery workflow.
      db.prepare('UPDATE access_token_secrets SET ciphertext = ? WHERE token_id = ?').run(cipher.encrypt('first'), a.id);
      db.prepare('UPDATE access_token_secrets SET ciphertext = ? WHERE token_id = ?').run(cipher.encrypt('second'), b.id);
      const snapshot = () => ({ tokens: db.prepare('SELECT * FROM access_tokens ORDER BY id').all(), secrets: db.prepare('SELECT * FROM access_token_secrets ORDER BY token_id').all(), revision: store.revision() });
      const before = snapshot();
      if (failure === 'sql') db.exec("CREATE TRIGGER fail_import BEFORE UPDATE ON access_token_state BEGIN SELECT RAISE(ABORT,'controlled failure'); END");
      let calls = 0;
      const source = { ...cipher, available: failure !== 'source' };
      const destination = { ...cipher, available: failure !== 'destination', encrypt: text => { if (failure === 'second-row' && ++calls === 2) throw Error('controlled encryption failure'); return 'rewrapped:' + text; } };
      assert.equal(migrate(db, source, destination), failure === 'none');
      const after = snapshot();
      if (failure === 'none') {
        assert.notEqual(after.revision, before.revision);
        assert(after.tokens.every(row => row.version !== before.tokens.find(old => old.id === row.id).version));
        assert.deepEqual(after.secrets.map(row => row.ciphertext).sort(), ['rewrapped:first', 'rewrapped:second']);
        const stable = snapshot(); assert.equal(migrate(db, source, destination), true); assert.deepEqual(snapshot(), stable);
      } else assert.deepEqual(after, before);
    }
    const empty = new Database(':memory:');
    try { assert.equal(migrate(empty, { available: false }, { available: false }), true); }
    finally { empty.close(); }
  }
});
