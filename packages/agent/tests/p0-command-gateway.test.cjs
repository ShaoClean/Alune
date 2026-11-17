// Complete frozen gateway executes in VM; Nest decorators and socket send are explicit doubles.
// Current integration uses actual local Node Agent children, SDK, SQLite, stdio and Git.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { spawnAgent } = require('@alune/agent-client/node');
const plain = (v) => JSON.parse(JSON.stringify(v));
function record(name, value) {
  if (process.env.P0_COMMAND_GATEWAY_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_COMMAND_GATEWAY_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function legacy() {
  assert(process.env.P0_COMMAND_GATEWAY_FROZEN, 'Use batch-18 replay driver');
  const source = fs.readFileSync(
    path.join(process.env.P0_COMMAND_GATEWAY_FROZEN, 'apps/server/src/events/events.gateway.ts'),
    'utf8',
  );
  const module = { exports: {} },
    metadata = [],
    sent = [];
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
    },
  }).outputText;
  vm.runInNewContext(
    output,
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
              assert.fail('Command emitters do not subscribe to logs');
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
  return { gateway, metadata, sent };
}

test('P0 command gateway full frozen class emits exact output channel and payload for both streams', () => {
  const { gateway, metadata, sent } = legacy();
  const command = 'git commit -m "literal $HOME 中文"';
  const cases = [
    ['owner-a', command, '中文\r\n\0尾', 'stdout'],
    ['owner-a', command, 'error\r\n', 'stderr'],
    ['owner-b', 'git diff', '', 'stdout'],
    ['owner-b', 'git status', 'B', 'stderr'],
  ];
  for (const args of cases) assert.equal(gateway.emitCommandOutput(...args), undefined);
  assert.deepEqual(
    sent,
    cases.map(([connectionId, command, data, type]) => ({
      name: 'command:output',
      payload: { connectionId, command, data, type },
    })),
  );
  assert(metadata.some((m) => m.name === 'WebSocketGateway'));
  assert(metadata.some((m) => m.name === 'WebSocketServer' && m.member === 'server'));
  record('command-gateway-frozen-output', {
    completeClassExecuted: true,
    cases,
    sent,
    metadata,
    socketSend: 'captured double; no live WebSocket',
  });
});

test('P0 command gateway full frozen class emits exact numeric exit channel and preserves call order', () => {
  const { gateway, sent } = legacy();
  const codes = [0, 1, 7, 128];
  for (const [index, exitCode] of codes.entries()) {
    const owner = index % 2 ? 'owner-b' : 'owner-a';
    assert.equal(
      gateway.emitCommandOutput(owner, 'git fixture', 'before-' + exitCode, 'stdout'),
      undefined,
    );
    assert.equal(gateway.emitCommandExit(owner, 'git fixture', exitCode), undefined);
  }
  assert.deepEqual(
    sent,
    codes.flatMap((exitCode, index) => {
      const connectionId = index % 2 ? 'owner-b' : 'owner-a';
      return [
        {
          name: 'command:output',
          payload: {
            connectionId,
            command: 'git fixture',
            data: 'before-' + exitCode,
            type: 'stdout',
          },
        },
        { name: 'command:exit', payload: { connectionId, command: 'git fixture', exitCode } },
      ];
    }),
  );
  record('command-gateway-frozen-exit', {
    codes,
    sent,
    note: 'Legacy numeric passthrough; signal/null handling is tested only on successor, no identical wire claim',
  });
});

test('P0 command gateway real stdio owners isolate command streams and reject foreign cancelled and replayed writes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch18-'));
  const children = [];
  t.after(async () => {
    for (const c of children) await c.close();
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
  async function owner(label) {
    const repo = path.join(root, label + ' 中文 repo');
    fs.mkdirSync(repo);
    const git = (...args) =>
      execFileSync('git', ['-C', repo, ...args], {
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trimEnd();
    git('init', '-b', 'main');
    git('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo, 'file.txt'), 'base\n');
    git('add', '.');
    git('commit', '-m', 'initial');
    const counter = path.join(repo, '.git', 'hook-count');
    fs.writeFileSync(
      path.join(repo, '.git/hooks/pre-commit'),
      '#!/bin/sh\nprintf "' +
        label +
        ' 中文 stdout\\r\\n"\nprintf "' +
        label +
        ' stderr\\r\\n" >&2\nprintf "run\\n" >> ' +
        JSON.stringify(counter) +
        '\n',
      { mode: 0o700 },
    );
    let child, info, events;
    async function start() {
      child = spawnAgent(
        process.execPath,
        [path.join(__dirname, 'settings-fixture.cjs'), path.join(root, label + '-state')],
        { env },
      );
      children.push(child);
      info = await child.client.initialize();
      events = [];
      child.client.onEvent((e) => events.push(structuredClone(e)));
      await child.client.subscribe(['commands.output', 'commands.exit']);
    }
    await start();
    const { resource } = await child.client.registerRepository(repo);
    async function prepare() {
      const intent = { resource, kind: 'commit', args: ['batch18-' + label] };
      return {
        ...intent,
        revision: await child.client.prepareRepositoryWrite(intent),
        operationId: randomUUID(),
      };
    }
    return {
      repo,
      git,
      resource,
      counter,
      prepare,
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
  const a = await owner('owner-a'),
    b = await owner('owner-b');
  assert.notEqual(a.info.agentId, b.info.agentId);
  assert.notEqual(a.info.sessionId, b.info.sessionId);
  for (const f of [a, b]) {
    fs.writeFileSync(path.join(f.repo, 'file.txt'), 'changed\n');
    f.git('add', '.');
  }
  await assert.rejects(
    b.child.client.prepareRepositoryWrite({
      resource: a.resource,
      kind: 'commit',
      args: ['must-not-run'],
    }),
    (e) => e.kind === 'not-found',
  );
  assert.equal(fs.existsSync(a.counter), false);
  assert.equal(fs.existsSync(b.counter), false);
  const requestA = await a.prepare(),
    requestB = await b.prepare();
  const preCancelled = new AbortController();
  preCancelled.abort();
  await assert.rejects(
    a.child.client.writeRepository(
      { ...requestA, operationId: randomUUID() },
      { signal: preCancelled.signal },
    ),
    (e) => e.kind === 'cancelled' && e.outcome === 'not-started',
  );
  assert.equal(fs.existsSync(a.counter), false);
  assert.equal(a.events.length, 0);
  assert.equal(b.events.length, 0);
  await Promise.all([
    a.child.client.writeRepository(requestA),
    b.child.client.writeRepository(requestB),
  ]);
  for (const [f, request, other] of [
    [a, requestA, b],
    [b, requestB, a],
  ]) {
    assert(f.events.length > 0);
    assert(
      f.events.every(
        (e) =>
          e.agentId === f.info.agentId &&
          e.sessionId === f.info.sessionId &&
          e.resource.agentId === f.resource.agentId &&
          e.resource.resourceId === f.resource.resourceId &&
          e.payload.operationId === request.operationId,
      ),
    );
    assert.deepEqual(
      f.events.map((e) => e.sequence),
      f.events.map((_, i) => i + 1),
    );
    assert(
      f.events
        .filter((e) => e.type === 'commands.output')
        .every((e) => Buffer.from(e.payload.base64, 'base64').length <= 16384),
    );
    const commandIds = new Set(f.events.map((e) => e.payload.commandId));
    for (const id of commandIds) {
      const group = f.events.filter((e) => e.payload.commandId === id),
        exits = group.filter((e) => e.type === 'commands.exit');
      assert.equal(exits.length, 1);
      assert.equal(group.at(-1).type, 'commands.exit');
      assert.equal(exits[0].payload.exitCode, 0);
      assert.equal(exits[0].payload.signal, null);
    }
    const commit = f.events.find(
      (e) => e.type === 'commands.exit' && e.payload.args.includes('commit'),
    );
    assert(commit);
    const output = Buffer.concat(
      f.events
        .filter(
          (e) => e.type === 'commands.output' && e.payload.commandId === commit.payload.commandId,
        )
        .map((e) => Buffer.from(e.payload.base64, 'base64')),
    ).toString('utf8');
    const ownLabel = f === a ? 'owner-a' : 'owner-b',
      otherLabel = f === a ? 'owner-b' : 'owner-a';
    assert(output.includes(ownLabel + ' 中文 stdout\r\n'));
    assert(output.includes(ownLabel + ' stderr\r\n'));
    assert(!output.includes(otherLabel));
    assert.equal(fs.readFileSync(f.counter, 'utf8'), 'run\n');
    assert.equal(f.git('rev-list', '--count', 'HEAD'), '2');
    const count = f.events.length,
      otherCount = other.events.length;
    await assert.rejects(
      f.child.client.writeRepository(request),
      (e) => e.kind === 'duplicate-request' && e.outcome === 'unknown',
    );
    assert.equal(f.events.length, count);
    assert.equal(other.events.length, otherCount);
    assert.equal(fs.readFileSync(f.counter, 'utf8'), 'run\n');
  }
  const firstA = { info: a.info, events: a.events },
    beforeB = b.events.length;
  await a.child.close();
  await a.start();
  assert.equal(a.info.agentId, firstA.info.agentId);
  assert.notEqual(a.info.sessionId, firstA.info.sessionId);
  const receipt = await a.child.client.getTask({ taskId: requestA.operationId });
  assert.equal(receipt.task.state, 'succeeded');
  await assert.rejects(
    a.child.client.writeRepository(requestA),
    (e) => e.kind === 'duplicate-request' && e.outcome === 'unknown',
  );
  assert.deepEqual(a.events, []);
  assert.equal(b.events.length, beforeB);
  assert.equal(fs.readFileSync(a.counter, 'utf8'), 'run\n');
  assert.equal(a.git('rev-list', '--count', 'HEAD'), '2');
  assert.equal((await b.child.client.health()).status, 'ok');
  record('command-gateway-stdio-owners', {
    firstA,
    restartedA: { info: a.info, events: a.events, receipt },
    b: { info: b.info, events: b.events },
    foreignWriteRejected: true,
    preCancelledNoEvents: true,
    hookCounts: [1, 1],
    commitCounts: [2, 2],
    replayExecuted: false,
    transport: 'two separate local Agent owners via actual stdio; no shared kernel/SSH/UI claim',
  });
});
