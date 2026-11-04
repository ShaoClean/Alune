const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnAgent } = require('@alune/agent-client/node');
const { AgentState } = require('../dist/adapters/sqlite/state');
const { diagnosticLogs } = require('../dist/modules/diagnostics/logs');
const fixture = path.resolve(__dirname, 'settings-fixture.cjs');
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-diagnostics-'));
  const children = [];
  t.after(async () => {
    await Promise.all(children.map((c) => c.close()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    async start() {
      const child = spawnAgent(process.execPath, [fixture, root]);
      children.push(child);
      await child.client.initialize();
      return child;
    },
  };
}
test(
  'logging settings use durable revisions and reject stale or invalid saves',
  { timeout: 60000 },
  async (t) => {
    const f = await setup(t);
    const child = await f.start();
    const first = await child.client.getLoggingSettings();
    const settings = { customDirectory: null, level: 'DEBUG', retentionDays: 30, maxTotalMB: 250 };
    const saved = await child.client.saveLoggingSettings(settings, first.revision);
    await assert.rejects(
      child.client.saveLoggingSettings(settings, first.revision),
      (e) => e.kind === 'conflict',
    );
    await assert.rejects(
      child.client.saveLoggingSettings({ ...settings, retentionDays: 0 }, saved.revision),
      (e) => e.kind === 'invalid-params',
    );
    await child.close();
    const next = await f.start();
    assert.deepEqual(await next.client.getLoggingSettings(), saved);
    assert.equal(
      fs.existsSync(path.join(f.root, 'logging.json')),
      false,
      'Agent config belongs to SQLite',
    );
  },
);
test(
  'immutable log snapshots cross UTF-8 chunk boundaries, redact ciphertext and publish bounded invalidations',
  { timeout: 60000 },
  async (t) => {
    const f = await setup(t);
    const child = await f.start();
    const events = [];
    child.client.onEvent((event) => events.push(event));
    await child.client.subscribe(['diagnostics.logs.changed']);
    const cipher = 'aes-gcm:v1:' + Buffer.alloc(48, 7).toString('base64');
    const context = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => ['field' + i, '中🦊'.repeat(1000)]),
    );
    await child.client.request('diagnostics.logs.client', {
      message: 'probe ' + cipher,
      context: { ...context, password: 'fixture-private-password' },
    });
    const snapshot = await child.client.request('diagnostics.logs.snapshot', { limit: 1 });
    assert(snapshot.chunks > 1);
    const chunks = [];
    for (let index = 0; index < snapshot.chunks; index++) {
      const chunk = await child.client.request('diagnostics.logs.chunk', {
        snapshotId: snapshot.snapshotId,
        index,
      });
      assert(Buffer.byteLength(JSON.stringify(chunk)) < 65536);
      chunks.push(Buffer.from(chunk.base64, 'base64'));
    }
    const frozen = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(frozen[0].context.field0, context.field0);
    assert.doesNotMatch(JSON.stringify(frozen), /fixture-private-password|aes-gcm:v1:/);
    await child.client.request('diagnostics.logs.client', { message: 'later log' });
    const same = await child.client.request('diagnostics.logs.chunk', {
      snapshotId: snapshot.snapshotId,
      index: 0,
    });
    assert.deepEqual(Buffer.from(same.base64, 'base64'), chunks[0]);
    const recent = await child.client.recentLogs(2);
    assert.equal(recent.at(-1).message, 'later log');
    assert.equal(recent[0].context.field0, context.field0);
    assert(events.some((e) => e.type === 'diagnostics.logs.changed'));
    assert(events.every((e) => Buffer.byteLength(JSON.stringify(e)) < 1024));
    await child.client.request('diagnostics.logs.release', { snapshotId: snapshot.snapshotId });
    await assert.rejects(
      child.client.request('diagnostics.logs.chunk', { snapshotId: snapshot.snapshotId, index: 0 }),
      (e) => e.kind === 'not-found',
    );
  },
);
test(
  'renderer log flood is rate limited and stale snapshot handles fail explicitly',
  { timeout: 60000 },
  async (t) => {
    const f = await setup(t);
    const { client } = await f.start();
    const first = client.startRequest('diagnostics.logs.client', { message: 'fixture-0' });
    assert.equal((await first.result).accepted, true);
    assert.equal((await client.getTask({ requestId: first.requestId })).scope, 'session');
    for (let i = 1; i < 60; i++)
      assert.equal(
        (await client.request('diagnostics.logs.client', { message: 'fixture-' + i })).accepted,
        true,
      );
    assert.equal(
      (await client.request('diagnostics.logs.client', { message: 'must-drop' })).accepted,
      false,
    );
    const logs = await client.recentLogs(1000);
    assert.equal(logs.length, 60);
    assert.equal(
      logs.some((e) => e.message === 'must-drop'),
      false,
    );
    await assert.rejects(
      client.request('diagnostics.logs.client', { message: 'x'.repeat(1024 * 1024) }),
      (error) => error.kind === 'invalid-params',
    );
    const Database = require('better-sqlite3');
    const pointer = JSON.parse(fs.readFileSync(path.join(f.root, 'state/current.json')));
    const database = new Database(
      path.join(f.root, 'state/generations', pointer.generation, 'state.sqlite'),
      { readonly: true },
    );
    try {
      assert.equal(database.prepare('SELECT count(*) AS count FROM operations').get().count, 0);
    } finally {
      database.close();
    }
    const stale = await client.request('diagnostics.logs.snapshot', { limit: 1 });
    for (let i = 0; i < 4; i++) await client.request('diagnostics.logs.snapshot', { limit: 1 });
    await assert.rejects(
      client.request('diagnostics.logs.chunk', { snapshotId: stale.snapshotId, index: 0 }),
      (e) => e.kind === 'not-found',
    );
  },
);
test(
  'corrupt logging configuration stays intact and valid replacement is refused until recovery',
  { timeout: 30000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-bad-logging-'));
    const state = await AgentState.open(root, randomUUID());
    t.after(async () => {
      await state.close();
      fs.rmSync(root, { recursive: true, force: true });
    });
    const port = state.document('logging-settings');
    port.read();
    port.write({ damaged: true });
    const module = diagnosticLogs(root, state.document('logging-settings'));
    try {
      const context = { signal: new AbortController().signal, events: { notifyState() {} } };
      const read = module.handlers['diagnostics.logs.settings'].run(undefined, context);
      assert.match(read.settings.fallbackReason, /无法读取/);
      assert.throws(
        () =>
          module.handlers['diagnostics.logs.saveSettings'].run(
            {
              revision: read.revision,
              settings: {
                customDirectory: null,
                level: 'INFO',
                retentionDays: 14,
                maxTotalMB: 200,
              },
            },
            context,
          ),
        (e) => e.kind === 'corrupt',
      );
      assert.deepEqual(state.document('logging-settings').read(), { damaged: true });
    } finally {
      module.close();
    }
  },
);
