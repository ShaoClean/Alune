import terminalChecks from '../../packages/agent/tests/terminal-scenario.cjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { spawnAgent } from '../../packages/agent-client/dist/node.js';

const directory = path.resolve(process.argv[2] ?? '');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
if (process.argv.includes('--require-clean'))
  assert.equal(manifest.dirty, false, 'Package source was not a clean checkout');
assert.equal(manifest.target, `${process.platform}-${process.arch}`);
for (const [file, expected] of Object.entries(manifest.files)) {
  const actual = createHash('sha256')
    .update(fs.readFileSync(path.join(directory, file)))
    .digest('hex');
  assert.equal(actual, expected, `Hash mismatch: ${file}`);
}
const node = path.join(directory, manifest.node.executable);
const entry = path.join(directory, 'node_modules/@alune/agent/bin/alune-agent.cjs');
const version = JSON.parse(execFileSync(node, [entry, 'version'], { encoding: 'utf8' }));
assert.equal(version.version, manifest.version);
const doctor = JSON.parse(
  execFileSync(node, [entry, 'doctor'], { encoding: 'utf8', timeout: 15000 }),
);
assert.equal(doctor.ok, true);
assert.deepEqual(doctor.native, { sqlite: true, pty: true });
assert.equal(doctor.node, `v${manifest.node.version}`);
// This check runs from the packaged entry, not from the checkout's module graph.
const require = createRequire(entry);
for (const name of ['electron', 'server', 'web', 'ssh2', '@alune/ssh-client'])
  assert.throws(() => require.resolve(name), { code: 'MODULE_NOT_FOUND' });
for (const [location, pkg] of Object.entries(manifest.packages)) {
  const base = path.join(directory, location);
  const metadata = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
  assert.equal(metadata.version, pkg.version);
  const localRequire = createRequire(path.join(base, 'package.json'));
  for (const dependency of Object.keys(metadata.dependencies ?? {})) {
    let resolved;
    try {
      resolved = localRequire.resolve(dependency);
    } catch {
      resolved = localRequire.resolve(dependency + '/package.json');
    }
    assert(
      fs.realpathSync(resolved).startsWith(fs.realpathSync(directory) + path.sep),
      `${dependency} escaped isolated bundle`,
    );
  }
}
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-packaged-session-'));
const children = [];
try {
  // Exercise the packaged native adapter with the packaged Node executable.
  // macOS uses a disposable Keychain, never the user's login Keychain.
  const secretProbe = `
    const fs = require('node:fs');
    const path = require('node:path');
    const assert = require('node:assert/strict');
    const { randomBytes, randomUUID } = require('node:crypto');
    const { execFileSync } = require('node:child_process');
    (async () => {
      const base = process.argv[1], root = process.argv[2];
      if (process.platform === 'darwin') {
        const { keychainMasterKey } = require(path.join(base, 'dist/adapters/secrets/keychain'));
        const file = path.join(root, 'fixture.keychain-db');
        const password = randomBytes(24).toString('base64');
        const security = (...args) => execFileSync('/usr/bin/security', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
        let created = false;
        try {
          security('create-keychain', '-p', password, file); created = true;
          security('unlock-keychain', '-p', password, file);
          const account = randomUUID();
          const key = await keychainMasterKey(account, { create: true, keychain: file });
          assert.equal(key.length, 32);
          const reread = await keychainMasterKey(account, { create: false, keychain: file });
          assert.deepEqual(reread, key); reread.fill(0); key.fill(0);
          security('lock-keychain', file);
          await assert.rejects(keychainMasterKey(account, { create: true, keychain: file }));
        } finally { if (created) security('delete-keychain', file); }
      } else if (process.platform === 'win32') {
        const { dpapi } = require(path.join(base, 'dist/adapters/secrets/dpapi'));
        const key = randomBytes(32), scope = randomUUID();
        try {
          const sealed = await dpapi('protect', key, scope);
          const recovered = await dpapi('unprotect', sealed, scope);
          assert.deepEqual(recovered, key); recovered.fill(0);
          await assert.rejects(dpapi('unprotect', sealed, randomUUID()));
        } finally { key.fill(0); }
      }
      process.stdout.write('native-secret-adapter-ok');
    })().catch(() => { process.stderr.write('Packaged native secret adapter failed'); process.exitCode = 1; });
  `;
  assert.equal(
    execFileSync(node, ['-e', secretProbe, path.dirname(path.dirname(entry)), data], {
      encoding: 'utf8',
      timeout: 60000,
    }),
    'native-secret-adapter-ok',
  );
  let firstStderr = '';
  const a = spawnAgent(node, [entry, 'serve', '--data-dir', data], {
    onStderr: (text) => {
      firstStderr = (firstStderr + text).slice(-4096);
    },
  });
  children.push(a);
  const first = await a.client.initialize({ name: 'packaged-smoke', version: '1' });
  assert.equal((await a.client.health()).status, 'ok');
  assert((await a.client.capabilities()).capabilities.includes('events.subscribe'));
  await a.client.subscribe(['tasks.changed']);
  assert.deepEqual(await a.client.request('tasks.get', { requestId: 'missing' }), {
    scope: 'session',
    task: null,
  });
  const repositoryPath = path.join(data, 'repository');
  fs.mkdirSync(repositoryPath);
  const git = (...args) => execFileSync('git', ['-C', repositoryPath, ...args], { stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Packaged fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  fs.writeFileSync(path.join(repositoryPath, 'fixture.txt'), 'before\n');
  git('add', '.');
  git('commit', '-m', 'packaged fixture');
  fs.writeFileSync(path.join(repositoryPath, 'fixture.txt'), 'after\n');
  const repository = await a.client.registerRepository(repositoryPath);
  assert.equal(
    (await a.client.readRepository(repository.resource, 'status', {})).files[0].path,
    'fixture.txt',
  );
  assert.match(
    await a.client.readRepository(repository.resource, 'diff', {
      file: 'fixture.txt',
      fullFile: true,
    }),
    /after/,
  );
  assert.equal((await a.client.readRepository(repository.resource, 'log', {})).commits.length, 1);
  assert.equal(
    (await a.client.readRepository(repository.resource, 'file', { path: 'fixture.txt' })).content,
    'after\n',
  );
  await terminalChecks.terminalScenario(a.client, repository.resource, repository.path);
  const mutate = async (kind, args) => {
    const intent = { resource: repository.resource, kind, args };
    const request = {
      ...intent,
      revision: await a.client.prepareRepositoryWrite(intent),
      operationId: randomUUID(),
    };
    await a.client.writeRepository(request);
    return request;
  };
  await mutate('stage', [['fixture.txt']]);
  const committed = await mutate('commit', ['packaged write']);
  assert.equal(git('log', '-1', '--format=%s').toString().trim(), 'packaged write');
  const settings = await a.client.getAiSettings();
  assert.equal(settings.secretStorage.available, false);
  const update = a.client.startRequest('settings.ai.saveCommit', {
    revision: settings.revision,
    commit: { ...settings.commit, prompt: 'Packaged state fixture' },
  });
  const saved = await update.result;
  const receipt = await a.client.getTask({ requestId: update.requestId });
  assert.equal(receipt.scope, 'agent');
  assert.equal(receipt.task.outcome, 'completed');
  assert.equal(fs.existsSync(path.join(data, 'keys')), false);
  await a.close();
  assert.equal(
    (await a.exited).code,
    0,
    firstStderr || 'First packaged Agent did not exit cleanly',
  );
  const b = spawnAgent(node, [entry, 'serve', '--data-dir', data]);
  children.push(b);
  const second = await b.client.initialize();
  assert.equal(second.agentId, first.agentId);
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal((await b.client.getAiSettings()).revision, saved.revision);
  assert.deepEqual(await b.client.getTask({ requestId: update.requestId }), receipt);
  assert.equal((await b.client.getTask({ taskId: committed.operationId })).task.state, 'succeeded');
  await assert.rejects(
    b.client.writeRepository(committed),
    (error) => error.kind === 'duplicate-request',
  );
  assert.equal(git('rev-list', '--count', 'HEAD').toString().trim(), '2');
  await b.close();
  assert.equal((await b.exited).code, 0);
  const capsule = path.join(data, 'fixture.recovery');
  const passphrase = Buffer.from('packaged-recovery-fixture-passphrase\n');
  const backup = JSON.parse(
    execFileSync(node, [entry, 'recovery-backup', '--data-dir', data, '--output', capsule], {
      input: passphrase,
      encoding: 'utf8',
      timeout: 60000,
    }),
  );
  assert.equal(backup.scope, 'identity-state-and-credentials');
  const restoredDirectory = path.join(data, 'restored');
  const restored = JSON.parse(
    execFileSync(
      node,
      [entry, 'recovery-restore', '--data-dir', restoredDirectory, '--input', capsule],
      {
        input: passphrase,
        encoding: 'utf8',
        timeout: 60000,
      },
    ),
  );
  passphrase.fill(0);
  assert.equal(restored.agentId, first.agentId);
  const c = spawnAgent(node, [entry, 'serve', '--data-dir', restoredDirectory]);
  children.push(c);
  assert.equal((await c.client.initialize()).agentId, first.agentId);
  assert.equal((await c.client.getAiSettings()).revision, saved.revision);
  await c.close();
  assert.equal((await c.exited).code, 0);
} finally {
  await Promise.all(children.map((child) => child.close()));
  fs.rmSync(data, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    target: manifest.target,
    sourceSha: manifest.sourceSha,
    filesVerified: Object.keys(manifest.files).length,
    protocol:
      'initialize/health/version/capabilities/subscription/tasks/EOF/restart identity passed',
    native: doctor.native,
    secretAdapter:
      process.platform === 'darwin'
        ? 'temporary-keychain'
        : process.platform === 'win32'
          ? 'dpapi-current-user'
          : 'file-backend-covered-by-agent-tests',
    state: 'configuration revision and mutation receipt survived restart',
    recovery: 'encrypted CLI capsule restored identity and public configuration',
    terminals: 'real repository PTY, independent renderer ACK, input/resize/exit/close passed',
    repositories: 'packaged registration/status/diff/log/file passed without ssh-client',
    node: doctor.node,
    electron: 'not resolvable',
  }),
);
