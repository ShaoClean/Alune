import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { AgentClient } from '@alune/agent-client';
import { AgentSession } from '@alune/agent';
import { compareContracts } from '../../../scripts/agent/check-p0-models.mjs';
import { subscribeWorkspaceEvents } from '../src/api/workspace-events.ts';
import { createAgentRepositoryQueries } from '../src/api/agent-repositories.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const baselineSha = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
let frozen = process.env.P0_SIX_BASELINE_DIR;
let owned;
if (!frozen) {
  owned = frozen = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-six-contracts-'));
  const archive = execFileSync(
    'git',
    [
      'archive',
      baselineSha,
      'packages/shared/src',
      'apps/web/src',
      'apps/server/src/events/events.gateway.ts',
    ],
    { cwd: root, maxBuffer: 32 * 1024 * 1024 },
  );
  execFileSync('tar', ['-xf', '-', '-C', frozen], { input: archive });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(frozen, 'node_modules'), 'dir');
  process.on('exit', () => fs.rmSync(owned, { recursive: true, force: true }));
}
const record = (name, data) => {
  if (process.env.P0_SIX_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_SIX_PROOF_DIR, name + '.json'),
      JSON.stringify(data, null, 2) + '\n',
    );
};
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
const { createRepositoryStore, emptyWorkspace } = await import('../src/stores/repositoryStore.ts');
const { useConnectionStore } = await import('../src/stores/connectionStore.ts');
const { repositoryApi } = await import('../src/api/index.ts');

// Execute only the exact frozen emitter method bodies. No Nest/Socket.IO server,
// SSH client, credentials, legacy database or old executor is loaded.
const gatewayText = fs.readFileSync(
  path.join(frozen, 'apps/server/src/events/events.gateway.ts'),
  'utf8',
);
const gatewayAst = ts.createSourceFile('gateway.ts', gatewayText, ts.ScriptTarget.Latest, true);
const gatewayClass = gatewayAst.statements.find(ts.isClassDeclaration);
const emitMethods = gatewayClass.members.filter(
  (m) =>
    ts.isMethodDeclaration(m) &&
    /^emit(ConnectionStatus|RepoStatus|CommandOutput|CommandExit)$/.test(
      m.name.getText(gatewayAst),
    ),
);
assert.equal(emitMethods.length, 4);
const Gateway = vm.runInNewContext(
  ts.transpileModule(
    'class Gateway {' + emitMethods.map((m) => m.getText(gatewayAst)).join('\n') + '}\nGateway;',
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText,
);
function captureFrozen(method, ...args) {
  const sent = [],
    gateway = new Gateway();
  gateway.server = { emit: (type, payload) => sent.push({ type, payload }) };
  gateway[method](...args);
  return structuredClone(sent[0]);
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
async function sessionFixture(t, agentId = 'agent-a') {
  const listeners = [new Set(), new Set()],
    closed = [new Set(), new Set()],
    sent = [[], []];
  const endpoint = (index) => ({
    async send(message) {
      sent[index].push(structuredClone(message));
      queueMicrotask(() => {
        for (const fn of listeners[1 - index]) fn(structuredClone(message));
      });
    },
    onMessage(fn) {
      listeners[index].add(fn);
      return () => listeners[index].delete(fn);
    },
    onClose(fn) {
      closed[index].add(fn);
      return () => closed[index].delete(fn);
    },
    close(error) {
      for (const fn of [...closed[1 - index]]) fn(error);
    },
  });
  const session = new AgentSession(endpoint(0), {
    agentId,
    version: 'fixture',
    handlers: {
      'fixture.event': {
        effect: 'query',
        validate() {},
        run(p, c) {
          c.events.notifyState(p.type, p.payload, p.resource);
          return null;
        },
      },
    },
  });
  const client = new AgentClient(endpoint(1));
  await client.initialize();
  await client.subscribe([
    'hosts.changed',
    'repositories.changed',
    'repositories.operation',
    'events.resync-required',
  ]);
  t.after(async () => {
    client.close();
    await session.close();
  });
  return {
    client,
    session,
    sent,
    async emit(type, payload, resource) {
      await client.request('fixture.event', { type, payload, ...(resource ? { resource } : {}) });
      await flush();
    },
  };
}

test('P0 WorkspaceData preserves the frozen public declaration in both directions without new any positions', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-workspace-compare-'));
  try {
    const rows = compareContracts(
      path.join(frozen, 'apps/web/src/stores/repositoryStore.ts'),
      [
        ['candidate', path.join(root, 'apps/web/src/stores/repositoryStore.ts')],
        ['domain', path.join(root, 'packages/domain/src/index.ts')],
        ['protocol', path.join(root, 'packages/protocol/src/index.ts')],
        ['shared', path.join(frozen, 'packages/shared/src/index.ts')],
      ],
      temporary,
      frozen,
      ['WorkspaceData'],
      [path.join(root, 'node_modules/vite/client.d.ts')],
    );
    record('workspace-types', { baseline: baselineSha, compiler: ts.version, rows });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].compatible, true);
    assert.equal(rows[0].valueExport, false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('P0 WorkspaceData retains aggregate errors while panel errors and repository lifetimes remain isolated', async () => {
  const store = createRepositoryStore(),
    snapshots = [];
  store.getState().activateWorkspace('repo-a');
  store.getState().activateWorkspace('repo-b');
  assert.deepEqual([emptyWorkspace().error, emptyWorkspace().errorPanel], [null, null]);
  const previous = {
    branches: repositoryApi.branches,
    stashes: repositoryApi.stashes,
    remotes: repositoryApi.remotes,
  };
  try {
    for (const [panel, method] of [
      ['branches', 'fetchBranches'],
      ['stashes', 'fetchStashes'],
      ['remotes', 'fetchRemotes'],
    ]) {
      repositoryApi[panel] = async () => {
        throw Error(panel + ' failed');
      };
      await store.getState()[method]('repo-a');
      let a = store.getState().workspaces['repo-a'];
      assert.equal(a.error, panel + ' failed');
      assert.equal(a.errorPanel, panel);
      assert.equal(a.panelErrors[panel], panel + ' failed');
      assert.equal(store.getState().workspaces['repo-b'].error, null);
      snapshots.push({
        panel,
        error: a.error,
        errorPanel: a.errorPanel,
        panelErrors: { ...a.panelErrors },
      });
    }
    repositoryApi.stashes = async () => [];
    await store.getState().fetchStashes('repo-a');
    const a = store.getState().workspaces['repo-a'];
    assert.equal(a.error, null);
    assert.equal(a.errorPanel, 'remotes'); // Frozen aggregate remembers the last failed panel.
    assert.equal(a.panelErrors.stashes, null);
    assert.equal(a.panelErrors.branches, 'branches failed');
    assert.equal(a.panelErrors.remotes, 'remotes failed');
    let finish;
    repositoryApi.branches = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const late = store.getState().fetchBranches('repo-a');
    store.getState().disposeWorkspaces(['repo-a']);
    store.getState().activateWorkspace('repo-a');
    finish(['obsolete']);
    await late;
    assert.deepEqual(store.getState().workspaces['repo-a'].branches, []);
    assert.equal(store.getState().workspaces['repo-a'].error, null);
    record('workspace-runtime', snapshots);
  } finally {
    Object.assign(repositoryApi, previous);
    store.getState().disposeWorkspaces(['repo-a', 'repo-b']);
  }
});

test('P0 ConnectionStatusEvent projects frozen fields from sequenced Agent events and ignores stale or malformed host status', async (t) => {
  const f = await sessionFixture(t),
    seen = [];
  useConnectionStore.setState(useConnectionStore.getInitialState(), true);
  const off = subscribeWorkspaceEvents(f.client, {
    'connection:status': (payload) => {
      seen.push(payload);
      useConnectionStore.getState().applyConnectionStatus(payload);
    },
  });
  t.after(off);
  const expected = [];
  for (const [n, status] of ['connecting', 'connected', 'disconnected', 'error'].entries()) {
    const error = status === 'error' ? 'controlled authentication failure' : undefined;
    const legacy = captureFrozen('emitConnectionStatus', 'host-a', status, error, n + 1);
    expected.push(legacy);
    await f.emit('hosts.changed', {
      hostId: 'host-a',
      status,
      ...(error ? { error } : {}),
      updatedAt: n + 1,
    });
    const projected = seen.at(-1);
    assert.deepEqual(
      JSON.parse(
        JSON.stringify({
          connectionId: projected.connectionId,
          status: projected.status,
          error: projected.error,
          updatedAt: projected.updatedAt,
        }),
      ),
      JSON.parse(JSON.stringify(legacy.payload)),
    );
  }
  await f.emit('hosts.changed', { hostId: 'host-a', status: 'connected', updatedAt: 1 });
  await f.emit('hosts.changed', { hostId: 'host-b', status: 'connected', updatedAt: 10 });
  const before = seen.length;
  for (const payload of [
    null,
    [],
    { hostId: '', status: 'connected', updatedAt: 99 },
    { hostId: 'host-a', status: { toString: null }, updatedAt: 99 },
    { hostId: 'host-a', status: 'ready', updatedAt: 99 },
    { hostId: 'host-a', status: 'error', error: {}, updatedAt: 99 },
    { hostId: 'host-a', status: 'connected' },
  ])
    await f.emit('hosts.changed', payload);
  assert.equal(seen.length, before);
  assert.equal(useConnectionStore.getState().statuses['host-a'].status, 'error');
  assert.equal(useConnectionStore.getState().statuses['host-b'].status, 'connected');
  const messages = f.sent[0].filter((m) => m.method === 'agent.event').map((m) => m.params);
  assert(messages.every((e) => e.agentId === 'agent-a' && e.sessionId === f.session.sessionId));
  assert.deepEqual(
    messages.map((e) => e.sequence),
    messages.map((_, i) => i + 1),
  );
  record('connection-projection', { frozen: expected, delivered: seen, envelope: messages });
});

test('P0 RepositoryStatusEvent successor invalidates only its owning resource and re-reads the frozen status summary', async (t) => {
  const f = await sessionFixture(t),
    other = await sessionFixture(t, 'agent-b');
  const resource = { agentId: 'agent-a', resourceId: 'same-id' },
    foreign = { agentId: 'agent-b', resourceId: 'same-id' };
  let revision = 0;
  const summary = [
    { branch: 'main', ahead: 0, behind: 1, files: [] },
    {
      branch: 'topic',
      ahead: 2,
      behind: 3,
      files: [{ path: 'changed.txt', status: 'modified', staged: false }],
    },
  ];
  const api = createAgentRepositoryQueries(f.client, () => resource, { status() {} }, {});
  const b = createAgentRepositoryQueries(other.client, () => foreign, { status() {} }, {});
  t.after(() => {
    api.dispose();
    b.dispose();
  });
  let finish,
    reads = 0,
    bReads = 0;
  f.client.readRepository = async (_r, kind, params, { signal }) => {
    assert.deepEqual(_r, resource);
    assert.equal(kind, 'status');
    reads++;
    if (reads === 1)
      return new Promise((resolve) => {
        finish = () => resolve(summary[0]);
      });
    signal.throwIfAborted();
    return summary[revision];
  };
  other.client.readRepository = async () => {
    bReads++;
    return summary[0];
  };
  const aRead = api.repository.status('ui-a');
  const bRead = b.repository.status('ui-b');
  revision = 1;
  await f.emit('repositories.changed', { generation: 1 }, resource);
  finish();
  const current = await aRead;
  assert.deepEqual(await bRead, summary[0]);
  assert.equal(reads, 2);
  assert.equal(bReads, 1);
  const projected = {
    repositoryId: 'ui-a',
    connectionId: 'host-a',
    isDirty: current.files.length > 0,
    currentBranch: current.branch,
    ahead: current.ahead,
    behind: current.behind,
  };
  const legacy = captureFrozen('emitRepoStatus', 'ui-a', 'host-a', {
    isDirty: true,
    currentBranch: 'topic',
    ahead: 2,
    behind: 3,
  });
  assert.deepEqual(projected, legacy.payload);
  let connects = 0,
    disconnects = 0,
    changes = [];
  const off = subscribeWorkspaceEvents(f.client, {
    connect: () => connects++,
    disconnect: () => disconnects++,
    'repository:changed': (id) => changes.push(id),
  });
  await f.emit('repositories.changed', { generation: 2 }, resource);
  f.session.events.notifyState('events.resync-required', { reason: 'controlled-overflow' });
  // Inject a control notification to verify that the UI requests a fresh snapshot.
  await flush();
  assert.deepEqual(changes, ['same-id']);
  assert.equal(connects, 2);
  off();
  await f.emit('repositories.changed', { generation: 3 }, resource);
  f.client.close();
  await flush();
  assert.deepEqual(changes, ['same-id']);
  assert.equal(disconnects, 0);
  record('repository-projection', {
    frozen: legacy,
    projected,
    owningReads: reads,
    otherAgentReads: bReads,
    connectCallbacks: connects,
    changes,
  });
});

test('P0 retired command output and exit declarations remain explicit gaps instead of fabricated Agent parity', async (t) => {
  const names = [
    'CommandOutputEvent',
    'CommandExitEvent',
    'ConnectionStatusEvent',
    'RepositoryStatusEvent',
    'ServerEvents',
  ];
  const rows = compareContracts(
    path.join(frozen, 'packages/shared/src/types/events.ts'),
    [
      ['domain', path.join(root, 'packages/domain/src/index.ts')],
      ['protocol', path.join(root, 'packages/protocol/src/index.ts')],
    ],
    frozen,
    frozen,
    names,
  );
  assert.equal(rows.length, 5);
  assert(rows.every((row) => !row.compatible));
  const definitions = execFileSync(
    'git',
    [
      'grep',
      '-n',
      '-E',
      'emitCommand(Output|Exit)|emitRepoStatus',
      baselineSha,
      '--',
      'apps/server',
      'apps/web',
    ],
    { cwd: root, encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  assert.equal(definitions.length, 3);
  assert(definitions.every((line) => line.includes('apps/server/src/events/events.gateway.ts:')));
  const f = await sessionFixture(t),
    oldCallbacks = [],
    successor = [];
  const off = subscribeWorkspaceEvents(f.client, {
    'command:output': (e) => oldCallbacks.push(e),
    'command:exit': (e) => oldCallbacks.push(e),
    'repo:status': (e) => oldCallbacks.push(e),
  });
  t.after(off);
  f.client.onEvent((e) => successor.push(e));
  await f.emit(
    'repositories.operation',
    {
      operationId: '12345678-1234-4234-8234-123456789abc',
      kind: 'fetch',
      startedAt: 1,
      cancelling: false,
      progress: 'Receiving objects: 50%',
    },
    { agentId: 'agent-a', resourceId: 'repo-a' },
  );
  await f.emit('repositories.operation', null, { agentId: 'agent-a', resourceId: 'repo-a' });
  assert.deepEqual(oldCallbacks, []);
  assert.equal(successor[0].payload.progress, 'Receiving objects: 50%');
  assert.equal(successor[1].payload, null);
  const outputs = ['stdout', 'stderr'].map((type) =>
    captureFrozen('emitCommandOutput', 'host-a', 'git fetch', '中文\r\n', type),
  );
  const exits = [0, 1, 128].map((code) =>
    captureFrozen('emitCommandExit', 'host-a', 'git fetch', code),
  );
  record('retired-event-review', {
    baseline: baselineSha,
    rows,
    frozenCommandDefinitionsOnly: definitions,
    frozenOutput: outputs,
    frozenExit: exits,
    successor,
    unresolved: {
      'P0-PROTOCOL-2300':
        'repositories.operation is coalescible bounded progress, not the raw stdout/stderr command stream. No equivalent raw command event is claimed.',
      'P0-PROTOCOL-2301':
        'RPC result/error and tasks.changed provide operation outcome, not the frozen command text plus numeric process exitCode. No equivalent command exit is claimed.',
      'P0-PROTOCOL-2304':
        'ServerEvents is only partially mapped: connection and repository state have successor assertions; command output and exit still lack equivalent projections or an approved retirement disposition.',
    },
  });
});
