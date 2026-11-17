const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { spawnAgent } = require('@alune/agent-client/node');
const fixture = path.resolve(__dirname, 'settings-fixture.cjs');
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-task-journal-'));
  const children = [];
  t.after(async () => {
    await Promise.all(children.map((c) => c.close()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    async start(prefix) {
      const child = spawnAgent(process.execPath, [fixture, root]);
      children.push(child);
      // Simulate a client incorrectly replaying an old request after reconnect.
      if (prefix) child.client.prefix = prefix;
      await child.client.initialize();
      return child;
    },
  };
}
test(
  'mutation receipts survive process restart without storing parameters or operation results',
  { timeout: 60000 },
  async (t) => {
    const f = await setup(t);
    const first = await f.start();
    const ai = await first.client.getAiSettings();
    const handle = first.client.startRequest('settings.ai.saveCommit', {
      commit: { ...ai.commit, prompt: 'fixture-private-prompt' },
      revision: ai.revision,
    });
    await handle.result;
    const receipt = await first.client.getTask({ requestId: handle.requestId });
    assert.equal(receipt.scope, 'agent');
    assert.equal(receipt.task.state, 'succeeded');
    assert.equal(receipt.task.outcome, 'completed');
    await first.close();
    const next = await f.start();
    assert.deepEqual(await next.client.getTask({ taskId: receipt.task.taskId }), receipt);
    assert.deepEqual(await next.client.getTask({ requestId: handle.requestId }), receipt);
    await next.close();
    const pointer = JSON.parse(fs.readFileSync(path.join(f.root, 'state/current.json')));
    const db = new Database(
      path.join(f.root, 'state/generations', pointer.generation, 'state.sqlite'),
      { readonly: true },
    );
    try {
      const rows = db.prepare('SELECT * FROM operations').all();
      assert.equal(rows.length, 1);
      assert.doesNotMatch(
        JSON.stringify(rows),
        /fixture-private-prompt|providers|encryptedKey|aes-gcm:/,
      );
    } finally {
      db.close();
    }
  },
);
test(
  'crashed mutations become unknown and an identical request is never executed again',
  { timeout: 60000 },
  async (t) => {
    const f = await setup(t);
    const first = await f.start();
    const request = first.client.startRequest('fixture.journalCrash', {
      secret: 'fixture-request-secret',
    });
    await assert.rejects(request.result, (e) => e.outcome === 'unknown');
    assert.equal((await first.exited).code, 7);
    const next = await f.start();
    const receipt = await next.client.getTask({ requestId: request.requestId });
    assert.equal(receipt.scope, 'agent');
    assert.equal(receipt.task.state, 'unknown');
    assert.equal(receipt.task.outcome, 'unknown');
    assert(receipt.task.finishedAt >= receipt.task.startedAt);
    assert.doesNotMatch(JSON.stringify(receipt), /fixture-request-secret/);
    await next.close();
    const replay = await f.start(request.requestId.split(':')[0]);
    const duplicate = replay.client.startRequest('fixture.journalCrash', {
      secret: 'different request content',
    });
    assert.equal(duplicate.requestId, request.requestId);
    await assert.rejects(duplicate.result, (e) => e.kind === 'conflict' && e.outcome === 'unknown');
    assert.equal(fs.readFileSync(path.join(f.root, 'fixture-writes'), 'utf8'), 'write\n');
    assert.deepEqual(await replay.client.getTask({ requestId: request.requestId }), receipt);
  },
);

test('failed durable finalization is immediately reported as unknown instead of stale running state', async () => {
  const { AgentSession } = require('../dist');
  const pending = new Map();
  let receive,
    close,
    serial = 0,
    stored;
  const transport = {
    onMessage(fn) {
      receive = fn;
      return () => {};
    },
    onClose(fn) {
      close = fn;
      return () => {};
    },
    send(message) {
      pending.get(message.id)?.(message);
      return Promise.resolve();
    },
    close(error) {
      close?.(error);
    },
  };
  const session = new AgentSession(transport, {
    agentId: 'fixture-agent',
    version: 'fixture',
    taskJournal: {
      start(task) {
        stored = structuredClone(task);
      },
      finish() {
        throw Error('fixture durable failure');
      },
      find() {
        return structuredClone(stored);
      },
    },
    handlers: {
      'fixture.write': {
        effect: 'mutation',
        validate() {},
        run() {
          return { written: true };
        },
      },
    },
  });
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = 'fixture:' + ++serial;
      pending.set(id, resolve);
      receive({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    });
  try {
    await request('initialize', {
      protocol: { major: 1, minor: 1 },
      client: { name: 'fixture', version: '1' },
    });
    assert.equal((await request('fixture.write')).error.data.outcome, 'unknown');
    assert.equal(stored.state, 'running');
    const receipt = await request('tasks.get', { requestId: 'fixture:2' });
    assert.equal(receipt.result.scope, 'agent');
    assert.equal(receipt.result.task.state, 'unknown');
    assert.equal(receipt.result.task.outcome, 'unknown');
  } finally {
    await session.close();
  }
});
