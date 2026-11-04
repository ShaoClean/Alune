const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { AgentState } = require('../dist/adapters/sqlite/state');
const { importLegacyState } = require('../dist/modules/migration/legacy');
const { openProtectedSecrets } = require('../dist/adapters/secrets/protected');
const { AiSettingsStore, ProxySettingsStore } = require('../dist/modules/settings');
const { AccessTokensStore, HostProfilesStore } = require('../dist/modules/accounts');
const { makeLegacy } = require('./legacy-fixture.cjs');
async function fixture(t, sourceCipher) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-legacy-import-'));
  const legacy = makeLegacy(root, sourceCipher);
  const target = path.join(root, 'agent');
  const state = await AgentState.open(target, randomUUID());
  t.after(async () => {
    await state.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const hashes = () =>
    Object.fromEntries(
      fs
        .readdirSync(legacy.source)
        .filter((name) => !name.endsWith('-shm'))
        .map((name) => [
          name,
          createHash('sha256')
            .update(fs.readFileSync(path.join(legacy.source, name)))
            .digest('hex'),
        ]),
    );
  return {
    root,
    target,
    state,
    legacy,
    hashes,
    run: (options) =>
      importLegacyState(state, legacy.source, { secretOptions: { backend: 'file' }, ...options }),
  };
}
test(
  'legacy import preserves IDs, all credentials, UI references and Git content without modifying its source',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const repo = path.join(f.root, 'repository');
    fs.mkdirSync(repo);
    const git = (...args) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q');
    fs.writeFileSync(path.join(repo, 'file.txt'), 'committed\n');
    git('add', 'file.txt');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'fixture',
    );
    fs.appendFileSync(path.join(repo, 'file.txt'), 'uncommitted\n');
    const head = git('rev-parse', 'HEAD'),
      index = fs.readFileSync(path.join(repo, '.git/index')),
      working = fs.readFileSync(path.join(repo, 'file.txt'));
    const before = f.hashes();
    const receipt = await f.run();
    assert.deepEqual(receipt.counts, {
      hosts: 1,
      repositories: 2,
      tokens: 1,
      bindings: 1,
      documents: 4,
      unresolvedReferences: 0,
    });
    assert.deepEqual(f.hashes(), before);
    assert.equal(git('rev-parse', 'HEAD'), head);
    assert.deepEqual(fs.readFileSync(path.join(repo, '.git/index')), index);
    assert.deepEqual(fs.readFileSync(path.join(repo, 'file.txt')), working);
    const cipher = await openProtectedSecrets(
      f.target,
      f.state.agentId,
      f.state.document('credential-key'),
      { backend: 'file', allowInitialize: false },
    );
    try {
      assert.equal(
        new HostProfilesStore(f.state.database, cipher).credential(f.legacy.hostId).password,
        'fixture-ssh-password',
      );
      assert.equal(
        new AccessTokensStore(f.state.database, cipher).credential(
          f.legacy.repoId,
          f.legacy.remote,
          'gitlab',
        ).token,
        'fixture-import-token',
      );
      assert.equal(
        new AiSettingsStore(f.state.document('ai-settings'), cipher).key('openai'),
        'fixture-import-ai-key',
      );
      assert.equal(
        new ProxySettingsStore(f.state.document('network-proxy'), cipher).snapshot().credentials
          .password,
        'fixture-import-proxy-password',
      );
      assert.deepEqual(f.state.document('workspace-preferences').read(), f.legacy.workspace);
      assert.equal(f.state.document('logging-settings').read().settings.level, 'WARN');
    } finally {
      cipher.close();
    }
    assert.equal(
      f.state.database.prepare('SELECT id FROM resource_ids WHERE id = ?').get(f.legacy.repoId).id,
      f.legacy.repoId,
    );
    const rows = f.state.database.prepare('SELECT * FROM connections').all();
    assert.doesNotMatch(JSON.stringify(rows), /fixture-ssh-password|fixture-unused-passphrase/);
    const repeated = await f.run();
    assert.equal(repeated.alreadyImported, true);
    assert.equal(repeated.importId, receipt.importId);
    assert.equal(f.state.database.prepare('SELECT count(*) AS n FROM imports').get().n, 1);
    assert(fs.existsSync(path.join(f.target, 'backups', receipt.stateBackupId, 'manifest.json')));
    const changed = JSON.parse(fs.readFileSync(path.join(f.legacy.source, 'workspace.json')));
    changed.state.appearance.theme = 'light';
    fs.writeFileSync(path.join(f.legacy.source, 'workspace.json'), JSON.stringify(changed));
    await assert.rejects(f.run(), (e) => e.kind === 'conflict');
    assert.deepEqual(f.state.document('workspace-preferences').read(), f.legacy.workspace);
  },
);
test(
  'corrupt JSON, missing source key and pre-cancel never replace old data or partially import',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const json = path.join(f.legacy.source, 'ai-settings.json'),
      original = fs.readFileSync(json);
    fs.writeFileSync(json, '{damaged');
    await assert.rejects(f.run(), (e) => e.kind === 'corrupt');
    assert.equal(fs.readFileSync(json, 'utf8'), '{damaged');
    assert.equal(f.state.database.prepare('SELECT count(*) AS n FROM connections').get().n, 0);
    fs.writeFileSync(json, original);
    const key = path.join(f.legacy.source, 'ai-master-key');
    fs.rmSync(key);
    await assert.rejects(f.run(), (e) => e.kind === 'unavailable');
    assert.equal(fs.existsSync(key), false);
    for (const table of ['connections', 'repositories', 'access_tokens', 'imports'])
      assert.equal(f.state.database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
    await assert.rejects(f.run({ signal: AbortSignal.abort() }), (e) => e.name === 'AbortError');
  },
);
test(
  'safeStorage values require an explicit private decryptor and an interrupted import stays atomic',
  { timeout: 60000 },
  async (t) => {
    const values = new Map();
    const fake = {
      available: true,
      description: 'Synthetic source fixture',
      encrypt(value) {
        const encrypted = 'safe-storage:' + Buffer.from(randomUUID()).toString('base64');
        values.set(encrypted, value);
        return encrypted;
      },
      decrypt(value) {
        if (!values.has(value)) throw Error();
        return values.get(value);
      },
    };
    const f = await fixture(t, fake);
    await assert.rejects(f.run(), (e) => e.kind === 'unavailable');
    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(
      f.run({
        signal: controller.signal,
        decryptSafeStorage: async (value) => {
          calls++;
          controller.abort();
          return fake.decrypt(value);
        },
      }),
      (e) => e.name === 'AbortError',
    );
    assert(calls > 0);
    assert.equal(f.state.database.prepare('SELECT count(*) AS n FROM connections').get().n, 0);
    const receipt = await f.run({ decryptSafeStorage: async (value) => fake.decrypt(value) });
    assert.equal(receipt.counts.tokens, 1);
    assert.doesNotMatch(JSON.stringify(receipt), /fixture-import-|safe-storage:|aes-gcm:/);
  },
);
test(
  'a target with existing configuration cannot be overwritten by legacy import',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const document = f.state.document('workspace-preferences');
    document.read();
    document.write({ retained: true });
    await assert.rejects(f.run(), (e) => e.kind === 'conflict');
    assert.deepEqual(document.read(), { retained: true });
    assert.equal(f.state.database.prepare('SELECT count(*) AS n FROM connections').get().n, 0);
  },
);

test(
  'an importer process crash inside the target transaction leaves no partial rows and can resume explicitly',
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t);
    const agentId = f.state.agentId;
    await f.state.close();
    const { spawnSync } = require('node:child_process');
    const child = spawnSync(
      process.execPath,
      [path.join(__dirname, 'legacy-crash-fixture.cjs'), f.target, f.legacy.source, agentId],
      { encoding: 'utf8', timeout: 45000 },
    );
    assert.equal(child.status, 7, child.stderr);
    const reopened = await AgentState.open(f.target, agentId);
    try {
      for (const table of ['connections', 'repositories', 'access_tokens', 'imports'])
        assert.equal(reopened.database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
      const receipt = await importLegacyState(reopened, f.legacy.source, {
        secretOptions: { backend: 'file' },
      });
      assert.equal(receipt.counts.hosts, 1);
    } finally {
      await reopened.close();
    }
  },
);

test(
  'source changes while credentials are decrypted abort import before business writes',
  { timeout: 60000 },
  async (t) => {
    const values = new Map();
    const fake = {
      available: true,
      description: 'Synthetic source',
      encrypt(value) {
        const key = 'safe-storage:' + Buffer.from(randomUUID()).toString('base64');
        values.set(key, value);
        return key;
      },
      decrypt(value) {
        return values.get(value);
      },
    };
    const f = await fixture(t, fake);
    let changed = false;
    await assert.rejects(
      f.run({
        decryptSafeStorage: async (encrypted) => {
          if (!changed) {
            changed = true;
            fs.appendFileSync(path.join(f.legacy.source, 'workspace.json'), ' ');
          }
          return fake.decrypt(encrypted);
        },
      }),
      (e) => e.kind === 'conflict',
    );
    assert.equal(f.state.database.prepare('SELECT count(*) AS n FROM connections').get().n, 0);
    assert.equal(f.state.database.prepare('SELECT count(*) AS n FROM imports').get().n, 0);
  },
);
