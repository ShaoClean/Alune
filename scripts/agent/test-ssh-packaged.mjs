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

import {
  HostWorkspace,
  openRemoteAgent,
  spawnAgent,
} from '../../packages/agent-client/dist/node.js';
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
git('remote', 'add', 'origin', 'https://github.com/team/repo.git');
const sshPassword = randomUUID();
const ssh = await fixtures.forwardingSSH({
  password: sshPassword,
  cwd: login,
  environment: { ...env, ALUNE_AGENT_DATA_DIR: remoteDir },
});
const credentials = { username: 'proxy-test', password: randomUUID() };
let heldFetches = 0;
const gitEndpoint = http.createServer((req, res) => {
  assert.equal(req.headers['proxy-authorization'], undefined);
  if (req.url.startsWith('/wait.git/')) {
    heldFetches++;
    return;
  }
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
  [
    '--require',
    path.resolve('packages/agent/tests/collaboration-provider.cjs'),
    path.resolve('packages/agent/tests/settings-fixture.cjs'),
    localDir,
  ],
  { env: { ...env, ALUNE_P6_FIXTURE: root } },
);
const local = localProc.client;
let remote, secondPeer, other;
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
        authType: 'password',
        password: sshPassword,
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
  const workspace = new HostWorkspace(local);
  remote = await workspace.connect(policy);
  const owner = remote.initialized.agentId;
  assert.notEqual(owner, local.initialized.agentId);
  const source = await local.registerRepository(repo);
  const target = await remote.registerRepository(repo);
  assert.equal(workspace.owner(target.resource), remote);
  assert.notDeepEqual(source.resource, target.resource);
  const state = async (client, r) => ({
    status: (await client.readRepository(r, 'status', {})).files.map((f) => f.path),
    log: (await client.readRepository(r, 'log', {})).commits.length,
    lfs: await client.readRepository(r, 'lfs', {}),
    submodules: await client.readRepository(r, 'submodules', {}),
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
  secondPeer = await fixtures.forwardingSSH({
    deny: true,
    password: sshPassword,
    cwd: login,
    environment: { ...env, ALUNE_AGENT_DATA_DIR: path.join(root, 'other agent') },
  });
  const profile2 = (
    await local.saveHostProfile(
      null,
      {
        name: 'other',
        host: '127.0.0.1',
        port: secondPeer.port,
        username: 'fixture',
        authType: 'password',
        password: sshPassword,
        privateKeyPath: null,
      },
      (await local.listHostProfiles()).revision,
    )
  ).hosts.find((h) => h.port === secondPeer.port);
  other = await workspace.connect({
    hostId: profile2.id,
    hostKey: createHash('sha256').update(Buffer.from(secondPeer.publicKey, 'base64')).digest('hex'),
    install: false,
  });
  const same = await other.registerRepository(repo);
  assert.equal(
    (await local.request('hosts.catalog')).hosts.find((h) => h.hostId === profile2.id).gitProxy,
    'blocked',
  );
  assert.equal(
    (await other.readRepository(same.resource, 'file', { path: 'file.txt' })).content,
    'base\n',
  );
  const blockedIntent = { kind: 'fetch', args: ['origin'], resource: same.resource };
  await assert.rejects(
    other.writeRepository({
      ...blockedIntent,
      revision: await other.prepareRepositoryWrite(blockedIntent),
      operationId: randomUUID(),
    }),
    /forwarding was denied/,
  );
  assert.notEqual(same.resource.agentId, target.resource.agentId);
  assert.equal(workspace.owner(same.resource), other);
  const combined = await workspace.catalog();
  assert.equal(
    combined.hosts.filter((h) => h.repositories.some((r) => r.path === target.path)).length,
    2,
  );
  const noNetwork = {
    view: 'all',
    state: 'all',
    search: '',
    projects: ['not-selected'],
    provider: '',
    account: '',
  };
  let discovery;
  for await (const page of workspace.reviews(noNetwork)) discovery = page;
  assert.deepEqual(discovery.unavailableAgentIds, []);
  assert.deepEqual(
    new Set(discovery.sources.map((s) => s.resource.agentId)),
    new Set([local.initialized.agentId, owner, other.initialized.agentId]),
  );
  const binding = await workspace.collaborationResource(target.resource);
  const cfg = await local.getAiSettings(),
    provider = cfg.providers.find((p) => p.id === 'openai');
  const saved = await local.saveAiProvider(
    provider.id,
    {
      ...provider,
      enabled: true,
      baseUrl: 'https://ai.fixture.invalid/v1',
      apiKey: 'fixture-ai-secret',
      models: [{ name: 'fixture', id: 'fixture', enabled: true }],
    },
    cfg.revision,
  );
  const prefs = await local.saveCommitPreferences(
    { ...saved.commit, providerId: provider.id, modelId: 'fixture' },
    saved.revision,
  );
  fs.writeFileSync(path.join(repo, 'file.txt'), 'STAGED_ONLY');
  git('add', 'file.txt');
  fs.writeFileSync(path.join(repo, 'file.txt'), 'PRIVATE_UNSTAGED');
  assert.equal(
    (
      await local.collaboration('ai.generate', {
        resource: binding,
        input: { revision: prefs.revision },
      })
    ).message,
    'fixture commit',
  );
  git('restore', '--staged', 'file.txt');
  git('restore', 'file.txt');
  const tokens = await local.saveAccessToken(null, {
    name: 'local only',
    value: 'fixture-review-secret',
    revision: (await local.listAccessTokens()).revision,
  });
  const q = { remote: 'origin', target: 'https://github.com/team/repo', provider: 'github' };
  await local.collaboration('reviews.applyToken', {
    resource: binding,
    input: { ...q, tokenId: tokens.tokens[0].id, revision: tokens.revision },
  });
  const detail = { ...q, number: 12 };
  const actions = await local.collaboration('reviews.actions', {
    resource: binding,
    input: detail,
  });
  const mutation = {
    ...detail,
    revision: actions.revision,
    action: 'comment',
    body: 'fixture',
    operationId: randomUUID(),
  };
  await assert.rejects(
    local.collaboration('reviews.mutate', { resource: binding, input: mutation }),
    { outcome: 'unknown' },
  );
  await assert.rejects(
    local.collaboration('reviews.mutate', { resource: binding, input: mutation }),
    { kind: 'duplicate-request' },
  );
  assert.equal((await local.getTask({ taskId: mutation.operationId })).task.state, 'unknown');
  assert.equal((await remote.getTask({ taskId: mutation.operationId })).task, null);
  assert.equal((await remote.listAccessTokens()).tokens.length, 0);
  assert.equal(fs.readFileSync(path.join(root, 'dispatched'), 'utf8'), 'comment\n');
  const otherEvents = [];
  other.onEvent((event) => otherEvents.push(event));
  await other.subscribe(['terminal:state', 'terminal:output', 'terminal:removed']);
  await terminal.terminalScenario(remote, target.resource, target.path);
  assert.deepEqual(otherEvents, []);
  assert.deepEqual(await other.request('terminals.list', {}), []);
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
  const sub = path.join(root, 'sub');
  git('clone', '--no-local', repo, sub);
  git('-c', 'protocol.file.allow=always', 'submodule', 'add', sub, 'dependency');
  git('commit', '-m', 'submodule');
  await write('submodules', ['sync']);
  await write('submodules', ['update']);
  git('remote', 'add', 'proxied', 'http://p7-git.invalid/test.git');
  await assert.rejects(write('fetch', ['proxied']));
  assert(proxy.records.some((r) => r.host === 'p7-git.invalid' && r.authorized));
  assert(ssh.commands.every((s) => !s.includes(credentials.password)));
  const commit = await write('createBranch', ['once-only']);
  const receipt = await remote.getTask({ taskId: commit.operationId });
  assert.equal(receipt.task.state, 'succeeded');
  assert.equal((await other.getTask({ taskId: commit.operationId })).task, null);
  git('remote', 'set-url', 'proxied', 'http://p7-git.invalid/wait.git');
  const pendingFetch = async () => {
    const intent = { resource: target.resource, kind: 'fetch', args: ['proxied'] };
    const request = {
      ...intent,
      revision: await remote.prepareRepositoryWrite(intent),
      operationId: randomUUID(),
    };
    const failure = remote.writeRepository(request).then(
      () => null,
      (e) => e,
    );
    return { request, failure };
  };
  const cancel = await pendingFetch();
  await terminal.until(() => heldFetches === 1, 'cancel target reached upstream');
  await remote.request('repositories.cancelWrite', {
    resource: target.resource,
    operationId: cancel.request.operationId,
  });
  assert(await cancel.failure);
  assert.equal((await remote.health()).status, 'ok');
  const interrupted = await pendingFetch();
  await terminal.until(() => heldFetches === 2, 'write reached upstream before SSH loss');
  const ended = new Promise((resolve) => remote.onClose(resolve));
  for (const peer of ssh.clients) peer.end();
  await ended;
  assert.equal((await interrupted.failure).outcome, 'unknown');
  assert.throws(() => workspace.owner(target.resource));
  catalog = await local.request('hosts.catalog');
  assert.equal(catalog.hosts.find((h) => h.hostId === host.id).stale, true);
  assert.equal(catalog.hosts.find((h) => h.hostId === profile2.id).stale, false);
  assert.equal((await other.health()).status, 'ok');
  assert.equal(catalog.hosts.find((h) => h.hostId === host.id).repositories[0].id, target.id);
  other.close();
  // Do not retry a write. Wait for the old Agent to release its state and connect explicitly.
  await terminal.until(
    () => !fs.readdirSync(path.join(login, '.alune-ssh')).some((s) => s.startsWith('run-')),
    'remote process disposal',
  );
  remote = await openRemoteAgent(local, { ...policy, install: false });
  assert.equal(remote.initialized.agentId, owner);
  assert.deepEqual(await remote.getTask({ taskId: commit.operationId }), receipt);
  assert.equal(
    (await local.request('hosts.catalog')).hosts.find((h) => h.hostId === host.id).stale,
    false,
  );
  const interruptedReceipt = await remote.getTask({ taskId: interrupted.request.operationId });
  assert(interruptedReceipt.task && interruptedReceipt.task.state !== 'running');
  await assert.rejects(
    remote.writeRepository(interrupted.request),
    (e) => e.kind === 'duplicate-request',
  );
  assert.equal(heldFetches, 2);
  const release = path.join(
    localDir,
    'ssh-bundles',
    process.platform + '-' + process.arch,
    'release.json',
  );
  const original = fs.readFileSync(release, 'utf8');
  const closed = new Promise((resolve) => remote.onClose(resolve));
  remote.close();
  await closed;
  await terminal.until(
    () => !fs.readdirSync(path.join(login, '.alune-ssh')).some((s) => s.startsWith('run-')),
    'second process disposal',
  );
  fs.writeFileSync(release, JSON.stringify({ ...JSON.parse(original), version: 'unknown' }));
  await assert.rejects(
    openRemoteAgent(local, { ...policy, install: false }),
    (e) => e.kind === 'incompatible-version',
  );
  fs.writeFileSync(release, JSON.stringify({ ...JSON.parse(original), sha256: 'a'.repeat(64) }));
  await assert.rejects(openRemoteAgent(local, { ...policy, install: false }), /explicit upgrade/);
  await assert.rejects(openRemoteAgent(local, policy), /checksum mismatch/);
  fs.writeFileSync(release, original);
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
        'submodule sync/update',
        'cancel',
        'interrupted write not replayed',
        'unknown version and damaged upgrade',
        'offline catalog',
        'reconnect receipt',
        'damaged archive refused',
      ],
    }),
  );
} finally {
  other?.close();
  remote?.close();
  await localProc.close();
  secondPeer?.close();
  ssh.close();
  proxy.close();
  gitEndpoint.close();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
