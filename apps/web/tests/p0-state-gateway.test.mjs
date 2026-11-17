// Complete frozen gateway + real local Agent/SDK/stdio/SQLite/Git.
// The host failure deliberately stops on a missing disposable key before opening a socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';
import { spawnAgent } from '@alune/agent-client/node';
import { subscribeWorkspaceEvents } from '../src/api/workspace-events.ts';
import { createAgentRepositoryQueries } from '../src/api/agent-repositories.ts';

const plain = (v) => JSON.parse(JSON.stringify(v));
function record(name, value) {
  if (process.env.P0_STATE_GATEWAY_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_STATE_GATEWAY_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function legacy() {
  assert(process.env.P0_STATE_GATEWAY_FROZEN, 'Use batch-19 replay driver');
  const source = fs.readFileSync(
    path.join(process.env.P0_STATE_GATEWAY_FROZEN, 'apps/server/src/events/events.gateway.ts'),
    'utf8',
  );
  const module = { exports: {} },
    metadata = [],
    sent = [];
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        experimentalDecorators: true,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require(id) {
        if (id === '@nestjs/websockets')
          return Object.fromEntries(
            ['WebSocketGateway', 'WebSocketServer', 'SubscribeMessage', 'ConnectedSocket'].map(
              (name) => [
                name,
                (...args) =>
                  (...target) => {
                    metadata.push({ name, args, member: target[1] });
                  },
              ],
            ),
          );
        if (id === '../logging/logger')
          return {
            logger: { debug() {} },
            logStore() {
              assert.fail('State emitters do not subscribe to logs');
            },
          };
        throw Error('Unexpected runtime import: ' + id);
      },
    },
    { filename: 'frozen/events.gateway.ts' },
  );
  const gateway = new module.exports.EventsGateway();
  gateway.server = {
    emit(name, payload) {
      sent.push({ name, payload: plain(payload) });
    },
  };
  return { gateway, sent, metadata };
}
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert(Date.now() < deadline, label);
    await delay(10);
  }
}
async function fixture(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const children = [];
  t.after(async () => {
    for (const child of children) await child.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(root, 'global'),
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_TERMINAL_PROMPT: '0',
  };
  async function owner(label, topics) {
    const state = path.join(root, label + '-state');
    let child, info, events;
    async function start() {
      child = spawnAgent(
        process.execPath,
        [
          path.resolve(import.meta.dirname, '../../../packages/agent/tests/settings-fixture.cjs'),
          state,
        ],
        { env },
      );
      children.push(child);
      info = await child.client.initialize();
      events = [];
      child.client.onEvent((e) => events.push(structuredClone(e)));
      await child.client.subscribe(topics);
    }
    await start();
    return {
      state,
      start,
      get child() {
        return child;
      },
      get info() {
        return info;
      },
      get events() {
        return events;
      },
    };
  }
  return { root, env, owner };
}
function assertEnvelope(owner) {
  assert(
    owner.events.every(
      (e) => e.agentId === owner.info.agentId && e.sessionId === owner.info.sessionId,
    ),
  );
  assert.deepEqual(
    owner.events.map((e) => e.sequence),
    owner.events.map((_, i) => i + 1),
  );
}

test('P0 state gateway complete frozen class emits connection status with optional fields and no-server guard', () => {
  const { gateway, sent, metadata } = legacy();
  const cases = [
    ['host-a', 'connecting'],
    ['host-a', 'connected', undefined, 1],
    ['host-b', 'disconnected', '', 0],
    ['host-b', 'error', 'controlled 中文\r\n', 12],
    ['host-b', 'legacy-extension', 'old emitter accepts arbitrary status', -1],
  ];
  for (const args of cases) assert.equal(gateway.emitConnectionStatus(...args), undefined);
  assert.deepEqual(
    sent,
    cases.map(([connectionId, status, error, updatedAt]) => ({
      name: 'connection:status',
      payload: plain({ connectionId, status, error, updatedAt }),
    })),
  );
  gateway.server = undefined;
  assert.equal(gateway.emitConnectionStatus('host-c', 'connected'), undefined);
  assert.equal(sent.length, cases.length);
  assert(metadata.some((m) => m.name === 'WebSocketGateway'));
  record('state-gateway-frozen-connection', {
    completeClassExecuted: true,
    cases,
    sent,
    metadata,
    boundary:
      'Legacy permits missing time and arbitrary status; successor projects four validated states with a finite timestamp. No wire compatibility claim.',
  });
});

test('P0 state gateway complete frozen class emits repository status with exact spread and identity precedence', () => {
  const { gateway, sent } = legacy();
  const cases = [
    ['repo-a', 'host-a', { isDirty: false, currentBranch: 'main', ahead: 0, behind: 0 }],
    [
      'repo-b',
      'host-b',
      {
        isDirty: true,
        currentBranch: '分支',
        ahead: 2,
        behind: 3,
        details: { paths: ['中\r\n.txt'] },
      },
    ],
    ['repo-a', 'host-a', {}],
    [
      'repo-a',
      'host-a',
      { repositoryId: 'legacy-override', connectionId: 'legacy-host-override', extra: 0 },
    ],
  ];
  for (const args of cases) assert.equal(gateway.emitRepoStatus(...args), undefined);
  assert.deepEqual(
    sent,
    cases.map(([repositoryId, connectionId, data]) => ({
      name: 'repo:status',
      payload: { repositoryId, connectionId, ...data },
    })),
  );
  gateway.server = undefined;
  assert.throws(() => gateway.emitRepoStatus('repo-a', 'host-a', {}));
  record('state-gateway-frozen-repository', {
    completeClassExecuted: true,
    cases,
    sent,
    boundary:
      'Legacy data spread can override identity. Successor keeps identity in validated envelope and invalidates/re-reads instead of broadcasting arbitrary summary.',
  });
});

test('P0 state gateway real stdio host failure emits owner-scoped ordered status without exposing a key or contacting a host', async (t) => {
  const f = await fixture(t, 'alune-batch19-host-');
  const a = await f.owner('a', ['hosts.changed']),
    b = await f.owner('b', ['hosts.changed']);
  const before = await a.child.client.listHostProfiles();
  const keyPath = path.join(f.root, 'missing-disposable-private-key');
  assert(!fs.existsSync(keyPath));
  const saved = await a.child.client.saveHostProfile(
    null,
    {
      name: 'Disposable missing key',
      host: '127.0.0.1',
      port: 1,
      username: 'fixture',
      authType: 'privateKey',
      privateKeyPath: keyPath,
    },
    before.revision,
  );
  const hostId = saved.hosts.find((h) => !before.hosts.some((old) => old.id === h.id)).id;
  const policy = { hostId, hostKey: '0'.repeat(64), install: false };
  const projected = [];
  const off = subscribeWorkspaceEvents(a.child.client, {
    'connection:status': (p) => projected.push(plain(p)),
  });
  t.after(off);
  await assert.rejects(
    b.child.client.request('hosts.open', policy),
    (e) => e.kind === 'not-found' && e.outcome === 'not-started',
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    a.child.client.request('hosts.open', policy, { signal: controller.signal }),
    (e) => e.kind === 'cancelled' && e.outcome === 'not-started',
  );
  assert.equal(a.events.length, 0);
  let failure;
  await assert.rejects(a.child.client.request('hosts.open', policy), (e) => {
    failure = { kind: e.kind, message: e.message, outcome: e.outcome };
    return e.kind === 'unavailable' && e.message === 'SSH Agent authentication failed';
  });
  await until(() => projected.at(-1)?.status === 'error', 'host error delivered');
  assert.deepEqual(
    projected.map((e) => e.status),
    ['connecting', 'error'],
  );
  assert(
    projected.every(
      (e) => e.hostId === hostId && e.connectionId === hostId && Number.isFinite(e.updatedAt),
    ),
  );
  assert(projected[1].updatedAt > projected[0].updatedAt);
  assert.equal(projected[1].error, failure.message);
  assert(!Object.hasOwn(projected[0], 'error'));
  const captured = legacy();
  for (const p of projected)
    captured.gateway.emitConnectionStatus(p.connectionId, p.status, p.error, p.updatedAt);
  assert.deepEqual(
    captured.sent.map((e) => e.payload),
    projected.map(({ hostId: _, ...p }) => p),
  );
  const catalog = await a.child.client.request('hosts.catalog', {});
  const host = catalog.hosts.find((h) => h.hostId === hostId);
  assert.equal(host.state, 'offline');
  assert.equal(host.stale, true);
  assert.equal(host.sshConnected, false);
  assert.equal(host.reason, failure.message);
  assert.equal(b.events.length, 0);
  assert.equal((await b.child.client.health()).status, 'ok');
  assertEnvelope(a);
  assert.doesNotMatch(
    JSON.stringify(a.events),
    /missing-disposable-private-key|privateKey|password|passphrase/,
  );
  const eventCount = projected.length;
  off();
  await assert.rejects(
    a.child.client.request('hosts.open', policy),
    (e) => e.kind === 'unavailable',
  );
  await until(() => a.events.length === 4, 'second failure delivered');
  assert.equal(projected.length, eventCount);
  record('state-gateway-host-failure', {
    a: a.info,
    b: b.info,
    policy,
    keyFileAbsent: true,
    failure,
    projected,
    events: a.events,
    foreignOwnerEvents: b.events,
    catalog: host,
    disposedCallbackCount: eventCount,
    boundary:
      'Actual production connectHost stops on readFile(temporary missing key), before connectProxySocket. Four-state success projection is separately controlled; no successful SSH or actual UI claimed.',
  });
});

test('P0 state gateway real stdio repository changes re-read native status and isolate owners resources cancellation and durable replay', async (t) => {
  const f = await fixture(t, 'alune-batch19-repo-');
  const a = await f.owner('a', ['repositories.changed']),
    b = await f.owner('b', ['repositories.changed']);
  assert.notEqual(a.info.agentId, b.info.agentId);
  function repo(label) {
    const dir = path.join(f.root, label + ' 中文');
    fs.mkdirSync(dir);
    const git = (...args) =>
      execFileSync('git', ['-C', dir, ...args], {
        env: f.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trimEnd();
    git('init', '-b', 'main');
    git('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'file.txt'), 'base\n');
    git('add', '.');
    git('commit', '-m', 'initial');
    return { dir, git };
  }
  const ra = repo('a'),
    rb = repo('b'),
    other = repo('a-other');
  const resource = (await a.child.client.registerRepository(ra.dir)).resource;
  const bResource = (await b.child.client.registerRepository(rb.dir)).resource;
  const otherResource = (await a.child.client.registerRepository(other.dir)).resource;
  await until(() => a.events.length === 2 && b.events.length === 1, 'registration events');
  const changes = [];
  const off = subscribeWorkspaceEvents(a.child.client, {
    'repository:changed': (id) => changes.push(id),
  });
  t.after(off);
  const queries = createAgentRepositoryQueries(
    a.child.client,
    (id) => (id === 'ui-a' ? resource : undefined),
    { status() {} },
    {},
  );
  t.after(() => queries.dispose());
  const clean = await queries.repository.status('ui-a');
  assert.equal(clean.branch, 'main');
  assert.equal(clean.files.length, 0);
  const bEventCount = b.events.length;
  const beforeA = a.events.length;
  await assert.rejects(
    b.child.client.readRepository(resource, 'status', {}),
    (e) => e.kind === 'not-found',
  );
  await assert.rejects(
    b.child.client.prepareRepositoryWrite({ resource, kind: 'stage', args: [['file.txt']] }),
    (e) => e.kind === 'not-found',
  );
  fs.writeFileSync(path.join(ra.dir, 'file.txt'), 'changed 中文\r\n');
  const intent = { resource, kind: 'stage', args: [['file.txt']] };
  const write = {
    ...intent,
    revision: await a.child.client.prepareRepositoryWrite(intent),
    operationId: randomUUID(),
  };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    a.child.client.writeRepository(write, { signal: controller.signal }),
    (e) => e.kind === 'cancelled' && e.outcome === 'not-started',
  );
  assert.equal(a.events.length, beforeA);
  assert.equal(ra.git('show', ':file.txt'), 'base');
  await a.child.client.writeRepository(write);
  await until(
    () =>
      a.events.some(
        (e) => e.resource?.resourceId === resource.resourceId && e.payload.generation >= 3,
      ),
    'final write invalidation',
  );
  const dirty = await queries.repository.status('ui-a');
  assert.equal(dirty.branch, 'main');
  assert(dirty.files.some((entry) => entry.path === 'file.txt' && entry.staged));
  assert.equal(ra.git('show', ':file.txt'), 'changed 中文');
  assert.equal((await b.child.client.readRepository(bResource, 'status', {})).files.length, 0);
  assert.equal((await a.child.client.readRepository(otherResource, 'status', {})).files.length, 0);
  assert.equal(b.events.length, bEventCount);
  assert(changes.length >= 1 && changes.every((id) => id === resource.resourceId));
  assert(a.events.slice(beforeA).every((e) => e.resource.resourceId === resource.resourceId));
  for (const r of [resource, otherResource]) {
    const generations = a.events
      .filter((e) => e.resource?.resourceId === r.resourceId)
      .map((e) => e.payload.generation);
    assert(generations.every((n, i) => Number.isSafeInteger(n) && n > (generations[i - 1] ?? 0)));
  }
  assertEnvelope(a);
  assertEnvelope(b);
  const summary = (status) => ({
    isDirty: status.files.length > 0,
    currentBranch: status.branch,
    ahead: status.ahead,
    behind: status.behind,
  });
  const frozen = legacy();
  frozen.gateway.emitRepoStatus(resource.resourceId, a.info.agentId, summary(clean));
  frozen.gateway.emitRepoStatus(resource.resourceId, a.info.agentId, summary(dirty));
  assert.deepEqual(
    frozen.sent.map((e) => e.payload),
    [clean, dirty].map((s) => ({
      repositoryId: resource.resourceId,
      connectionId: a.info.agentId,
      ...summary(s),
    })),
  );
  const oldInfo = a.info,
    oldEvents = structuredClone(a.events);
  const beforeReplay = a.events.length;
  await assert.rejects(
    a.child.client.writeRepository(write),
    (e) => e.kind === 'duplicate-request',
  );
  assert.equal(a.events.length, beforeReplay);
  off();
  queries.dispose();
  await a.child.close();
  await a.start();
  assert.equal(a.info.agentId, oldInfo.agentId);
  assert.notEqual(a.info.sessionId, oldInfo.sessionId);
  const receipt = await a.child.client.getTask({ taskId: write.operationId });
  assert.equal(receipt.task.state, 'succeeded');
  assert.equal(receipt.scope, 'agent');
  await assert.rejects(
    a.child.client.writeRepository(write),
    (e) => e.kind === 'duplicate-request',
  );
  assert.equal(a.events.length, 0);
  assert.equal(ra.git('show', ':file.txt'), 'changed 中文');
  assert.equal(ra.git('rev-list', '--count', 'HEAD'), '1');
  assert.equal(
    (await a.child.client.readRepository(resource, 'status', {})).files.filter((e) => e.staged)
      .length,
    1,
  );
  assert.equal((await b.child.client.health()).status, 'ok');
  record('state-gateway-repository-owners', {
    oldInfo,
    newInfo: a.info,
    b: b.info,
    resource,
    otherResource,
    bResource,
    clean,
    dirty,
    frozenSummaries: frozen.sent,
    events: oldEvents,
    bEvents: b.events,
    changes,
    receipt,
    restartEvents: a.events,
    boundary:
      'Actual local SDK/stdio/SQLite/Git; summary re-read replaces legacy arbitrary broadcast. Agent ID substitutes legacy routing connection ID. No external Git watcher, shared UI kernel, browser or remote claim.',
  });
});
