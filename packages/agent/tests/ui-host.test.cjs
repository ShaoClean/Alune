const { test } = require('node:test');
const assert = require('node:assert/strict');
const { launchUiAgent, frameTransport, AgentClient } = require('@alune/agent-client/node');
const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { until } = require('./terminal-scenario.cjs');
test('UI IPC preserves escaped Unicode data across bounded repository chunks', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'alune-ui-frames-'));
  const host = await launchUiAgent(
    process.execPath,
    join(__dirname, '../bin/alune-agent.cjs'),
    join(dir, 'state'),
  );
  t.after(async () => {
    await host.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const client = new AgentClient(frameTransport(await host.open('workspace')));
  t.after(() => client.close());
  await client.initialize();
  const repo = join(dir, 'git');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  const text = 'quotes " \\ tab\t 中文🚀\r\n'.repeat(6000);
  writeFileSync(join(repo, 'Unicode 中🚀.txt'), text);
  const { resource } = await client.registerRepository(repo);
  const receipt = await client.request('repositories.read', {
    resource,
    kind: 'file',
    params: { path: 'Unicode 中🚀.txt' },
  });
  assert(receipt.chunks > 1);
  const file = await client.readRepository(resource, 'file', { path: 'Unicode 中🚀.txt' });
  assert.equal(file.content, text);
  assert.equal(file.encoding, 'utf-8');
});
test('two windows share committed state, not terminal ownership, request IDs or native authority', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'alune-ui-host-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const repo = join(dir, 'git');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  writeFileSync(join(repo, 'a.txt'), 'from workspace');
  const host = await launchUiAgent(
    process.execPath,
    join(__dirname, '../bin/alune-agent.cjs'),
    join(dir, 'state'),
  );
  t.after(() => host.close());
  async function open(role) {
    const c = new AgentClient(frameTransport(await host.open(role)));
    await c.initialize();
    await c.subscribe(['*']);
    return c;
  }
  const [a, b, logs, native] = await Promise.all(
    ['workspace', 'workspace', 'logs', 'native'].map(open),
  );
  try {
    assert.equal(a.initialized.agentId, b.initialized.agentId);
    assert.notEqual(a.initialized.sessionId, b.initialized.sessionId);
    await assert.rejects(a.updaterBridge(), (e) => e.kind === 'unknown-method');
    await assert.rejects(logs.registerRepository(repo), (e) => e.kind === 'unknown-method');
    await a.request('diagnostics.logs.client', { level: 'WARN', message: 'renderer-source' });
    assert.equal(
      (await logs.recentLogs(10)).find((e) => e.message === 'renderer-source').source,
      'web',
    );
    await assert.rejects(
      a.request('diagnostics.logs.client', { message: 'wrong-source', source: 'native' }),
      { kind: 'invalid-params' },
    );
    let invalidated = false,
      shellReady = false,
      leaked = false;
    b.onEvent((e) => {
      if (e.type === 'repositories.changed') invalidated = true;
      if (e.type.startsWith('terminal:')) leaked = true;
    });
    const { resource } = await a.registerRepository(repo);
    await until(() => invalidated, 'other window received catalog change');
    assert.equal(
      (await b.getRepository(resource)).path,
      require('node:fs').realpathSync.native(repo).split(require('node:path').sep).join('/'),
    );
    const intent = { resource, kind: 'stage', args: [['a.txt']] },
      operationId = randomUUID();
    const write = { ...intent, operationId, revision: await a.prepareRepositoryWrite(intent) };
    await a.writeRepository(write);
    await assert.rejects(b.writeRepository(write), (e) => e.kind === 'duplicate-request');
    assert.equal((await b.getTask({ taskId: operationId })).task.state, 'succeeded');
    assert.equal(
      execFileSync('git', ['-C', repo, 'show', ':a.txt'], { encoding: 'utf8' }),
      'from workspace',
    );
    const id = randomUUID();
    a.onEvent((e) => {
      if (e.type === 'terminal:state' && e.payload.state === 'running') shellReady = true;
    });
    await a.request('terminals.create', { resource, requestId: id, cols: 80, rows: 24 });
    await until(() => shellReady, 'owned terminal starts');
    assert.deepEqual(await b.request('terminals.list', {}), []);
    const impact = (await native.request('desktop.terminals.impact', {}))[0];
    assert.equal(impact.id, id);
    assert.equal(impact.environment, '本机');
    const running = (await a.request('terminals.list', {})).find((s) => s.id === id);
    assert.equal(running.environment, 'Alune 服务主机 · ' + require('node:os').hostname());
    a.close();
    for (let i = 0; i < 100 && (await native.request('desktop.terminals.impact', {})).length; i++)
      await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(await native.request('desktop.terminals.impact', {}), []);
    assert.equal(leaked, false);
    await native.request('desktop.log', {
      level: 'WARN',
      source: 'native',
      message: 'window survived',
    });
    assert.ok((await logs.recentLogs()).some((x) => x.message === 'window survived'));
  } finally {
    a.close();
    b.close();
    logs.close();
    native.close();
    await host.close();
  }
});

test('a fresh channel restarts a crashed UI host without changing owner or replaying its writes', async (t) => {
  const { superviseUiAgent } = require('@alune/agent-client/node'),
    { version } = require('../dist/version.json');
  const dir = mkdtempSync(join(tmpdir(), 'alune-ui-restart-'));
  const host = await superviseUiAgent(
    process.execPath,
    join(__dirname, '../bin/alune-agent.cjs'),
    join(dir, 'state'),
    version,
  );
  const open = async () => {
    const c = new AgentClient(frameTransport(await host.open('workspace')));
    await c.initialize();
    return c;
  };
  try {
    const a = await open(),
      repo = join(dir, 'git');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    const row = await a.registerRepository(repo),
      closed = new Promise((resolve) => a.onClose(resolve));
    process.kill(host.pid, 'SIGKILL');
    await closed;
    const b = await open();
    assert.equal(b.initialized.agentId, row.resource.agentId);
    assert.notEqual(a.initialized.sessionId, b.initialized.sessionId);
    assert.equal((await b.listRepositories()).length, 1);
    b.close();
  } finally {
    await host.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  }
});
