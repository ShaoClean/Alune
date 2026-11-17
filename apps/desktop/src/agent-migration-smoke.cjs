// Actual Electron safeStorage -> inherited Node IPC -> standalone Agent fixture.
// This is separate from UI smoke so platform encryption is tested without UI timing.
const { app, safeStorage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { finished } = require('node:stream/promises');
const Database = require('better-sqlite3');
const { createAiSecretStorage } = require('./ai-secret-storage.cjs');
const { bridgeLegacyAgentSecrets } = require('./legacy-agent-secrets.cjs');
const agentDist = path.dirname(require.resolve('@alune/agent'));
const { AgentState } = require(path.join(agentDist, 'adapters/sqlite/state'));
const { openProtectedSecrets } = require(path.join(agentDist, 'adapters/secrets/protected'));
const { privateDirectory } = require(path.join(agentDist, 'adapters/private-files'));
const { AiSettingsStore, ProxySettingsStore, FileJsonDocument } = require('@alune/agent/settings');
const {
  AccessTokensStore,
  HostProfilesStore,
  initializeAccessTokenTables,
} = require('@alune/agent/accounts');

const root = process.env.ALUNE_MIGRATION_FIXTURE;
if (
  process.env.CI !== 'true' ||
  !root ||
  !process.env.ALUNE_MIGRATION_NODE ||
  !process.env.ALUNE_MIGRATION_AGENT
)
  throw new Error(
    'Native migration fixture requires an isolated CI account and explicit test paths',
  );
app.setName('Alune Migration Fixture');
fs.mkdirSync(path.join(root, 'electron-data'), { recursive: true, mode: 0o700 });
app.setPath('userData', path.join(root, 'electron-data'));
app.disableHardwareAcceleration();

async function main() {
  await privateDirectory(root);
  const source = path.join(root, 'legacy'),
    target = path.join(root, 'agent');
  fs.mkdirSync(source, { mode: 0o700 });
  const native = createAiSecretStorage(safeStorage);
  const ciphertexts = new Set();
  let decryptions = 0;
  const cipher = {
    ...native,
    encrypt(value) {
      const encrypted = native.encrypt(value);
      ciphertexts.add(encrypted);
      return encrypted;
    },
    decrypt(value) {
      decryptions++;
      return native.decrypt(value);
    },
  };
  const db = new Database(path.join(source, 'alune.db'));
  const hostId = randomUUID(),
    repoId = randomUUID(),
    tokenId = randomUUID(),
    agentId = randomUUID();
  const now = new Date().toISOString();
  const remote = {
    name: 'origin',
    host: 'fixture.invalid',
    project: 'team/repo',
    webUrl: 'https://fixture.invalid/team/repo',
    provider: 'gitlab',
  };
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE connections (id TEXT PRIMARY KEY,name TEXT NOT NULL,host TEXT NOT NULL,port INTEGER DEFAULT 22,username TEXT NOT NULL,auth_type TEXT NOT NULL DEFAULT 'password',password TEXT,private_key_path TEXT,passphrase TEXT,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE repositories (id TEXT PRIMARY KEY,connection_id TEXT,source TEXT NOT NULL DEFAULT 'ssh',name TEXT NOT NULL,path TEXT NOT NULL,pinned INTEGER DEFAULT 0,created_at TEXT DEFAULT (datetime('now')),worktree_kind TEXT,FOREIGN KEY(connection_id) REFERENCES connections(id));`);
    db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      hostId,
      'Fixture host',
      'fixture.invalid',
      22,
      'fixture',
      'password',
      'native-fixture-ssh-password',
      null,
      null,
      now,
      now,
    );
    db.prepare('INSERT INTO repositories VALUES (?,?,?,?,?,?,?,?)').run(
      repoId,
      hostId,
      'ssh',
      'Fixture repository',
      '/fixture/repository',
      1,
      now,
      'main',
    );
    initializeAccessTokenTables(db);
    if (native.available) {
      const tokens = new AccessTokensStore(db, cipher, undefined, undefined, undefined, 'legacy');
      const token = tokens.save(null, {
        name: 'Native fixture',
        value: 'native-fixture-token',
        revision: tokens.list().revision,
      }).tokens[0];
      tokens.apply(repoId, remote, {
        remote: remote.name,
        target: remote.webUrl,
        provider: 'gitlab',
        tokenId: token.id,
        revision: tokens.list().revision,
      });
      const ai = new AiSettingsStore(
        new FileJsonDocument(path.join(source, 'ai-settings.json')),
        cipher,
      );
      const first = ai.read(),
        provider = first.providers[0];
      ai.saveProvider(
        provider.id,
        { ...provider, enabled: true, apiKey: 'native-fixture-ai-key' },
        first.revision,
      );
      const proxy = new ProxySettingsStore(
        new FileJsonDocument(path.join(source, 'network-proxy.json')),
        cipher,
      );
      proxy.save({
        ...proxy.read(),
        enabled: true,
        host: '127.0.0.1',
        authEnabled: true,
        credentials: {
          action: 'replace',
          username: 'fixture',
          password: 'native-fixture-proxy-password',
        },
      });
    } else {
      // An opaque record from a protected source must stay untouched when this
      // OS account has no safeStorage backend (for example headless Linux).
      const encrypted = 'safe-storage:' + randomBytes(48).toString('base64');
      ciphertexts.add(encrypted);
      db.prepare('INSERT INTO access_tokens VALUES (?,?,?,?,?,?,?)').run(
        tokenId,
        'Unavailable fixture',
        'unavailable fixture',
        randomUUID(),
        now,
        null,
        null,
      );
      db.prepare('INSERT INTO access_token_secrets VALUES (?,?)').run(tokenId, encrypted);
    }
  } finally {
    db.close();
  }
  const hashes = () =>
    Object.fromEntries(
      fs
        .readdirSync(source)
        .filter((name) => !name.endsWith('-shm'))
        .map((name) => [
          name,
          createHash('sha256')
            .update(fs.readFileSync(path.join(source, name)))
            .digest('hex'),
        ]),
    );
  const original = hashes();
  // A separate file-backed destination avoids writing permanent test accounts
  // into the system key store; real Keychain/DPAPI destinations have their own
  // standalone Agent native recovery tests.
  const initial = await AgentState.open(target, agentId);
  fs.writeFileSync(path.join(target, 'identity.json'), JSON.stringify({ agentId }), {
    mode: 0o600,
  });
  const initialCipher = await openProtectedSecrets(
    target,
    agentId,
    initial.document('credential-key'),
    { backend: 'file', allowInitialize: true },
  );
  initialCipher.close();
  await initial.close();
  decryptions = 0;
  async function importOnce() {
    const child = spawn(
      process.env.ALUNE_MIGRATION_NODE,
      [
        process.env.ALUNE_MIGRATION_AGENT,
        'legacy-import',
        '--source',
        source,
        '--data-dir',
        target,
      ],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true },
    );
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (value) => {
      stdout += value;
    });
    child.stderr.on('data', (value) => {
      stderr += value;
    });
    const dispose = bridgeLegacyAgentSecrets(child, cipher, ciphertexts);
    const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
    try {
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      await Promise.all(
        [child.stdout, child.stderr].map((stream) =>
          finished(stream, { readable: true, writable: false }),
        ),
      );
      assert.doesNotMatch(
        stdout + stderr,
        /native-fixture-(?:token|ai-key|proxy-password|ssh-password)|safe-storage:|aes-gcm:/,
      );
      return { code, stdout, stderr };
    } finally {
      clearTimeout(timeout);
      dispose();
    }
  }
  const result = await importOnce();
  assert.deepEqual(hashes(), original);
  const state = await AgentState.open(target, agentId);
  try {
    if (!native.available) {
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Legacy credentials require their original key/);
      assert.equal(decryptions, 0);
      assert.equal(state.database.prepare('SELECT count(*) AS n FROM connections').get().n, 0);
      assert.equal(state.database.prepare('SELECT count(*) AS n FROM imports').get().n, 0);
    } else {
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).counts.tokens, 1);
      assert.equal(decryptions, ciphertexts.size);
      const destination = await openProtectedSecrets(
        target,
        agentId,
        state.document('credential-key'),
        { backend: 'file', allowInitialize: false },
      );
      try {
        assert.equal(
          new HostProfilesStore(state.database, destination).credential(hostId).password,
          'native-fixture-ssh-password',
        );
        assert.equal(
          new AccessTokensStore(state.database, destination).credential(repoId, remote, 'gitlab')
            .token,
          'native-fixture-token',
        );
        assert.equal(
          new AiSettingsStore(state.document('ai-settings'), destination).key('openai'),
          'native-fixture-ai-key',
        );
        assert.equal(
          new ProxySettingsStore(state.document('network-proxy'), destination).snapshot()
            .credentials.password,
          'native-fixture-proxy-password',
        );
      } finally {
        destination.close();
      }
    }
  } finally {
    await state.close();
  }
  if (native.available) {
    const count = decryptions,
      repeated = await importOnce();
    assert.equal(repeated.code, 0, repeated.stderr);
    assert.equal(JSON.parse(repeated.stdout).alreadyImported, true);
    assert.equal(decryptions, count);
  }
  console.log(
    JSON.stringify({
      scenario: 'native-safeStorage-private-ipc-import',
      platform: process.platform,
      arch: process.arch,
      nativeAvailable: native.available,
      result: native.available
        ? 'credentials-migrated-and-duplicate-import-protected'
        : 'unavailable-source-retained-without-fallback',
    }),
  );
}
app
  .whenReady()
  .then(main)
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error);
      app.exit(1);
    },
  );
