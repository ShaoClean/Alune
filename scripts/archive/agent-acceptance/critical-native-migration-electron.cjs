// Local-only fixture: unique application identity, synthetic data and a private
// destination Keychain. Does not invoke or relax the hosted-only installer drill.
const { app, safeStorage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID, createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const root = fs.realpathSync(process.env.ALUNE_CRITICAL_FIXTURE);
assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
assert.match(path.basename(root), /^alune-critical-native-/);
const marker = JSON.parse(fs.readFileSync(path.join(root, 'fixture-marker.json')));
assert.match(marker.name, /^Alune Critical [a-f0-9-]{36}$/);
app.setName(marker.name);
app.setPath('userData', path.join(root, 'electron-data'));
app.disableHardwareAcceleration();
async function main() {
  const oldAsar = path.join(process.env.ALUNE_CRITICAL_RELEASE_APP, 'Contents/Resources/app.asar');
  const oldRequire = createRequire(path.join(oldAsar, 'package.json'));
  const Database = oldRequire('better-sqlite3');
  const { createAiSecretStorage } = oldRequire('./ai-secret-storage.cjs');
  const { AccessTokensService } = oldRequire('./server/access-tokens/access-tokens.service.js');
  const { AiSettingsStore } = oldRequire('./server/ai/ai-settings.js');
  const { ProxySettingsStore } = oldRequire('./server/proxy/proxy-settings.js');
  const native = createAiSecretStorage(safeStorage);
  assert.equal(native.available, true, 'native safeStorage is required, never skip or use fallback');
  const ciphertexts = new Set(); let decryptions = 0;
  const cipher = { ...native, encrypt(value) { const out = native.encrypt(value); ciphertexts.add(out); return out; }, decrypt(value) { decryptions++; return native.decrypt(value); } };
  const source = path.join(root, 'legacy'), repository = path.join(root, 'repository');
  fs.mkdirSync(source, { mode: 0o700 }); fs.mkdirSync(repository, { mode: 0o700 });
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(root, 'empty.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' } });
  git('init', '-qb', 'main'); git('config', 'user.name', 'Critical fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(repository, 'file.txt'), 'committed\n'); git('add', '.'); git('-c', 'commit.gpgSign=false', 'commit', '-qm', 'fixture');
  fs.writeFileSync(path.join(repository, 'file.txt'), 'staged\n'); git('add', '.'); fs.writeFileSync(path.join(repository, 'file.txt'), 'unstaged\n');
  const hostId = randomUUID(), keyHostId = randomUUID(), repoId = randomUUID(), localId = randomUUID();
  const remote = { name: 'origin', host: 'fixture.invalid', project: 'team/repo', webUrl: 'https://fixture.invalid/team/repo', provider: 'gitlab' };
  let db = new Database(path.join(source, 'alune.db'));
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE connections (id TEXT PRIMARY KEY,name TEXT NOT NULL,host TEXT NOT NULL,port INTEGER DEFAULT 22,username TEXT NOT NULL,auth_type TEXT NOT NULL DEFAULT 'password',password TEXT,private_key_path TEXT,passphrase TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE repositories (id TEXT PRIMARY KEY,connection_id TEXT,source TEXT NOT NULL,name TEXT NOT NULL,path TEXT NOT NULL,pinned INTEGER DEFAULT 0,created_at TEXT,worktree_kind TEXT,FOREIGN KEY(connection_id) REFERENCES connections(id));`);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(hostId, 'Fixture', 'fixture.invalid', 22, 'fixture', 'password', 'critical-fixture-ssh-password', null, 'critical-fixture-key-passphrase', now, now);
  db.prepare('INSERT INTO connections VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(keyHostId, 'Key fixture', 'key.fixture.invalid', 22, 'fixture', 'privateKey', null, path.join(root, 'fixture-key'), 'critical-fixture-key-passphrase', now, now);
  db.prepare('INSERT INTO repositories VALUES (?,?,?,?,?,?,?,?)').run(repoId, hostId, 'ssh', 'Remote fixture', '/fixture/repository', 0, now, null);
  db.prepare('INSERT INTO repositories VALUES (?,?,?,?,?,?,?,?)').run(localId, null, 'local', 'Local fixture', repository, 0, now, null);
  let tokens = new AccessTokensService(db, cipher, { server: { emit() {} } });
  const token = tokens.save(null, { name: 'Critical fixture', value: 'critical-fixture-token', revision: tokens.list().revision }).tokens[0];
  tokens.apply(repoId, remote, { remote: remote.name, target: remote.webUrl, provider: 'gitlab', tokenId: token.id, revision: tokens.list().revision });
  const ai = new AiSettingsStore(path.join(source, 'ai-settings.json'), cipher), aiInitial = ai.read(), provider = aiInitial.providers[0];
  ai.saveProvider(provider.id, { ...provider, enabled: true, apiKey: 'critical-fixture-ai-key' }, aiInitial.revision);
  const proxy = new ProxySettingsStore(path.join(source, 'network-proxy.json'), cipher);
  proxy.save({ ...proxy.read(), enabled: true, host: '127.0.0.1', authEnabled: true, credentials: { action: 'replace', username: 'fixture', password: 'critical-fixture-proxy-password' } });
  const workspace = { version: 1, state: { repositorySession: { ids: [localId, repoId], activeId: localId }, connectionOrder: [hostId], repositoryOrderByConnection: { '@local': [localId], [hostId]: [repoId] }, appearance: { theme: 'dark' } } };
  fs.writeFileSync(path.join(source, 'workspace.json'), JSON.stringify(workspace), { mode: 0o600 });
  fs.writeFileSync(path.join(source, 'logging.json'), JSON.stringify({ customDirectory: null, level: 'WARN', retentionDays: 30, maxTotalMB: 250 }), { mode: 0o600 });
  db.close(); db = undefined; tokens = undefined;
  // Copy the complete stopped fixture directory, not a selected file list.
  const backup = path.join(root, 'complete-pre-migration-backup');
  fs.cpSync(source, backup, { recursive: true, preserveTimestamps: true });
  const hashTree = dir => Object.fromEntries(fs.readdirSync(dir).sort().map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex')]));
  const originals = hashTree(source); assert.deepEqual(hashTree(backup), originals);
  fs.writeFileSync(path.join(root, 'legacy-fixture.json'), JSON.stringify({ source, repository, hostId, keyHostId, repoId, tokenId: token.id, remote, workspace }), { mode: 0o600 });
  const { bridgeLegacyAgentSecrets } = require("../../../apps/desktop/src/legacy-agent-secrets.cjs");
  decryptions = 0; // Binding above deliberately verifies the old token once.
  const child = spawn(process.env.ALUNE_CRITICAL_NODE, [path.join(__dirname, 'critical-native-migration-worker.cjs')], { env: process.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const dispose = bridgeLegacyAgentSecrets(child, cipher, ciphertexts);
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
  try {
    assert.equal(await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }), 0);
  } finally { clearTimeout(timer); dispose(); }
  assert.equal(decryptions, ciphertexts.size);
  assert.equal(ciphertexts.size, 3);
  assert.deepEqual(hashTree(source), originals);
  // Destroy and restore only this synthetic old profile. Then use the actual
  // released stores to decrypt every protected value from the restored bytes.
  fs.rmSync(source, { recursive: true }); fs.cpSync(backup, source, { recursive: true });
  assert.deepEqual(hashTree(source), originals);
  db = new Database(path.join(source, 'alune.db'));
  try {
    tokens = new AccessTokensService(db, native, { server: { emit() {} } });
    assert.equal(tokens.credential(repoId, remote, 'gitlab').token, 'critical-fixture-token');
    assert.equal(new AiSettingsStore(path.join(source, 'ai-settings.json'), native).key('openai'), 'critical-fixture-ai-key');
    assert.equal(new ProxySettingsStore(path.join(source, 'network-proxy.json'), native).snapshot().credentials.password, 'critical-fixture-proxy-password');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(source, 'workspace.json'))), workspace);
  } finally { db.close(); }
  assert.deepEqual(hashTree(source), originals);
  fs.writeFileSync(path.join(root, 'electron-result.json'), JSON.stringify({ result: 'passed', releasedModules: true, safeStorageAvailable: true, privateDecryptions: decryptions, completeSourceBackupByteVerified: true, restoredReleasedStoresDecrypt: true, applicationName: marker.name }, null, 2));
}
app.whenReady().then(main).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
