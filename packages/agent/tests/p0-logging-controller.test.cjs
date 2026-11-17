// Real disposable files/SQLite; frozen Nest decorators are metadata-only stand-ins, no HTTP server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const { spawnAgent } = require('@alune/agent-client/node');
const { AgentState } = require('../dist/adapters/sqlite/state');
const { diagnosticLogs } = require('../dist/modules/diagnostics/logs');
const plain = (v) => JSON.parse(JSON.stringify(v));
const settings = { customDirectory: null, level: 'DEBUG', retentionDays: 14, maxTotalMB: 200 };
const identity = (row) => {
  const result = plain(row);
  delete result.time;
  return result;
};
function record(name, value) {
  if (process.env.P0_LOGGING_CONTROLLER_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_LOGGING_CONTROLLER_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch14-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function legacy(t, directory, clock = () => Date.now()) {
  assert(process.env.P0_LOGGING_CONTROLLER_FROZEN, 'Use batch-14 replay driver');
  const modules = new Map(),
    metadata = [];
  class BadRequestException extends Error {}
  class Clock extends Date {
    static now() {
      return clock();
    }
  }
  const common = { BadRequestException };
  for (const name of ['Body', 'Controller', 'Get', 'HttpCode', 'Post', 'Put', 'Query'])
    common[name] =
      (...args) =>
      (...target) => {
        metadata.push({ name, args, member: target[1] });
      };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const source = fs.readFileSync(
      path.join(process.env.P0_LOGGING_CONTROLLER_FROZEN, file),
      'utf8',
    );
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        experimentalDecorators: true,
      },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(
      output,
      {
        module,
        exports: module.exports,
        Error,
        Date: Clock,
        Buffer,
        process: { pid: process.pid },
        setInterval,
        clearInterval,
        setTimeout,
        clearTimeout,
        require(id) {
          if (id === 'node:fs') return fs;
          if (id === 'node:path') return path;
          if (id === '@nestjs/common') return common;
          if (id === '@alune/shared') return load('packages/shared/src/types/logging.ts');
          if (id === './redact') return load('apps/server/src/logging/redact.ts');
          if (id === './log-store') return load('apps/server/src/logging/log-store.ts');
          if (id === './logger') return { logStore: () => store, logger };
          throw Error('Unexpected frozen import: ' + id);
        },
      },
      { filename: file },
    );
    modules.set(file, module.exports);
    return module.exports;
  }
  const { LogStore } = load('apps/server/src/logging/log-store.ts');
  const store = new LogStore(directory);
  t.after(() => store.close());
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => store.write(level.toUpperCase(), ...args),
    ]),
  );
  const { LoggingController } = load('apps/server/src/logging/logging.controller.ts');
  return { controller: new LoggingController(), store, metadata, BadRequestException };
}
async function current(t, directory, renderer = true) {
  const agentId = randomUUID();
  const state = await AgentState.open(directory, agentId);
  const module = diagnosticLogs(directory, state.document('logging-settings'));
  t.after(async () => {
    module.close();
    await state.close();
  });
  const signal = new AbortController().signal;
  const events = [];
  const context = {
    agentId,
    sessionId: randomUUID(),
    taskId: randomUUID(),
    signal,
    sessionSignal: signal,
    ...(renderer ? { workspaceRenderer: true } : {}),
    events: {
      notifyState(...args) {
        events.push(args);
      },
      subscribed() {
        return true;
      },
      failStream(error) {
        throw error;
      },
      async write() {},
    },
  };
  function call(name, params, override = {}) {
    const handler = module.handlers['diagnostics.logs.' + name];
    handler.validate(params);
    return handler.run(params, { ...context, ...override });
  }
  function recent(limit = 1000) {
    const snapshot = call('snapshot', { limit });
    const chunks = Array.from({ length: snapshot.chunks }, (_, index) =>
      Buffer.from(call('chunk', { snapshotId: snapshot.snapshotId, index }).base64, 'base64'),
    );
    call('release', { snapshotId: snapshot.snapshotId });
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  return { ...module, state, agentId, context, events, call, recent };
}
function settingsValue(value) {
  const v = plain(value);
  delete v.directory;
  delete v.defaultDirectory;
  return v;
}

test('P0 logging controller settings retain validation persistence and errors with explicit revision conflicts', async (t) => {
  const dir = scratch(t),
    old = legacy(t, path.join(dir, 'old')),
    next = await current(t, path.join(dir, 'next'));
  assert.deepEqual(
    settingsValue(old.controller.settings()),
    settingsValue(next.call('settings').settings),
  );
  const initial = next.call('settings');
  const saved = next.call('saveSettings', { revision: initial.revision, settings });
  assert.notEqual(saved.revision, initial.revision);
  assert.deepEqual(settingsValue(old.controller.save(settings)), settingsValue(saved.settings));
  assert.equal(fs.existsSync(path.join(dir, 'old', 'logging.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'next', 'logging.json')), false);
  assert.deepEqual(next.state.document('logging-settings').read(), {
    revision: saved.revision,
    settings,
  });
  assert.throws(
    () => next.call('saveSettings', { revision: initial.revision, settings }),
    (e) => e.kind === 'conflict',
  );
  const invalid = [
    null,
    {},
    { ...settings, level: 'TRACE' },
    { ...settings, retentionDays: 0 },
    { ...settings, retentionDays: 366 },
    { ...settings, retentionDays: 1.5 },
    { ...settings, maxTotalMB: 19 },
    { ...settings, maxTotalMB: 10241 },
    { ...settings, customDirectory: 'relative' },
    { ...settings, customDirectory: 'a\0b' },
  ];
  for (const input of invalid) {
    assert.throws(
      () => old.controller.save(input),
      (e) => e instanceof old.BadRequestException,
    );
    assert.throws(
      () => next.call('saveSettings', { revision: saved.revision, settings: input }),
      (e) => e.kind === 'invalid-params',
    );
    assert.deepEqual(next.call('settings'), saved);
    assert.deepEqual(settingsValue(old.controller.settings()), settingsValue(saved.settings));
  }
  const oldFile = path.join(dir, 'old-file'),
    nextFile = path.join(dir, 'next-file');
  fs.writeFileSync(oldFile, 'keep-old');
  fs.writeFileSync(nextFile, 'keep-next');
  assert.throws(
    () => old.controller.save({ ...settings, customDirectory: oldFile }),
    (e) => e instanceof old.BadRequestException,
  );
  assert.throws(
    () =>
      next.call('saveSettings', {
        revision: saved.revision,
        settings: { ...settings, customDirectory: nextFile },
      }),
    (e) => e.kind === 'invalid-params',
  );
  assert.equal(fs.readFileSync(oldFile, 'utf8'), 'keep-old');
  assert.equal(fs.readFileSync(nextFile, 'utf8'), 'keep-next');
  const custom = path.join(dir, 'custom');
  old.controller.save({ ...settings, customDirectory: ' ' + custom + ' ' });
  const customSaved = next.call('saveSettings', {
    revision: saved.revision,
    settings: { ...settings, customDirectory: ' ' + custom + ' ' },
  });
  assert.deepEqual(settingsValue(old.controller.settings()), settingsValue(customSaved.settings));
  assert.equal(old.controller.settings().directory, custom);
  assert.equal(customSaved.settings.directory, custom);
  assert.equal(old.controller.settings().defaultDirectory, path.join(dir, 'old', 'logs'));
  assert.equal(customSaved.settings.defaultDirectory, path.join(dir, 'next', 'logs'));
  const reason = new Error('synthetic unexpected persistence failure');
  const original = old.store.update;
  old.store.update = () => {
    throw reason;
  };
  assert.throws(
    () => old.controller.save(settings),
    (e) => e === reason,
  );
  old.store.update = original;
  record('controller-settings-contract', {
    invalidInputs: invalid.length,
    conflict: true,
    normalizedDirectory: custom,
    nondirectoryBytesPreserved: true,
    unexpectedLegacyErrorIdentity: true,
    currentPersistence:
      'real SQLite document; restart independently checked by same-run diagnostics companion',
    metadata: old.metadata,
  });
});

test('P0 logging controller recent reads use bounded immutable releasable owner-local snapshots', async (t) => {
  const dir = scratch(t),
    old = legacy(t, path.join(dir, 'old')),
    next = await current(t, path.join(dir, 'next'));
  assert.deepEqual(plain(old.controller.recent()), []);
  assert.deepEqual(next.recent(), []);
  for (let i = 0; i < 4; i++) {
    old.store.write('ERROR', 'probe', 'record-' + i, { index: i });
    next.logs.write('ERROR', 'probe', 'record-' + i, { index: i });
  }
  assert.deepEqual(plain(old.controller.recent('2')).map(identity), next.recent(2).map(identity));
  assert.deepEqual(plain(old.controller.recent()).map(identity), next.recent().map(identity));
  for (const value of ['0', '-1', '1.5', 'no-number', undefined])
    assert.equal(old.controller.recent(value).length, 4, 'legacy defaults invalid string limit');
  assert.equal(old.controller.recent('5000').length, 4, 'legacy store clamps oversized query');
  for (const limit of [0, -1, 1.5, 1001, '2', null])
    assert.throws(
      () => next.call('snapshot', { limit }),
      (e) => e.kind === 'invalid-params',
    );
  const snapshot = next.call('snapshot', { limit: 2 });
  const args = { snapshotId: snapshot.snapshotId, index: 0 };
  const original = next.call('chunk', args);
  next.logs.write('ERROR', 'probe', 'later');
  assert.deepEqual(next.call('chunk', args), original);
  const other = await current(t, path.join(dir, 'other'));
  assert.throws(
    () => other.call('chunk', args),
    (e) => e.kind === 'not-found',
  );
  assert.throws(
    () => other.call('chunk', { ...args, agentId: next.agentId }),
    (e) => e.kind === 'invalid-params',
  );
  assert.throws(
    () => next.call('chunk', { ...args, index: 1 }),
    (e) => e.kind === 'invalid-params',
  );
  assert.deepEqual(next.call('release', { snapshotId: snapshot.snapshotId }), { released: true });
  assert.deepEqual(next.call('release', { snapshotId: snapshot.snapshotId }), { released: true });
  assert.throws(
    () => next.call('chunk', args),
    (e) => e.kind === 'not-found',
  );
  record('controller-recent-contract', {
    parityRecords: 4,
    parityLimit: 2,
    legacyInvalidLimit: 'default history',
    currentInvalidLimit: 'explicit invalid-params; integer 1..1000 only',
    immutable: true,
    released: true,
    crossKernelHandleRejected: true,
    scope: 'two real local SQLite owners; not an SSH transport claim',
  });
});

test('P0 logging controller client levels messages contexts and redaction match with strict RPC shape', async (t) => {
  const dir = scratch(t),
    old = legacy(t, path.join(dir, 'old')),
    next = await current(t, path.join(dir, 'next'));
  const cases = [
    ...['INFO', 'WARN', 'ERROR', 'DEBUG', 'unknown', null, undefined].map((level, i) => ({
      ...(level === undefined ? {} : { level }),
      message: 'level-' + i,
      context: { marker: i },
    })),
    { message: 'x'.repeat(2005), context: { password: 'fixture-private-value', safe: 'visible' } },
    ...[null, [], 'text', 42].map((context, i) => ({ message: 'context-' + i, context })),
  ];
  for (const body of cases) {
    old.controller.client(body);
    assert.deepEqual(next.call('client', body), { accepted: true });
  }
  const legacyRows = plain(old.controller.recent()).map(identity),
    rows = next.recent().map(identity);
  assert.deepEqual(rows, legacyRows);
  assert.deepEqual(
    rows.slice(0, 7).map((e) => e.level),
    ['INFO', 'WARN', 'ERROR', 'ERROR', 'ERROR', 'ERROR', 'ERROR'],
  );
  assert.equal(rows[7].message.length, 2000);
  assert.equal(rows[7].context.password, '[REDACTED]');
  assert.equal(rows[7].context.safe, 'visible');
  assert(rows.every((e) => e.source === 'web'));
  assert(rows.slice(8).every((e) => !Object.hasOwn(e, 'context')));
  for (const body of [null, undefined, {}, { message: '' }, { message: 42 }, { message: [] }]) {
    assert.throws(
      () => old.controller.client(body),
      (e) => e instanceof old.BadRequestException,
    );
    assert.throws(
      () => next.call('client', body),
      (e) => e.kind === 'invalid-params',
    );
  }
  assert.throws(
    () => next.call('client', { message: 'oversized', context: { x: 'x'.repeat(1024 * 1024) } }),
    (e) => e.kind === 'invalid-params',
  );
  assert.throws(
    () => next.call('client', { message: 'spoof', source: 'web' }),
    (e) => e.kind === 'invalid-params',
  );
  const remote = await current(t, path.join(dir, 'non-renderer'), false);
  remote.call('client', { message: 'non-renderer' });
  assert.equal(remote.recent()[0].source, 'client');
  assert.equal(next.recent().length, cases.length, 'invalid requests never write');
  old.store.flush();
  next.logs.flush();
  const disk = [path.join(dir, 'old', 'logs'), path.join(dir, 'next', 'logs')]
    .flatMap((d) =>
      fs
        .readdirSync(d)
        .filter((n) => n.endsWith('.log'))
        .map((n) => fs.readFileSync(path.join(d, n), 'utf8')),
    )
    .join('\n');
  assert.doesNotMatch(disk, /fixture-private-value/);
  record('controller-client-contract', {
    cases: cases.length,
    invalidInputs: 6,
    fallbackLevel: 'ERROR',
    limit: 2000,
    invalidContextOmitted: true,
    liveAndDiskSecretAbsent: true,
    source:
      'authenticated workspace context -> web; ordinary Agent session -> client; params cannot spoof',
    currentStrictShape: true,
    oversizedRejected: true,
  });
});

test('P0 logging controller flood rollover reports exact drops without extending the rate window', async (t) => {
  let now = 1700000000000;
  t.mock.method(Date, 'now', () => now);
  const dir = scratch(t),
    old = legacy(t, path.join(dir, 'old'), () => now),
    next = await current(t, path.join(dir, 'next'));
  for (let i = 0; i < 60; i++) {
    old.controller.client({ message: 'window-' + i });
    assert.equal(next.call('client', { message: 'window-' + i }).accepted, true);
  }
  for (let i = 0; i < 2; i++) {
    old.controller.client({ message: 'drop-' + i });
    assert.equal(next.call('client', { message: 'drop-' + i }).accepted, false);
  }
  now += 60000;
  old.controller.client({ message: 'boundary-drop' });
  assert.equal(next.call('client', { message: 'boundary-drop' }).accepted, false);
  now++;
  old.controller.client({ message: 'next-window' });
  assert.equal(next.call('client', { message: 'next-window' }).accepted, true);
  const rows = next.recent().map(identity);
  assert.deepEqual(plain(old.controller.recent()).map(identity), rows);
  assert.equal(rows.length, 62);
  assert.deepEqual(rows[60], {
    level: 'WARN',
    source: 'web',
    message: '前端日志过多，已丢弃 3 条',
  });
  assert.equal(rows[61].message, 'next-window');
  assert(rows.every((e) => !/drop|boundary/.test(e.message)));
  now += 60001;
  old.controller.client({ message: 'third-window' });
  next.call('client', { message: 'third-window' });
  assert.equal(next.recent().filter((e) => e.level === 'WARN').length, 1, 'drop counter resets');
  assert.equal(next.handlers['diagnostics.logs.client'].durable, false);
  record('controller-rate-contract', {
    firstWindowAccepted: 60,
    dropped: 3,
    exactBoundaryMs: 60000,
    rolloverMs: 60001,
    warningExactlyOnce: true,
    durable: false,
    clock: 'deterministic Date.now in this test process; no waiting or production clock injection',
  });
});

test('P0 logging controller cancellation rejects before side effects and preserves separate owners', async (t) => {
  const dir = scratch(t),
    next = await current(t, path.join(dir, 'one')),
    other = await current(t, path.join(dir, 'two'));
  const initial = next.call('settings');
  const stopped = new AbortController(),
    reason = new Error('fixture-cancelled');
  stopped.abort(reason);
  const calls = [
    ['settings', undefined],
    ['saveSettings', { revision: initial.revision, settings }],
    ['snapshot', { limit: 1 }],
    ['chunk', { snapshotId: 'fake', index: 0 }],
    ['release', { snapshotId: 'fake' }],
    ['client', { message: 'never-write' }],
  ];
  for (const [name, params] of calls)
    assert.throws(
      () => next.call(name, params, { signal: stopped.signal }),
      (e) => e === reason,
    );
  assert.deepEqual(next.call('settings'), initial);
  assert.deepEqual(next.recent(), []);
  assert.deepEqual(next.events, []);
  other.call('client', { message: 'other-owner' });
  next.close();
  other.call('client', { message: 'still-open' });
  assert.deepEqual(
    other.recent().map((e) => e.message),
    ['other-owner', 'still-open'],
  );
  record('controller-cancellation-contract', {
    cancelledMethods: calls.map(([n]) => n),
    originalReasonIdentity: true,
    settingsAndLogsUnchanged: true,
    noNotifications: true,
    closingOwnerDoesNotCloseOther: true,
    unknownWrites:
      'no mutation replay claimed; same-run task journal and stdio companion tests cover durable ambiguity separately',
  });
});

test('P0 logging controller successor is wired through real stdio RPC and durable settings restart', async (t) => {
  const dir = scratch(t),
    children = [];
  t.after(async () => {
    for (const child of children) await child.close();
  });
  async function start() {
    const child = spawnAgent(process.execPath, [path.join(__dirname, 'settings-fixture.cjs'), dir]);
    children.push(child);
    await child.client.initialize();
    return child;
  }
  const one = await start();
  const initial = await one.client.getLoggingSettings();
  const saved = await one.client.saveLoggingSettings(settings, initial.revision);
  await assert.rejects(
    one.client.saveLoggingSettings(settings, initial.revision),
    (e) => e.kind === 'conflict',
  );
  await one.client.request('diagnostics.logs.client', {
    message: 'stdio-controller-record',
    level: 'ERROR',
    context: { token: 'fixture-private-stdio' },
  });
  const rows = await one.client.recentLogs(10);
  const row = rows.find((e) => e.message === 'stdio-controller-record');
  assert(row);
  assert.equal(row.source, 'client');
  assert.equal(row.context.token, '[REDACTED]');
  const snapshot = await one.client.request('diagnostics.logs.snapshot', { limit: 1 });
  await one.close();
  const two = await start();
  assert.deepEqual(await two.client.getLoggingSettings(), saved);
  assert((await two.client.recentLogs(10)).some((e) => e.message === row.message));
  await assert.rejects(
    two.client.request('diagnostics.logs.chunk', { snapshotId: snapshot.snapshotId, index: 0 }),
    (e) => e.kind === 'not-found',
  );
  await assert.rejects(
    two.client.request('diagnostics.logs.client', { message: '' }),
    (e) => e.kind === 'invalid-params',
  );
  record('controller-stdio-integration', {
    transport: 'actual child process stdio',
    settingsRestart: true,
    staleRevisionRejected: true,
    persistedRedactedRecord: true,
    snapshotDoesNotSurviveSessionRestart: true,
    externalTraffic: false,
    osCredentials: false,
  });
});
