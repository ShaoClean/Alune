import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';
import { AgentClient } from '@alune/agent-client';
import { spawnAgent } from '@alune/agent-client/node';
import { AgentSession } from '@alune/agent';
import { COMMAND_TOPICS, isCommandOutput, isCommandExit } from '@alune/protocol';
import { subscribeWorkspaceEvents, workspaceEventSuccessors } from '../src/api/workspace-events.ts';
import { workspaceTopics } from '../src/api/ui-agent.ts';
const require = createRequire(import.meta.url);
const {
  NativeRepositoryConnection,
} = require('../../../packages/agent/dist/adapters/git/native.js');
const { commandObserver } = require('../../../packages/agent/dist/runtime/command-events.js');
const root = path.resolve(import.meta.dirname, '../../..');
const record = (name, value) => {
  if (process.env.P0_COMMAND_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_COMMAND_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
    );
};
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-command-events-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const baseEnv = (dir) => ({
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: path.join(dir, 'global'),
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
});
async function fixture(t, run, topics = COMMAND_TOPICS) {
  const listeners = [new Set(), new Set()],
    closes = [new Set(), new Set()];
  const endpoint = (i) => ({
    async send(m) {
      queueMicrotask(() => {
        for (const fn of listeners[1 - i]) fn(structuredClone(m));
      });
    },
    onMessage(fn) {
      listeners[i].add(fn);
      return () => listeners[i].delete(fn);
    },
    onClose(fn) {
      closes[i].add(fn);
      return () => closes[i].delete(fn);
    },
    close(error) {
      for (const fn of [...closes[1 - i]]) fn(error);
    },
  });
  const session = new AgentSession(endpoint(0), {
    agentId: 'agent-fixture',
    version: 'fixture',
    handlers: { 'fixture.run': { effect: 'query', validate() {}, run } },
  });
  const client = new AgentClient(endpoint(1));
  await client.initialize();
  await client.subscribe([...topics]);
  const events = [];
  client.onEvent((e) => {
    events.push(structuredClone(e));
  });
  t.after(async () => {
    client.close();
    await session.close();
  });
  return { client, session, events };
}
function nativeRun(dir, script, operationId = randomUUID()) {
  const file = path.join(dir, 'fixture.cjs');
  fs.writeFileSync(file, script);
  const args = [
    '-c',
    `alias.fixture=!${JSON.stringify(process.execPath)} ${JSON.stringify(file)}`,
    'fixture',
  ];
  return async (_p, c) => {
    const native = new NativeRepositoryConnection(c.signal);
    try {
      return await native.execGit(dir, args, c.signal, {
        environment: baseEnv(dir),
        observe: commandObserver(
          c,
          { agentId: c.agentId, resourceId: 'repo-fixture' },
          operationId,
        ),
      });
    } finally {
      await native.close();
    }
  };
}
function raw(events, stream) {
  return Buffer.concat(
    events
      .filter((e) => e.type === 'commands.output' && e.payload.stream === stream)
      .map((e) => Buffer.from(e.payload.base64, 'base64')),
  );
}
function frozen(method, ...args) {
  const text = execFileSync(
    'git',
    ['show', '3c05f640fcc1a04c864e47bfc2880483ad48c984:apps/server/src/events/events.gateway.ts'],
    { cwd: root, encoding: 'utf8' },
  );
  const ast = ts.createSourceFile('gateway.ts', text, ts.ScriptTarget.Latest, true);
  const member = ast.statements
    .find(ts.isClassDeclaration)
    .members.find((m) => ts.isMethodDeclaration(m) && m.name.getText(ast) === method);
  const Gateway = vm.runInNewContext(
    ts.transpileModule(`class Gateway { ${member.getText(ast)} }\nGateway;`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
  );
  let event;
  const g = new Gateway();
  g.server = {
    emit: (type, payload) => {
      event = { type, payload };
    },
  };
  g[method](...args);
  return structuredClone(event);
}

test('P0 command events carry real pipe bytes and process exit 7 through the Agent queue and client', async (t) => {
  const dir = temporary(t);
  const stdout = Buffer.concat([
    Buffer.from('中文\r\n\0'),
    Buffer.from([255]),
    Buffer.alloc(70000, 65),
  ]);
  const stderr = Buffer.from('stderr 原始\r\n');
  const f = await fixture(
    t,
    nativeRun(
      dir,
      `const fs=require('node:fs'); const out=Buffer.from('${stdout.toString('base64')}','base64'); fs.writeSync(1,out.subarray(0,1)); setTimeout(()=>{fs.writeSync(1,out.subarray(1)); fs.writeSync(2,Buffer.from('${stderr.toString('base64')}','base64')); process.exitCode=7;},20);`,
    ),
  );
  const outputs = [],
    exits = [];
  const off = subscribeWorkspaceEvents(f.client, {
    'command:output': (p) => outputs.push(p),
    'command:exit': (p) => exits.push(p),
  });
  t.after(off);
  const result = await f.client.request('fixture.run');
  assert.equal(result.exitCode, 7);
  assert.deepEqual(raw(f.events, 'stdout'), stdout);
  assert.deepEqual(raw(f.events, 'stderr'), stderr);
  assert(
    f.events.filter((e) => e.type === 'commands.output').every((e) => isCommandOutput(e.payload)),
  );
  assert(f.events.filter((e) => e.type === 'commands.exit').every((e) => isCommandExit(e.payload)));
  assert.equal(f.events.at(-1).type, 'commands.exit');
  assert.equal(exits.length, 1);
  assert.equal(exits[0].exitCode, 7);
  assert.equal(
    outputs
      .filter((p) => p.type === 'stdout')
      .map((p) => p.data)
      .join(''),
    stdout.toString('utf8'),
  );
  assert.equal(
    outputs
      .filter((p) => p.type === 'stderr')
      .map((p) => p.data)
      .join(''),
    stderr.toString('utf8'),
  );
  assert.deepEqual(
    f.events.map((e) => e.sequence),
    f.events.map((_, i) => i + 1),
  );
  assert(
    f.events.every(
      (e) =>
        e.agentId === 'agent-fixture' &&
        e.sessionId === f.session.sessionId &&
        e.resource.resourceId === 'repo-fixture',
    ),
  );
  for (const p of outputs) {
    const old = frozen('emitCommandOutput', p.connectionId, p.command, p.data, p.type);
    assert.deepEqual(
      { connectionId: p.connectionId, command: p.command, data: p.data, type: p.type },
      old.payload,
    );
  }
  const p = exits[0],
    old = frozen('emitCommandExit', p.connectionId, p.command, 7);
  assert.deepEqual(
    { connectionId: p.connectionId, command: p.command, exitCode: p.exitCode },
    old.payload,
  );
  record('raw-and-frozen', {
    result,
    events: f.events,
    outputProjection: outputs,
    exitProjection: exits,
    frozenExit: old,
  });
});

test('P0 command output awaits client ACKs with bounded pipe pressure and no state coalescing', async (t) => {
  const dir = temporary(t),
    done = path.join(dir, 'wrote-all');
  const f = await fixture(
    t,
    nativeRun(
      dir,
      `const fs=require('node:fs'); fs.writeSync(1, Buffer.alloc(2*1024*1024, 90)); fs.writeFileSync(${JSON.stringify(done)},'done');`,
    ),
  );
  let unblock, observed;
  const first = new Promise((r) => (observed = r)),
    gate = new Promise((r) => (unblock = r));
  let held = false;
  f.client.onEvent(async (e) => {
    if (e.type === 'commands.output' && !held) {
      held = true;
      observed();
      await gate;
    }
  });
  let finished = false;
  const pending = f.client.request('fixture.run').finally(() => {
    finished = true;
  });
  try {
    await Promise.race([
      first,
      delay(5000).then(() => {
        throw Error('No first output');
      }),
    ]);
    await delay(100);
    assert.equal(finished, false);
    assert.equal(fs.existsSync(done), false);
    assert(f.session.events.bufferedMessages <= 2);
  } finally {
    unblock();
  }
  assert.equal((await pending).exitCode, 0);
  assert.deepEqual(raw(f.events, 'stdout'), Buffer.alloc(2 * 1024 * 1024, 90));
  assert.equal(
    f.events.some((e) => e.type === 'events.resync-required'),
    false,
  );
  record('backpressure', {
    bytes: raw(f.events, 'stdout').length,
    eventCount: f.events.length,
    exited: f.events.at(-1),
  });
});

test('P0 authorized repository writes emit actual hook output and Git status without replaying writes', async (t) => {
  const dir = temporary(t),
    repo = path.join(dir, '中文 repo');
  fs.mkdirSync(repo);
  const env = baseEnv(dir),
    git = (...args) =>
      execFileSync('git', ['-C', repo, ...args], {
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  git('init', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-m', 'initial');
  const hook = path.join(repo, '.git/hooks/pre-commit');
  fs.writeFileSync(
    hook,
    '#!/bin/sh\nprintf "hook 中文\\r\\n"\nprintf "hook stderr\\r\\n" >&2\nexit 7\n',
    { mode: 0o700 },
  );
  const child = spawnAgent(
    process.execPath,
    [path.join(root, 'packages/agent/tests/settings-fixture.cjs'), path.join(dir, 'state')],
    { env },
  );
  t.after(() => child.close());
  const client = child.client;
  await client.initialize();
  await client.subscribe([...COMMAND_TOPICS, 'repositories.operation']);
  const events = [];
  client.onEvent((e) => {
    events.push(structuredClone(e));
  });
  const { resource } = await client.registerRepository(repo);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
  git('add', '.');
  const prepare = async () => {
    const p = { resource, kind: 'commit', args: ['new commit'] };
    return { ...p, revision: await client.prepareRepositoryWrite(p), operationId: randomUUID() };
  };
  const fail = await prepare();
  await assert.rejects(client.writeRepository(fail));
  const oracle = spawnSync(
    'git',
    ['--literal-pathspecs', '-C', repo, 'commit', '-m', 'new commit'],
    { env },
  );
  assert.equal(oracle.status, 1);
  const failedEvents = events.filter(
    (e) => e.type.startsWith('commands.') && e.payload.operationId === fail.operationId,
  );
  const failedCommit = failedEvents.find(
    (e) => e.type === 'commands.exit' && e.payload.args.includes('commit'),
  );
  assert(failedCommit);
  assert.equal(failedCommit.payload.exitCode, 1); // Git translates hook's 7 to its own 1.
  const commitOutput = failedEvents.filter(
    (e) => e.payload.commandId === failedCommit.payload.commandId,
  );
  // Git itself redirects hook stdout into its stderr pipe. Compare the actual
  // Git process streams rather than assuming hook descriptors survive Git.
  assert.deepEqual(raw(commitOutput, 'stdout'), oracle.stdout);
  assert.deepEqual(raw(commitOutput, 'stderr'), oracle.stderr);
  fs.writeFileSync(hook, '#!/bin/sh\nprintf "accepted\\r\\n"\n');
  const pass = await prepare();
  await client.writeRepository(pass);
  const passEvents = events.filter(
    (e) => e.type.startsWith('commands.') && e.payload.operationId === pass.operationId,
  );
  assert(
    passEvents.some(
      (e) =>
        e.type === 'commands.exit' && e.payload.args.includes('commit') && e.payload.exitCode === 0,
    ),
  );
  const count = events.filter((e) => e.type.startsWith('commands.')).length;
  await assert.rejects(
    client.writeRepository(pass),
    (e) => e.kind === 'duplicate-request' && e.outcome === 'unknown',
  );
  assert.equal(events.filter((e) => e.type.startsWith('commands.')).length, count);
  assert.equal(git('rev-list', '--count', 'HEAD').trim(), '2');
  assert(
    events
      .filter((e) => e.type.startsWith('commands.'))
      .every(
        (e) => e.agentId === resource.agentId && e.resource.resourceId === resource.resourceId,
      ),
  );
  record('authorized-writes', {
    resource,
    failed: failedEvents,
    successful: passEvents,
    retryReexecuted: false,
    oracle: {
      exitCode: oracle.status,
      stdout: oracle.stdout.toString('base64'),
      stderr: oracle.stderr.toString('base64'),
    },
  });
});

test('P0 process cancellation preserves null signal status; spawn failure and progress never fabricate numeric exit', async (t) => {
  const dir = temporary(t),
    controller = new AbortController(),
    native = new NativeRepositoryConnection(controller.signal),
    exits = [];
  t.after(() => native.close());
  const script = path.join(dir, 'wait.cjs');
  fs.writeFileSync(script, "process.stdout.write('ready'); setInterval(()=>{},1000);");
  await assert.rejects(
    native.execGit(
      dir,
      ['-c', `alias.wait=!${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`, 'wait'],
      controller.signal,
      {
        environment: baseEnv(dir),
        observe: () => ({
          async output() {
            controller.abort();
          },
          async exit(code, signal) {
            exits.push({ code, signal });
          },
        }),
      },
    ),
  );
  assert.equal(exits.length, 1);
  assert.equal(exits[0].code, null);
  assert.equal(exits[0].signal, 'SIGTERM');
  const noGit = new NativeRepositoryConnection();
  t.after(() => noGit.close());
  const missing = [];
  await assert.rejects(
    noGit.execGit(dir, ['status'], undefined, {
      environment: { ...baseEnv(dir), PATH: dir },
      observe: () => ({
        async output() {},
        async exit(code) {
          missing.push(code);
        },
      }),
    }),
  );
  await delay(50);
  assert.deepEqual(missing, []);
  const f = await fixture(
    t,
    async (_p, c) => {
      c.events.notifyState(
        'repositories.operation',
        { progress: 'Receiving objects', kind: 'fetch' },
        { agentId: c.agentId, resourceId: 'repo-fixture' },
      );
      await c.events.write(
        'commands.exit',
        {
          commandId: 'command-a',
          operationId: 'op-a',
          command: 'git wait',
          executable: 'git',
          args: ['wait'],
          cwd: dir,
          exitCode: null,
          signal: 'SIGTERM',
        },
        { agentId: c.agentId, resourceId: 'repo-fixture' },
      );
      return null;
    },
    [...COMMAND_TOPICS, 'repositories.operation'],
  );
  const numeric = [];
  const off = subscribeWorkspaceEvents(f.client, {
    'command:exit': (e) => numeric.push(e),
    'command:output': (e) => numeric.push(e),
  });
  t.after(off);
  await f.client.request('fixture.run');
  assert.deepEqual(numeric, []);
  record('cancel-and-start-failure', {
    exits,
    missing,
    numericCallbacks: numeric,
    events: f.events,
  });
});

test('P0 ServerEvents successor set includes reliable command topics and rejects malformed command payloads', () => {
  const frozenTypes = execFileSync(
    'git',
    ['show', '3c05f640fcc1a04c864e47bfc2880483ad48c984:packages/shared/src/types/events.ts'],
    { cwd: root, encoding: 'utf8' },
  );
  const ast = ts.createSourceFile('events.ts', frozenTypes, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(
    (s) => ts.isTypeAliasDeclaration(s) && s.name.text === 'ServerEvents',
  );
  assert.deepEqual(
    declaration.type.members.map((m) => m.name.text).sort(),
    Object.keys(workspaceEventSuccessors).sort(),
  );
  assert(Object.values(workspaceEventSuccessors).every((topic) => workspaceTopics.includes(topic)));
  assert(COMMAND_TOPICS.every((v) => workspaceTopics.includes(v)));
  assert(workspaceTopics.includes('hosts.changed'));
  assert(workspaceTopics.includes('repositories.changed'));
  assert.equal(isCommandOutput(null), false);
  assert.equal(isCommandExit(null), false);
  const p = {
    commandId: 'c',
    operationId: 'o',
    command: 'git status',
    executable: 'git',
    args: ['status'],
    cwd: '/repo',
  };
  for (const bad of [
    { ...p, stream: 'progress', base64: 'AA==' },
    { ...p, stream: 'stdout', base64: 'invalid' },
    { ...p, stream: 'stdout', base64: 'A'.repeat(24000) },
  ])
    assert.equal(isCommandOutput(bad), false);
  for (const bad of [
    { ...p, exitCode: NaN, signal: null },
    { ...p, exitCode: '0', signal: null },
    { ...p, exitCode: 0, signal: 'SIGTERM' },
  ])
    assert.equal(isCommandExit(bad), false);
  record('event-set', {
    frozenTypes,
    mappings: workspaceEventSuccessors,
    topics: workspaceTopics,
    commandOutput: 'commands.output',
    commandExit: 'commands.exit',
    connection: 'hosts.changed',
    repository: 'repositories.changed + resource read',
    legacyTypesRestored: false,
  });
});

test('P0 command exits 0, 1 and 128 come from native close status; unsubscribed streams stay optional', async (t) => {
  const results = [];
  for (const exitCode of [0, 1, 128]) {
    const dir = temporary(t),
      f = await fixture(t, nativeRun(dir, `process.exitCode=${exitCode};`));
    const result = await f.client.request('fixture.run');
    assert.equal(result.exitCode, exitCode);
    assert.equal(f.events.length, 1);
    const e = f.events[0];
    assert.equal(e.type, 'commands.exit');
    assert.equal(e.payload.exitCode, exitCode);
    const old = frozen('emitCommandExit', e.agentId, e.payload.command, exitCode);
    assert.deepEqual(
      { connectionId: e.agentId, command: e.payload.command, exitCode: e.payload.exitCode },
      old.payload,
    );
    results.push({ result, event: e, frozen: old });
  }
  const dir = temporary(t),
    f = await fixture(t, nativeRun(dir, "process.stdout.write('unobserved');"), []);
  assert.equal((await f.client.request('fixture.run')).stdout, 'unobserved');
  assert.deepEqual(f.events, []);
  record('numeric-exits', { results, unsubscribedEvents: f.events });
});

test('P0 command delivery failure stops the real process and remains an explicit failure', async (t) => {
  const dir = temporary(t),
    native = new NativeRepositoryConnection();
  t.after(() => native.close());
  const script = path.join(dir, 'wait.cjs');
  fs.writeFileSync(script, "process.stdout.write('ready'); setInterval(()=>{},1000);");
  const exits = [];
  await assert.rejects(
    native.execGit(
      dir,
      ['-c', `alias.wait=!${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`, 'wait'],
      undefined,
      {
        environment: baseEnv(dir),
        observe: () => ({
          async output() {
            throw Error('fixture reliable delivery failed');
          },
          async exit(code, signal) {
            exits.push({ code, signal });
          },
        }),
      },
    ),
    /fixture reliable delivery failed/,
  );
  assert.deepEqual(exits, [{ code: null, signal: 'SIGTERM' }]);
  record('delivery-failure', {
    exits,
    error: 'fixture reliable delivery failed',
    successfulResult: false,
  });
});

test('P0 command text projection separates resources and drops malformed events, unknown exits and disposed callbacks', async (t) => {
  const base = {
    commandId: 'same-command',
    operationId: 'op',
    command: 'git status',
    executable: 'git',
    args: ['status'],
    cwd: '/repo',
  };
  const f = await fixture(t, async (p, c) => {
    await c.events.write(p.type, p.payload, { agentId: c.agentId, resourceId: p.resource });
    return null;
  });
  const seen = [],
    exits = [];
  const off = subscribeWorkspaceEvents(f.client, {
    'command:output': (e) => seen.push(e),
    'command:exit': (e) => exits.push(e),
  });
  const emit = (resource, type, payload) =>
    f.client.request('fixture.run', { resource, type, payload });
  await emit('a', 'commands.output', {
    ...base,
    stream: 'stdout',
    base64: Buffer.from([0xe4]).toString('base64'),
  });
  await emit('b', 'commands.output', {
    ...base,
    stream: 'stdout',
    base64: Buffer.from('B').toString('base64'),
  });
  await emit('a', 'commands.output', {
    ...base,
    stream: 'stdout',
    base64: Buffer.from([0xb8, 0xad]).toString('base64'),
  });
  for (const resource of ['a', 'b'])
    await emit(resource, 'commands.exit', { ...base, exitCode: 0, signal: null });
  assert.deepEqual(
    seen.map((e) => [e.resource.resourceId, e.data]),
    [
      ['b', 'B'],
      ['a', '中'],
    ],
  );
  assert.equal(exits.length, 2);
  const before = seen.length;
  for (const bad of [
    { ...base, stream: 'progress', base64: 'AA==' },
    { ...base, stream: 'stdout', base64: 'invalid' },
  ])
    await emit('a', 'commands.output', bad);
  await emit('a', 'commands.exit', { ...base, exitCode: null, signal: 'SIGTERM' });
  assert.equal(seen.length, before);
  assert.equal(exits.length, 2);
  off();
  await emit('a', 'commands.output', { ...base, stream: 'stdout', base64: 'QQ==' });
  await emit('a', 'commands.exit', { ...base, exitCode: 0, signal: null });
  assert.equal(seen.length, before);
  assert.equal(exits.length, 2);
  record('projection-isolation', { seen, exits, disposedCallbackFired: false });
});
