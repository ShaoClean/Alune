const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');
const { localSecretStorage } = require('../dist/adapters/secrets/file');
const {
  FileJsonDocument,
  AiSettingsStore,
  ProxySettingsStore,
} = require('../dist/modules/settings');
const { AccessTokensStore, initializeAccessTokenTables } = require('../dist/modules/accounts');

function makeLegacy(root, sourceCipher) {
  const source = path.join(root, 'legacy');
  fs.mkdirSync(source, { mode: 0o700 });
  const cipher = sourceCipher ?? localSecretStorage(source);
  const db = new Database(path.join(source, 'alune.db'));
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE connections (id TEXT PRIMARY KEY,name TEXT NOT NULL,host TEXT NOT NULL,port INTEGER DEFAULT 22,username TEXT NOT NULL,auth_type TEXT NOT NULL DEFAULT 'password',password TEXT,private_key_path TEXT,passphrase TEXT,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE repositories (id TEXT PRIMARY KEY,connection_id TEXT,source TEXT NOT NULL DEFAULT 'ssh' CHECK(source IN ('local','ssh')),name TEXT NOT NULL,path TEXT NOT NULL,pinned INTEGER DEFAULT 0,created_at TEXT DEFAULT (datetime('now')),worktree_kind TEXT,FOREIGN KEY(connection_id) REFERENCES connections(id));`);
  const hostId = randomUUID(),
    repoId = randomUUID(),
    localId = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    hostId,
    'Fixture host',
    'fixture.invalid',
    22,
    'fixture',
    'password',
    'fixture-ssh-password',
    null,
    'fixture-unused-passphrase',
    now,
    now,
  );
  db.prepare('INSERT INTO repositories VALUES (?,?,?,?,?,?,?,?)').run(
    repoId,
    hostId,
    'ssh',
    'Remote fixture',
    '/fixture/remote',
    1,
    now,
    'main',
  );
  db.prepare('INSERT INTO repositories VALUES (?,?,?,?,?,?,?,?)').run(
    localId,
    null,
    'local',
    'Local fixture',
    path.join(root, 'repository'),
    0,
    now,
    null,
  );
  initializeAccessTokenTables(db);
  const tokens = new AccessTokensStore(db, cipher, undefined, undefined, undefined, 'legacy');
  const token = tokens.save(null, {
    name: 'Fixture token',
    value: 'fixture-import-token',
    revision: tokens.list().revision,
  }).tokens[0];
  const remote = {
    name: 'origin',
    host: 'fixture.invalid',
    project: 'team/repo',
    webUrl: 'https://fixture.invalid/team/repo',
    provider: 'gitlab',
  };
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
    { ...provider, enabled: true, apiKey: 'fixture-import-ai-key' },
    first.revision,
  );
  const current = ai.read();
  ai.saveCommit(
    {
      ...current.commit,
      providerId: provider.id,
      modelId: provider.models[0].id,
      prompt: 'Fixture prompt',
    },
    current.revision,
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
      password: 'fixture-import-proxy-password',
    },
  });
  fs.writeFileSync(
    path.join(source, 'logging.json'),
    JSON.stringify({ customDirectory: null, level: 'WARN', retentionDays: 30, maxTotalMB: 250 }),
    { mode: 0o600 },
  );
  const workspace = {
    version: 1,
    state: {
      repositorySession: { ids: [repoId, localId], activeId: localId },
      connectionOrder: [hostId],
      collapsedConnectionIds: [],
      repositoryOrderByConnection: { [hostId]: [repoId], '@local': [localId] },
      appearance: { theme: 'dark' },
      layout: { leftPanelWidth: 300 },
    },
  };
  fs.writeFileSync(path.join(source, 'workspace.json'), JSON.stringify(workspace), { mode: 0o600 });
  db.close();
  cipher.close?.();
  return { source, hostId, repoId, localId, tokenId: token.id, remote, workspace };
}
module.exports = { makeLegacy };
