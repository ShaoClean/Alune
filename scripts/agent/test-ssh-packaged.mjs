// Run on every native target. The SSH peer executes actual platform commands in a
// disposable login directory; no system sshd, global keys or public ports are used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openRemoteAgent, spawnAgent } from '../../packages/agent-client/dist/node.js';
import fixtures from '../../packages/ssh-client/tests/helpers/proxy-fixture.cjs';
import terminal from '../../packages/agent/tests/terminal-scenario.cjs';
const pkg = path.resolve(process.argv[2]),
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alune-ssh-')));
const localDir = path.join(root, 'local'),
  remoteDir = path.join(root, 'remote state'),
  login = path.join(root, 'SSH login 中文');
const repo = path.join(root, 'project'),
  linked = path.join(root, 'linked');
for (const dir of [login, repo]) fs.mkdirSync(dir);
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'),
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};
const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
git('init', '-b', 'main');
git('config', 'core.autocrlf', 'false');
fs.writeFileSync(path.join(repo, 'file.txt'), 'base\n');
fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.txt\n');
git('add', '.');
git('commit', '-m', 'base');
git('remote', 'add', 'origin', 'https://github.com/fixture/example.git');
const ssh = await fixtures.forwardingSSH({
  cwd: login,
  environment: { ...env, ALUNE_AGENT_DATA_DIR: remoteDir },
});
const credentials = { username: 'proxy-test', password: randomUUID() };
const gitEndpoint = http.createServer((req, res) => {
  assert.equal(req.headers['proxy-authorization'], undefined);
  res.writeHead(404);
  res.end();
});
gitEndpoint.listen(0, '127.0.0.1');
await once(gitEndpoint, 'listening');
const proxy = await fixtures.httpProxy({
  credentials,
  map: (host, port) => ({
    host: '127.0.0.1',
    port: host === 'p7-git.invalid' ? gitEndpoint.address().port : port,
  }),
});
const localProc = spawnAgent(
  process.execPath,
  [path.resolve('packages/agent/tests/settings-fixture.cjs'), localDir],
  { env },
);
const local = localProc.client;
let remote;
try {
  await local.initialize();
  execFileSync(process.execPath, [path.resolve('scripts/agent/ssh-bundle.mjs'), pkg, localDir], {
    stdio: 'inherit',
  });
  const host = (
    await local.saveHostProfile(
      null,
      {
        name: 'test SSH',
        host: '127.0.0.1',
        port: ssh.port,
        username: 'fixture',
        authType: 'sshAgent',
        privateKeyPath: null,
      },
      (await local.listHostProfiles()).revision,
    )
  ).hosts[0];
  const policy = {
    hostId: host.id,
    hostKey: createHash('sha256').update(Buffer.from(ssh.publicKey, 'base64')).digest('hex'),
    install: true,
  };
  const config = await local.getProxySettings();
  await local.saveProxySettings({
    ...{ enabled: true, protocol: 'http', host: '127.0.0.1', port: proxy.port, authEnabled: true },
    revision: config.revision,
    credentials: { action: 'replace', ...credentials },
  });
  await assert.rejects(openRemoteAgent(local, { ...policy, hostKey: '0'.repeat(64) }));
  await assert.rejects(openRemoteAgent(local, { ...policy, install: false }), /install/i);
  remote = await openRemoteAgent(local, policy);
  const owner = remote.initialized.agentId;
  assert.notEqual(owner, local.initialized.agentId);
  const source = await local.registerRepository(repo);
  let target = await remote.registerRepository(repo);
  assert.notDeepEqual(source.resource, target.resource);
  const state = async (client, r) => ({
    status: (await client.readRepository(r, 'status', {})).files.map((f) => f.path),
    log: (await client.readRepository(r, 'log', {})).commits.length,
    file: (await client.readRepository(r, 'file', { path: 'file.txt' })).content,
    sources: (await client.collaboration('catalog.reviews.sources', { input: {} })).sources.map(
      (s) => s.remote.webUrl,
    ),
  });
  assert.deepEqual(await state(local, source.resource), await state(remote, target.resource));
  await assert.rejects(
    remote.request('repositories.get', { resource: source.resource }),
    (e) => e.kind === 'not-found',
  );
  await remote.listRepositories();
  let catalog = await local.request('hosts.catalog');
  assert.equal(catalog.local.length, 1);
  assert.equal(catalog.hosts[0].repositories.length, 1);
  assert.equal(catalog.hosts[0].gitAvailable, true);
  await terminal.terminalScenario(remote, target.resource, target.path);
  const write = async (kind, args, r = target.resource) => {
    const intent = { kind, args, resource: r },
      operationId = randomUUID();
    const result = await remote.writeRepository({
      ...intent,
      revision: await remote.prepareRepositoryWrite(intent),
      operationId,
    });
    return { result, operationId };
  };
  const tree = (await write('createWorktree', [linked, 'new-tree'])).result;
  await assert.rejects(write('removeWorktree', [target.path, true]));
  git('worktree', 'lock', linked);
  await assert.rejects(write('removeWorktree', [tree.path, true]));
  git('worktree', 'unlock', linked);
  for (const name of ['file.txt', 'ignored.txt', 'untracked.txt']) {
    fs.writeFileSync(path.join(linked, name), 'keep');
    await assert.rejects(write('removeWorktree', [tree.path, true]));
    assert.equal(fs.readFileSync(path.join(linked, name), 'utf8'), 'keep');
    if (name === 'file.txt') git('-C', linked, 'restore', name);
    else fs.unlinkSync(path.join(linked, name));
  }
  await write('removeWorktree', [tree.path, true]);
  assert(!fs.existsSync(linked));
  git('remote', 'add', 'proxied', 'http://p7-git.invalid/test.git');
  await assert.rejects(write('fetch', ['proxied']));
  assert(proxy.records.some((r) => r.host === 'p7-git.invalid' && r.authorized));
  assert(ssh.commands.every((s) => !s.includes(credentials.password)));
  const commit = await write('createBranch', ['once-only']);
  const receipt = await remote.getTask({ taskId: commit.operationId });
  assert.equal(receipt.task.state, 'succeeded');
  const ended = new Promise((resolve) => remote.onClose(resolve));
  for (const peer of ssh.clients) peer.end();
  await ended;
  catalog = await local.request('hosts.catalog');
  assert.equal(catalog.hosts[0].stale, true);
  assert.equal(catalog.hosts[0].repositories[0].id, target.id);
  // Do not retry a write. Wait for the old Agent to release its state and connect explicitly.
  await terminal.until(
    () => !fs.readdirSync(path.join(login, '.alune-ssh')).some((s) => s.startsWith('run-')),
    'remote process disposal',
  );
  remote = await openRemoteAgent(local, { ...policy, install: false });
  assert.equal(remote.initialized.agentId, owner);
  assert.deepEqual(await remote.getTask({ taskId: commit.operationId }), receipt);
  assert.equal((await local.request('hosts.catalog')).hosts[0].stale, false);
  const closed = new Promise((resolve) => remote.onClose(resolve));
  remote.close();
  await closed;
  await terminal.until(
    () => !fs.readdirSync(path.join(login, '.alune-ssh')).some((s) => s.startsWith('run-')),
    'second process disposal',
  );
  const archive = fs.readdirSync(path.join(login, '.alune-ssh')).find((s) => s.endsWith('.tar.gz'));
  fs.appendFileSync(path.join(login, '.alune-ssh', archive), 'damage');
  await assert.rejects(openRemoteAgent(local, { ...policy, install: false }));
  console.log(
    JSON.stringify({
      target: process.platform + '-' + process.arch,
      owner,
      verified: [
        'SSH pin',
        'install',
        'Agent parity',
        'worktree safeguards',
        'PTY ACK',
        'proxy fetch',
        'offline catalog',
        'reconnect receipt',
        'damaged archive refused',
      ],
    }),
  );
} finally {
  remote?.close();
  await localProc.close();
  ssh.close();
  proxy.close();
  gitEndpoint.close();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
