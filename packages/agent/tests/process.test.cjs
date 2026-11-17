const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { AgentClient, StdioTransport } = require('@alune/agent-client/node');
const { encodeMessage, FrameDecoder, parseMessage, PROTOCOL_VERSION } = require('@alune/protocol');
const cli = path.resolve(__dirname, '../bin/alune-agent.cjs');
test(
  'in-flight input budget rejects excess before execution and async validators cannot bypass it',
  { timeout: 15000 },
  async (t) => {
    const f = launch(t);
    await f.client.initialize();
    await assert.rejects(
      f.client.request('fixture.invalidAsyncValidation'),
      (e) => e.kind === 'internal' && e.outcome === 'not-started',
    );
    assert.equal(fs.existsSync(path.join(f.root, 'invalid-write')), false);
    await f.client.subscribe(['tasks.changed']);
    let running = false;
    f.client.onEvent((event) => {
      if (event.payload.method === 'fixture.hold' && event.payload.state === 'running')
        running = true;
    });
    const padding = 'x'.repeat(5 * 1024 * 1024);
    const cancellation = new AbortController();
    const first = f.client.request('fixture.hold', { padding }, { signal: cancellation.signal });
    const cancelled = assert.rejects(first, (e) => e.kind === 'cancelled');
    await until(() => running);
    await assert.rejects(
      f.client.request('fixture.delay', { ms: 0, padding }),
      (e) => e.kind === 'overloaded' && e.outcome === 'not-started',
    );
    cancellation.abort();
    await cancelled;
    assert.deepEqual(await f.client.request('fixture.delay', { ms: 0, padding }), { value: null });
  },
);
async function until(check, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Fixture condition timed out');
    await delay(5);
  }
}

function launch(t, fixture = true, dataDir) {
  const root = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'alune-agent-test-'));
  let stderr = '';
  const child = spawn(
    process.execPath,
    fixture ? [path.join(__dirname, 'fixture.cjs')] : [cli, 'serve', '--data-dir', root],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ALUNE_FIXTURE_DIR: root } },
  );
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exit = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  const transport = new StdioTransport(child.stdout, child.stdin);
  const client = new AgentClient(transport);
  const close = async () => {
    client.close();
    const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
    await exit;
    clearTimeout(timer);
    if (!dataDir) fs.rmSync(root, { recursive: true, force: true });
  };
  t.after(close);
  return {
    child,
    client,
    exit,
    root,
    close,
    get stderr() {
      return stderr;
    },
  };
}

test(
  'standalone CLI handshake, identity persistence, core methods and EOF cleanup',
  { timeout: 15000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-agent-identity-'));
    const children = [];
    t.after(async () => {
      await Promise.all(children.map((child) => child.close()));
      fs.rmSync(root, { recursive: true, force: true });
    });
    const a = launch(t, false, root);
    children.push(a);
    const first = await a.client.initialize();
    assert.equal(first.lifecycle, 'session');
    assert.equal((await a.client.health()).status, 'ok');
    assert.equal((await a.client.version()).protocol.major, 1);
    assert((await a.client.capabilities()).capabilities.includes('tasks.get'));
    a.client.close();
    assert.deepEqual(await a.exit, { code: 0, signal: null });
    const b = launch(t, false, root);
    children.push(b);
    const second = await b.client.initialize();
    assert.equal(first.agentId, second.agentId);
    assert.notEqual(first.sessionId, second.sessionId);
    assert.equal(a.stderr, '');
    assert.equal(b.stderr, '');
    await b.close();
    assert.deepEqual(await b.exit, { code: 0, signal: null });
  },
);

test(
  'out-of-order responses, validation and cancellation races use real stdio',
  { timeout: 15000 },
  async (t) => {
    const { client } = launch(t);
    await client.initialize();
    const finished = [];
    const slow = client.request('fixture.delay', { ms: 100, value: 'slow' }).then((v) => {
      finished.push('slow');
      return v;
    });
    const fast = client.request('fixture.delay', { ms: 1, value: 'fast' }).then((v) => {
      finished.push('fast');
      return v;
    });
    assert.deepEqual(await Promise.all([slow, fast]), [{ value: 'slow' }, { value: 'fast' }]);
    assert.deepEqual(finished, ['fast', 'slow']);
    await assert.rejects(
      client.request('fixture.delay', { ms: -1 }),
      (e) => e.kind === 'invalid-params' && e.outcome === 'not-started',
    );
    const abort = new AbortController();
    const cancelled = client.request('fixture.delay', { ms: 1000 }, { signal: abort.signal });
    abort.abort();
    await assert.rejects(cancelled, (e) => e.kind === 'cancelled');
    const ignored = new AbortController();
    const completed = client.request(
      'fixture.ignoreCancel',
      { ms: 50 },
      { signal: ignored.signal },
    );
    ignored.abort();
    assert.deepEqual(await completed, { completed: true });
  },
);

test(
  'disconnect after mutation is unknown and never replayed; cancellation does not undo a write',
  { timeout: 15000 },
  async (t) => {
    const a = launch(t);
    await a.client.initialize();
    await assert.rejects(
      a.client.request('fixture.crash'),
      (e) => e.kind === 'disconnected' && e.outcome === 'unknown',
    );
    assert.equal(fs.readFileSync(path.join(a.root, 'writes.txt'), 'utf8'), 'write\n');
    assert.equal((await a.exit).code, 7);
    const b = launch(t);
    await b.client.initialize();
    const controller = new AbortController();
    const pending = b.client.request('fixture.mutate', { ms: 1000 }, { signal: controller.signal });
    await until(() => fs.existsSync(path.join(b.root, 'writes.txt')));
    controller.abort();
    await assert.rejects(pending, (e) => e.kind === 'cancelled' && e.outcome === 'unknown');
    assert.equal(fs.readFileSync(path.join(b.root, 'writes.txt'), 'utf8'), 'write\n');
  },
);

test(
  'reliable output awaits consumer ACK and state overflow requests resync',
  { timeout: 15000 },
  async (t) => {
    const { client } = launch(t);
    await client.initialize();
    await client.subscribe(['fixture.output', 'fixture.state']);
    const events = [];
    client.onEvent(async (event) => {
      events.push(event);
      if (event.type === 'fixture.output') await delay(2);
    });
    assert.deepEqual(await client.request('fixture.stream'), { count: 10 });
    assert.deepEqual(
      events.filter((e) => e.type === 'fixture.output').map((e) => e.payload.i),
      [...Array(10).keys()],
    );
    assert.deepEqual(await client.request('fixture.flood'), { latest: 9999 });
    for (
      let n = 0;
      n < 200 && !events.some((e) => e.type === 'fixture.state' && e.payload.i === 9999);
      n++
    )
      await delay(5);
    assert(events.some((e) => e.type === 'events.resync-required'));
    assert(events.some((e) => e.type === 'fixture.state' && e.payload.i === 9999));
    assert(events.length < 100);
    assert(events.every((e, i) => i === 0 || e.sequence > events[i - 1].sequence));
  },
);

test('EOF aborts running tasks and invokes resource disposal', { timeout: 10000 }, async (t) => {
  const f = launch(t);
  await f.client.initialize();
  const pending = f.client.request('fixture.delay', { ms: 2000 });
  const rejected = assert.rejects(pending, (e) => e.outcome === 'unknown');
  f.client.close();
  await rejected;
  assert.deepEqual(await f.exit, { code: 0, signal: null });
  assert.equal(fs.readFileSync(path.join(f.root, 'disposed'), 'utf8'), 'yes');
});

test('duplicate request IDs cannot execute a mutation twice', { timeout: 10000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-agent-duplicate-'));
  const child = spawn(process.execPath, [path.join(__dirname, 'fixture.cjs')], {
    env: { ...process.env, ALUNE_FIXTURE_DIR: root },
  });
  const frames = [];
  const decoder = new FrameDecoder();
  let stderr = '';
  child.stdout.on('data', (chunk) =>
    decoder.push(chunk, (frame) => frames.push(parseMessage(frame))),
  );
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  t.after(() => {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });
  child.stdin.write(
    encodeMessage({
      jsonrpc: '2.0',
      id: 'raw:1',
      method: 'initialize',
      params: { protocol: { major: 1, minor: 0 }, client: { name: 'raw', version: '1' } },
    }),
  );
  await until(() => frames.length);
  const request = encodeMessage({
    jsonrpc: '2.0',
    id: 'raw:2',
    method: 'fixture.mutate',
    params: { ms: 1000 },
  });
  child.stdin.write(request + request);
  await exited;
  assert.equal(fs.readFileSync(path.join(root, 'writes.txt'), 'utf8'), 'write\n');
  assert(frames.some((f) => f.id === null && f.error?.data.kind === 'duplicate-request'));
  assert.equal(stderr, '');
});

test('doctor performs real Node ABI SQLite and PTY checks', { timeout: 10000 }, () => {
  const result = JSON.parse(
    execFileSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8', timeout: 9000 }),
  );
  assert.deepEqual(result.native, { sqlite: true, pty: true });
  assert.equal(result.ok, true);
  assert.equal(result.abi, process.versions.modules);
});

test(
  'timed-out request ID can be reconciled within its session without replay',
  { timeout: 10000 },
  async (t) => {
    const { client } = launch(t);
    await client.initialize();
    const request = client.startRequest('fixture.ignoreCancel', { ms: 60 }, { timeoutMs: 10 });
    await assert.rejects(request.result, (e) => e.kind === 'timeout' && e.outcome === 'unknown');
    await delay(100);
    const status = await client.getTask({ requestId: request.requestId });
    assert.equal(status.scope, 'session');
    assert.equal(status.task.state, 'succeeded');
    assert.equal(status.task.outcome, 'completed');
    assert.equal(status.task.requestId, request.requestId);
  },
);

test(
  'real process rejects pre-init, incompatible versions, unknown methods and bad core params',
  { timeout: 10000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-agent-contract-'));
    const child = spawn(process.execPath, [cli, 'serve', '--data-dir', root]);
    const transport = new StdioTransport(child.stdout, child.stdin);
    const responses = new Map();
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    transport.onMessage((message) => responses.set(message.id, message));
    t.after(async () => {
      transport.close();
      await exited;
      fs.rmSync(root, { recursive: true, force: true });
    });
    let serial = 0;
    const exchange = async (method, params) => {
      const id = `raw:${++serial}`;
      await transport.send({
        jsonrpc: '2.0',
        id,
        method,
        ...(params === undefined ? {} : { params }),
      });
      await until(() => responses.has(id));
      return responses.get(id);
    };
    assert.equal((await exchange('agent.health')).error.data.kind, 'not-initialized');
    const client = { name: '旧版/新版 fixture', version: '1' };
    assert.equal(
      (await exchange('initialize', { protocol: { major: 2, minor: 0 }, client })).error.data.kind,
      'incompatible-version',
    );
    const handshake = await exchange('initialize', { protocol: { major: 1, minor: 99 }, client });
    assert.deepEqual(handshake.result.protocol, PROTOCOL_VERSION);
    assert.equal((await exchange('not.a.method')).error.data.kind, 'unknown-method');
    assert.equal((await exchange('constructor')).error.data.kind, 'unknown-method');
    assert.equal(
      (await exchange('agent.health', { extra: true })).error.data.kind,
      'invalid-params',
    );
    assert.equal((await exchange('agent.health')).result.status, 'ok');
    assert.equal(stderr, '');
  },
);

test(
  'truncated input ends the process instead of keeping a half-open session',
  { timeout: 10000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-agent-truncated-'));
    const child = spawn(process.execPath, [cli, 'serve', '--data-dir', root]);
    child.stdout.resume();
    child.stderr.resume();
    const exited = new Promise((resolve) => child.once('exit', resolve));
    t.after(() => {
      child.kill();
      fs.rmSync(root, { recursive: true, force: true });
    });
    child.stdin.end('{"jsonrpc":"2.0"');
    assert.equal(await exited, 1);
  },
);

test(
  'late cancellation and session close never abort an already completed mutation',
  { timeout: 10000 },
  async (t) => {
    const f = launch(t);
    await f.client.initialize();
    const request = f.client.startRequest('fixture.completed');
    assert.deepEqual(await request.result, { completed: true });
    await f.client.request('requests.cancel', { requestId: request.requestId });
    f.client.close();
    assert.equal((await f.exit).code, 0);
    assert.equal(fs.existsSync(path.join(f.root, 'late-abort')), false);
  },
);

test(
  'long-lived sessions do not accumulate IDs or impose a 4096-request disconnect',
  { timeout: 30000 },
  async (t) => {
    const f = launch(t);
    await f.client.initialize();
    for (let i = 0; i < 4100; i++) assert.equal((await f.client.health()).status, 'ok');
    const first = f.client.startRequest('fixture.completed');
    await first.result;
    for (let i = 0; i < 1030; i++) await f.client.request('fixture.completed');
    assert.equal((await f.client.getTask({ requestId: first.requestId })).task, null);
    assert.equal(f.client.state, 'ready');
    f.client.close();
    assert.equal((await f.exit).code, 0);
    assert.equal(fs.existsSync(path.join(f.root, 'late-abort')), false);
  },
);

test(
  'control queries and cancellation remain available when business concurrency is full',
  { timeout: 15000 },
  async (t) => {
    const f = launch(t);
    await f.client.initialize();
    const controllers = Array.from({ length: 64 }, () => new AbortController());
    const pending = controllers.map((controller) =>
      assert.rejects(
        f.client.request('fixture.hold', {}, { signal: controller.signal }),
        (error) => error.kind === 'cancelled',
      ),
    );
    assert.equal((await f.client.health()).status, 'ok');
    await assert.rejects(f.client.request('fixture.hold'), (error) => error.kind === 'overloaded');
    controllers.forEach((controller) => controller.abort());
    await Promise.all(pending);
    f.client.close();
    assert.equal((await f.exit).code, 0);
  },
);
