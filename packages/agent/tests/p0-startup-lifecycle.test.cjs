// Actual desktop source, HTTP and independent Agent; explicit Electron/migration doubles.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { MAX_FRAME_BYTES, PROTOCOL_VERSION } = require('@alune/protocol');
const {
  frozenBootstrap,
  desktop,
  request,
  peer,
  raw,
  record,
  digest,
  plain,
} = require('./startup-lifecycle-fixture.cjs');
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') return false;
    throw e;
  }
};

// These same tests run against preserved production bytes and the final implementation.
test('P0 lifecycle rolls back partial IPC registration and permits a fresh start', async (t) => {
  const failure = new Error('synthetic second registration failure'),
    handlers = new Map();
  const f = await desktop(t, { registrationError: failure, handlers });
  await assert.rejects(f.start(), (e) => e === failure);
  assert.equal(f.hosts.length, 1);
  assert.equal(alive(f.hosts[0].pid), false, 'Failed startup retained its Agent child');
  assert.equal(f.servers[0].listening, false);
  assert.equal(handlers.size, 0, 'Partial startup leaked an IPC handler');
  const retry = await desktop(t, { handlers }),
    service = await retry.start();
  assert.equal((await request(service.origin, retry.token, '/')).status, 200);
  await service.close();
});

test('P0 lifecycle reclaims the Agent when HTTP server construction throws', async (t) => {
  const failure = new Error('synthetic server construction failure');
  const f = await desktop(t, { createError: failure });
  await assert.rejects(f.start(), (e) => e === failure);
  assert.equal(f.hosts.length, 1);
  assert.equal(alive(f.hosts[0].pid), false, 'HTTP construction failure leaked the Agent child');
  assert.equal(f.handlers.size, 0);
});

test('P0 lifecycle close is shared and removes handlers channels sockets and writer lock', async (t) => {
  const f = await desktop(t),
    service = await f.start();
  const generation = await f.handlers.get('agent:open')(f.event(f.workspace));
  const client = peer(f, f.workspace, generation);
  await client.initialize();
  const owner = client.initialized.agentId;
  const socket = net.createConnection(new URL(service.origin).port, '127.0.0.1');
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const disconnected = new Promise((resolve) => socket.once('close', resolve));
  socket.write('GET / HTTP/1.1\r\n');
  const close = service.close(),
    concurrent = service.close();
  assert.strictEqual(close, concurrent, 'Concurrent shutdown must share one completion');
  await close;
  await disconnected;
  assert.equal(f.handlers.size, 0, 'Closed service retained IPC handlers');
  assert.equal(f.workspace.listenerCount('did-start-navigation'), 0);
  assert.equal(f.servers[0].listening, false);
  assert.equal(alive(f.hosts[0].pid), false);
  await assert.rejects(request(service.origin, f.token, '/'), { code: 'ECONNREFUSED' });
  await assert.rejects(client.request('agent.health'));
  await assert.rejects(f.hosts[0].open('workspace'), /closing/);
  // Reopen the same data directory and IPC registry; persisted identity must survive.
  const reopened = await f.start();
  const next = peer(f, f.workspace, await f.handlers.get('agent:open')(f.event(f.workspace)));
  await next.initialize();
  assert.equal(next.initialized.agentId, owner);
  next.close();
  await reopened.close();
});

test('P0 lifecycle preserves startup failures and releases real listen and migration failures', async (t) => {
  const migrationError = new Error('synthetic migration failure');
  const migration = await desktop(t, { migrationError });
  await assert.rejects(migration.start(), (e) => e === migrationError);
  assert.equal(migration.hosts.length, 0);
  assert.equal(migration.handlers.size, 0);
  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  const listen = await desktop(t, { listenPort: occupied.address().port });
  await assert.rejects(listen.start(), { code: 'EADDRINUSE' });
  assert.equal(listen.hosts.length, 1);
  assert.equal(alive(listen.hosts[0].pid), false);
  assert.equal(listen.handlers.size, 0);
  assert.equal(listen.servers[0].listening, false);
  const f = await desktop(t);
  const manifest = path.join(f.root, 'agent-runtime/manifest.json');
  fs.writeFileSync(
    manifest,
    JSON.stringify({ version: 'mismatched', target: process.platform + '-' + process.arch }),
  );
  await assert.rejects(f.start(), /版本或平台不匹配/);
  assert.deepEqual(f.effects, []);
  assert.equal(f.hosts.length, 0);
  assert(!fs.existsSync(path.join(f.root, 'data')));
});

// Whole frozen entry, including both parsers, static routing, diagnostics and failures.
test('P0-BOOTSTRAP-0143 complete startup responsibilities have explicit bounded lifecycle successors', async (t) => {
  const old = frozenBootstrap(),
    app = await old.startServer({ webRoot: '/synthetic-web', token: 'synthetic-bearer' });
  assert.deepEqual(plain(app.middleware[1]), [
    ['/repositories/:id/interactive-rebase', '/api/repositories/:id/interactive-rebase'],
    { parser: { limit: '1mb' } },
  ]);
  assert.deepEqual(plain(app.middleware[2]), [{ parser: 'default' }]);
  assert.deepEqual(plain(app.middleware[3]), [
    { static: [path.resolve('/synthetic-web'), { index: false }] },
  ]);
  const route = app.middleware[4][0];
  for (const [method, url, serves] of [
    ['GET', '/', true],
    ['GET', '/workspace/repo', true],
    ['GET', '/api', false],
    ['GET', '/api/repo', false],
    ['GET', '/socket.io', false],
    ['GET', '/assets/missing.js', false],
    ['POST', '/workspace', false],
    ['HEAD', '/', false],
    ['GET', '/socket.iota', false],
  ]) {
    const calls = [];
    route(
      { method, path: url },
      { set: (...a) => calls.push(['set', ...a]), sendFile: (...a) => calls.push(['file', ...a]) },
      () => calls.push(['next']),
    );
    assert.deepEqual(
      plain(calls),
      serves
        ? [
            ['set', 'Cache-Control', 'no-cache'],
            ['file', 'index.html', { root: path.resolve('/synthetic-web') }],
          ]
        : [['next']],
    );
  }
  assert.deepEqual(
    plain(old.calls.slice(0, 3)).map((c) => c[0]),
    ['registerSecret', 'logStore', 'create'],
  );
  assert.deepEqual(plain(old.calls.find((c) => c[0] === 'info')), [
    'info',
    'server',
    '本地服务已启动',
    { url: 'http://synthetic.invalid', mode: 'web' },
  ]);
  for (const fail of ['middleware', 'listen', 'url']) {
    const error = new Error('frozen ' + fail),
      f = frozenBootstrap({ fail, error });
    await assert.rejects(f.startServer({ webRoot: '/synthetic-web' }), (e) => e === error);
    assert.equal(f.apps[0].closed, true);
    assert.equal(f.calls.filter((c) => c[0] === 'close').length, 1);
    const diagnostic = f.calls.find((c) => c[0] === 'error');
    assert.equal(diagnostic[1], 'server');
    assert.equal(diagnostic[2], '本地服务启动失败');
    assert.strictEqual(diagnostic[3], error);
  }
  const f = await desktop(t),
    s = await f.start();
  assert.equal((await request(s.origin, f.token, '/')).status, 200);
  assert.equal(
    (await request(s.origin, f.token, '/not-an-asset')).body,
    '<html>batch08 shell</html>',
  );
  assert.equal((await request(s.origin, f.token, '/api/repositories')).status, 404);
  assert.equal((await request(s.origin, f.token, '/socket.io')).status, 404);
  assert.equal((await request(s.origin, f.token, '/assets/missing.js')).status, 404);
  assert.equal((await request(s.origin, f.token, '/', { method: 'POST' })).status, 405);
  assert.equal((await request(s.origin, f.token, '/', { method: 'HEAD' })).body, '');
  const gen = await f.handlers.get('agent:open')(f.event(f.workspace));
  const client = peer(f, f.workspace, gen);
  await client.initialize();
  // Multi-commit reword exceeds the old 100KiB parser while respecting each 32KiB message limit.
  const repo = path.join(f.root, 'repository');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trimEnd();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  const entries = [];
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'revision ' + i + '\n');
    git('add', '.');
    git('commit', '-qm', 'revision ' + i);
    const message = 'bounded reword ' + i + '\n\n' + 'escaped " \\ 中文🚀\n'.repeat(1100);
    assert(Buffer.byteLength(message) <= 32768);
    entries.push({ hash: git('rev-parse', 'HEAD'), action: 'reword', message });
  }
  const { resource } = await client.registerRepository(repo),
    preview = await client.readRepository(resource, 'previewRebase', { base });
  const intent = {
    resource,
    kind: 'startRebase',
    args: [{ base, token: preview.token, entries, acknowledgePublished: false }],
  };
  const bytes = Buffer.byteLength(JSON.stringify(intent));
  assert(bytes > 100 * 1024 && bytes < 1024 * 1024);
  const write = {
    ...intent,
    operationId: randomUUID(),
    revision: await client.prepareRepositoryWrite(intent),
  };
  await client.writeRepository(write);
  assert.equal(git('log', '-1', '--format=%B'), entries.at(-1).message.trimEnd());
  const commits = git('rev-list', '--reverse', base + '..HEAD').split('\n');
  assert.equal(commits.length, entries.length);
  for (let i = 0; i < commits.length; i++)
    assert.equal(git('show', '-s', '--format=%B', commits[i]), entries[i].message.trimEnd());
  const head = git('rev-parse', 'HEAD');
  assert.equal(git('rev-list', '--count', 'HEAD'), '6');
  await assert.rejects(client.writeRepository(write), { kind: 'duplicate-request' });
  // Former general HTTP JSON parser retired: RPC schema validation remains active for every method.
  await assert.rejects(client.request('agent.health', { unexpected: 'x'.repeat(200 * 1024) }), {
    kind: 'invalid-params',
  });
  const bad = await f.handlers.get('agent:open')(f.event(f.logs));
  const logClient = peer(f, f.logs, bad);
  await logClient.initialize();
  await s.client.request('desktop.log', {
    level: 'INFO',
    source: 'startup-fixture',
    message: 'bounded startup reached ready',
  });
  assert(
    (await logClient.recentLogs(10)).some((e) => e.message === 'bounded startup reached ready'),
  );
  // Execute exact source fragments of the owning desktop startup diagnostic,
  // with the real native client and log reader. This is not a whole-main pass.
  const mainSource = fs.readFileSync(
    path.resolve(__dirname, '../../../apps/desktop/src/main.cjs'),
    'utf8',
  );
  const mainAst = ts.createSourceFile('main.cjs', mainSource, ts.ScriptTarget.Latest, true);
  const appLog = mainAst.statements.find(
    (s) => ts.isFunctionDeclaration(s) && s.name.text === 'appLog',
  );
  const start = mainAst.statements.find(
    (s) => ts.isFunctionDeclaration(s) && s.name.text === 'start',
  );
  const startupLog = start.body.statements.find(
    (s) =>
      ts.isExpressionStatement(s) &&
      s.expression.getText(mainAst).startsWith("logger.info('app', 'Alune 启动'"),
  );
  assert(appLog && startupLog);
  const pending = [];
  const diagnosticContext = {
    backend: {
      client: {
        state: 'ready',
        request: (...args) => {
          const p = s.client.request(...plain(args));
          pending.push(p);
          return p;
        },
      },
    },
    app: { getVersion: () => require('../../../package.json').version, isPackaged: false },
    process: { platform: process.platform, arch: process.arch, versions: { electron: 'fixture' } },
  };
  vm.runInNewContext(
    appLog.getText(mainAst) + '\nconst {logger}=appLog();\n' + startupLog.getText(mainAst),
    diagnosticContext,
  );
  await Promise.all(pending);
  const entry = (await logClient.recentLogs(10)).find((e) => e.message === 'Alune 启动');
  assert(entry);
  assert.equal(entry.source, 'app');
  assert.equal(entry.context.version, require('../../../package.json').version);
  assert.equal(entry.context.electron, 'fixture');

  logClient.close();
  client.close();
  await s.close();
  await f.start();
  const next = peer(f, f.workspace, await f.handlers.get('agent:open')(f.event(f.workspace)));
  await next.initialize();
  assert.equal((await next.getTask({ taskId: write.operationId })).task.state, 'succeeded');
  await assert.rejects(next.writeRepository(write), { kind: 'duplicate-request' });
  assert.equal(git('rev-parse', 'HEAD'), head);
  next.close();
  record('startup-responsibilities.json', {
    frozenSha256: digest(old.source),
    scopes: { source: 'P0-BOOTSTRAP-0141', entry: 'P0-BOOTSTRAP-0143' },
    frozenTopLevelStatements: old.inventory,
    mapping: {
      nest: 'Nest container/Express/Socket.IO retired; actual superviseUiAgent+private IPC/typed kernel used, option/auth regressions re-executed separately.',
      budgets: {
        legacySpecial: '1mb only on both interactive-rebase paths',
        legacyDefault: 'Express default JSON for other routes',
        successor:
          '8MiB UTF-8 frame budget for all RPCs, bounded per-method schema/in-flight budgets and 64KiB stream chunks; deliberate replacement rather than old HTTP body-limit equivalence',
        actualRebaseIntentBytes: bytes,
      },
      static:
        'Frozen static+fallback middleware exercised; successor actual HTTP confirms static/SPA/method/retired-path boundaries, cache/Host/bearer/symlink checks bound in companion tests.',
      lifecycle:
        'Construction, failed listen, failed IPC registration, normal/concurrent close, child/writer release and same IPC/data-directory restart directly tested.',
      diagnostics:
        'Frozen start/failure log arguments asserted. Actual native desktop.log -> logs session verified. Exact desktop main startup log fragments are run against the real native/logs clients with VM arguments normalized through JSON. Whole main startup rejection is surfaced through captured stderr/dialog/exit in an explicit Electron double. Global exception hooks remain distinct 0460/main responsibilities and are not counted here.',
    },
    releaseEligible: false,
  });
});

test(
  'P0-BOOTSTRAP-0141 complete startup source rejects malformed and oversized frames without losing its host',
  { timeout: 60000 },
  async (t) => {
    const f = await desktop(t),
      s = await f.start();
    for (const value of [
      '{broken',
      JSON.stringify({ jsonrpc: '1.0', id: 'batch08:1', method: 'initialize' }),
      '界'.repeat(Math.floor(MAX_FRAME_BYTES / 3) + 1),
    ]) {
      const c = f.workspace,
        gen = await f.handlers.get('agent:open')(f.event(c));
      const ended = new Promise((resolve) => {
        const listener = (type, g) => {
          if (type === 'agent:end' && g === gen) {
            c.off('sent', listener);
            resolve();
          }
        };
        c.on('sent', listener);
      });
      // Host-side oversized packets reject; malformed protocol reaches Agent and ends only that channel.
      if (Buffer.byteLength(value) > MAX_FRAME_BYTES) {
        await assert.rejects(
          f.handlers.get('agent:frame')(f.event(c), gen, value),
          /Invalid or closed/,
        );
        f.handlers.get('agent:close')(f.event(c), gen);
      } else {
        await f.handlers.get('agent:frame')(f.event(c), gen, value);
        await ended;
      }
      const reopened = await f.handlers.get('agent:open')(f.event(c)),
        client = peer(f, c, reopened);
      await client.initialize();
      assert.equal((await client.request('agent.health')).status, 'ok');
      client.close();
    }
    // UTF-8 exact limit is accepted by parent framing and reaches schema validation, limit+1 is refused.
    const gen = await f.handlers.get('agent:open')(f.event(f.workspace));
    await raw(f, f.workspace, gen, 'initialize', {
      protocol: PROTOCOL_VERSION,
      client: { name: 'byte-budget', version: '1' },
    });
    const base = JSON.stringify({
      jsonrpc: '2.0',
      id: 'batch08:2',
      method: 'agent.health',
      params: { padding: '' },
    });
    const room = MAX_FRAME_BYTES - Buffer.byteLength(base),
      text = '界'.repeat(Math.floor(room / 3)) + 'x'.repeat(room % 3);
    const frame = JSON.stringify({
      jsonrpc: '2.0',
      id: 'batch08:2',
      method: 'agent.health',
      params: { padding: text },
    });
    assert.equal(Buffer.byteLength(frame), MAX_FRAME_BYTES);
    const reply = new Promise((resolve) => {
      const read = (type, g, value) => {
        if (type === 'agent:frame' && g === gen) {
          const r = JSON.parse(value);
          if (r.id === 'batch08:2') {
            f.workspace.off('sent', read);
            resolve(r);
          }
        }
      };
      f.workspace.on('sent', read);
    });
    assert.equal(await f.handlers.get('agent:frame')(f.event(f.workspace), gen, frame), true);
    assert.equal((await reply).error.data.kind, 'invalid-params');
    await assert.rejects(
      f.handlers.get('agent:frame')(f.event(f.workspace), gen, frame + ' '),
      /Invalid or closed/,
    );
    f.handlers.get('agent:close')(f.event(f.workspace), gen);
    assert(alive(f.hosts[0].pid));
    record('frame-budgets.json', {
      maxFrameBytes: MAX_FRAME_BYTES,
      exactUtf8BoundaryReachedSchema: true,
      overBoundaryRejected: true,
      malformedSessionIsolated: true,
      releaseEligible: false,
    });
  },
);

test('P0 lifecycle cleanup failures retain the original startup error and still release the Agent', async (t) => {
  const startError = new Error('synthetic registration failure'),
    removeError = new Error('synthetic removal failure');
  const f = await desktop(t, { registrationError: startError, removeError });
  await assert.rejects(f.start(), (error) => {
    assert(error instanceof AggregateError);
    assert.strictEqual(error.cause, startError);
    assert.strictEqual(error.errors[0], startError);
    assert(error.errors[1] instanceof AggregateError);
    assert.strictEqual(error.errors[1].errors[0], removeError);
    return true;
  });
  assert.equal(alive(f.hosts[0].pid), false);
  assert.equal(f.servers[0].listening, false);
  assert.equal(f.handlers.size, 0);
});

test('P0 lifecycle proxy cleanup errors still release channels HTTP handlers and the Agent', async (t) => {
  const failure = new Error('synthetic proxy destroy failure');
  let destroyed = 0;
  const f = await desktop(t, {
    bridge: { enabled: true, port: 1 },
    undici: {
      ProxyAgent: class {
        constructor(url) {
          assert.equal(url, 'http://127.0.0.1:1');
        }
        async destroy() {
          destroyed++;
          throw failure;
        }
      },
      fetch: async (_url, init) => {
        assert(init.dispatcher);
        return { status: 204 };
      },
    },
  });
  const s = await f.start();
  assert.equal((await s.networkProxy.fetch('https://fixture.invalid')).status, 204);
  await assert.rejects(s.close(), (error) => {
    assert(error instanceof AggregateError);
    assert.strictEqual(error.errors[0], failure);
    return true;
  });
  assert.equal(destroyed, 1);
  assert.equal(alive(f.hosts[0].pid), false);
  assert.equal(f.servers[0].listening, false);
  assert.equal(f.handlers.size, 0);
});

test('P0 lifecycle ordinary desktop surfaces startup rejection to stderr dialog and failure exit', async () => {
  const failure = new Error('synthetic independent runtime startup refusal'),
    calls = [];
  const app = {
    setName() {},
    setPath() {},
    getPath: () => '/isolated/Alune',
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    on() {},
    dock: { setIcon() {} },
    exit: (code) => calls.push(['exit', code]),
  };
  const directory = path.resolve(__dirname, '../../../apps/desktop/src');
  vm.runInNewContext(fs.readFileSync(path.join(directory, 'main.cjs'), 'utf8'), {
    __dirname: directory,
    console: { error: (error) => calls.push(['stderr', error]) },
    process: { env: {}, argv: ['electron', 'dist/app'], platform: 'linux', on() {} },
    require(name) {
      if (name === 'electron')
        return { app, dialog: { showErrorBox: (...args) => calls.push(['dialog', ...args]) } };
      if (name === 'node:crypto' || name === 'node:path') return require(name);
      if (name === 'node:fs') return { mkdirSync() {} };
      if (name === './workspace-preferences.cjs' || name === './external-links.cjs') return {};
      if (name === './log-window.cjs') return { createLogWindow: () => ({ contents() {} }) };
      if (name === './desktop-agent.cjs')
        return {
          startDesktopAgent: async () => {
            throw failure;
          },
        };
      throw Error('Unreviewed main failure dependency: ' + name);
    },
  });
  await new Promise(setImmediate);
  assert.deepEqual(calls, [
    ['stderr', failure],
    ['dialog', 'Alune 启动失败', failure.message],
    ['exit', 1],
  ]);
});
