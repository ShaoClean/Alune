// Whole frozen controller and production successor. Recording ports are explicit doubles.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const { ProtocolError } = require('@alune/protocol');
const { proxyTest } = require('../dist/bootstrap/proxy-test');
const { snapshotHandler } = require('../dist/modules/hosts/snapshot');
const { openStateKernel } = require('../dist/bootstrap/state-kernel');
const { GitProxyError } = require('../dist/adapters/ssh/proxy-git');
const { ProxyTransportError } = require('../dist/adapters/network/proxy-transport');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const file = 'apps/server/src/proxy/proxy.controller.ts';
const plain = (v) => JSON.parse(JSON.stringify(v));
function proof(name, value) {
  if (process.env.P0_PROXY_CONTROLLER_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_PROXY_CONTROLLER_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
class HttpException extends Error {}
class BadRequestException extends HttpException {}
function frozen(options = {}) {
  const source = fs.readFileSync(path.join(process.env.P0_PROXY_CONTROLLER_FROZEN, file), 'utf8');
  assert.equal(
    source,
    execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }),
  );
  const calls = [],
    decorators = [],
    res = new EventEmitter();
  let revision = 'r1',
    enabled = true,
    releases = 0;
  const settings = {
    read() {
      calls.push(['read']);
      return { revision, enabled };
    },
    save(input) {
      calls.push(['save', input]);
      return input;
    },
    assertRevision(value) {
      calls.push(['revision', value]);
      if (value !== revision) throw new HttpException('stale revision');
    },
  };
  const conn = {
    proxyRevision: 'r1',
    holdTask() {
      calls.push(['hold']);
      return () => {
        releases++;
        calls.push(['release']);
      };
    },
    async prepareGitProxy() {
      calls.push(['prepare']);
      if (options.prepareError) throw options.prepareError;
    },
    async execGit(...args) {
      calls.push(['execGit', ...args]);
      if (options.execError) throw options.execError;
      return { exitCode: options.exitCode ?? 0 };
    },
  };
  const proxy = {
    settings,
    async fetch(...args) {
      calls.push(['fetch', ...args]);
      if (options.fetch) return options.fetch(...args);
      return {
        ok: true,
        body: {
          async cancel() {
            calls.push(['cancelBody']);
          },
        },
      };
    },
  };
  const statuses = Object.freeze([{ id: 'host', revision: 'r1' }]);
  const connections = {
    proxyStatuses() {
      calls.push(['statuses']);
      return statuses;
    },
    reconnectProxy(...args) {
      calls.push(['reconnect', ...args]);
      return statuses;
    },
    async testSavedProxy(...args) {
      calls.push(['testSaved', ...args]);
      if (options.ssh) await options.ssh(...args);
    },
    async ensureConnected(id) {
      calls.push(['connect', id]);
      if (options.connectError) throw options.connectError;
      return conn;
    },
  };
  const repo = { path: '/synthetic/repo', source: 'ssh', connectionId: 'host' };
  const repositories = {
    async get(id) {
      calls.push(['repo', id]);
      if (options.repoError) throw options.repoError;
      return repo;
    },
  };
  const decorate =
    (name) =>
    (...args) =>
    (target, key, index) => {
      decorators.push({
        name,
        args: args.map((a) => (typeof a === 'function' ? a.name : a)),
        key,
        index,
      });
    };
  const deps = {
    '@nestjs/common': {
      HttpException,
      BadRequestException,
      ...Object.fromEntries(
        ['Body', 'Controller', 'Get', 'Param', 'Post', 'Put', 'Req'].map((n) => [n, decorate(n)]),
      ),
      ParseUUIDPipe: class ParseUUIDPipe {},
    },
    '@alune/ssh-client': {
      GitProxyError,
      ProxyTransportError,
      GitCommands: class {
        constructor(c) {
          assert.equal(c, conn);
        }
        async remoteList(...args) {
          calls.push(['remoteList', ...args]);
          if (options.remoteError) throw options.remoteError;
          return (
            options.remotes ?? [
              { fetchUrl: 'https://git.fixture/repo', pushUrl: 'ssh://git.fixture/repo' },
            ]
          );
        }
      },
    },
    '../connection/connection.service': {},
    '../repository/repository.service': {},
    './proxy.service': {},
  };
  const module = { exports: {} };
  const deadline = options.deadline ?? new AbortController();
  const timeoutDurations = [];
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
      Error,
      URL,
      AbortController,
      performance,
      AbortSignal: {
        any: AbortSignal.any.bind(AbortSignal),
        timeout(ms) {
          timeoutDurations.push(ms);
          return deadline.signal;
        },
      },
      require(id) {
        assert(Object.hasOwn(deps, id), 'Unreviewed dependency: ' + id);
        return deps[id];
      },
    },
    { filename: file },
  );
  const instance = new module.exports.ProxyController(proxy, connections, repositories);
  return {
    instance,
    source,
    calls,
    decorators,
    statuses,
    res,
    conn,
    repo,
    settings,
    releases: () => releases,
    timeoutDurations,
    deadline,
    changeRevision: (v) => {
      revision = v;
    },
    disable: () => {
      enabled = false;
    },
    run: (input = {}) =>
      instance.test(
        { revision: 'r1', kind: 'http', url: 'https://target.fixture/path', ...input },
        { res },
      ),
  };
}
function checkResult(result, success) {
  assert.deepEqual(Object.keys(result).sort(), ['elapsedMs', 'message', 'revision', 'success']);
  assert.equal(result.revision, 'r1');
  assert.equal(result.success, success);
  assert(Number.isInteger(result.elapsedMs) && result.elapsedMs >= 0);
}
function current(options = {}) {
  const calls = [],
    agentId = randomUUID(),
    sessionId = randomUUID();
  let revision = 'r1',
    enabled = true;
  const settings = {
    proxy: {
      assertRevision(r) {
        calls.push(['revision', r]);
        if (r !== revision) throw new ProtocolError('conflict', 'stale revision');
      },
      read() {
        calls.push(['read']);
        return { enabled, revision };
      },
    },
    async readyCredentials(signal) {
      calls.push(['credentials', signal]);
      signal.throwIfAborted();
      if (options.credentialError) throw options.credentialError;
    },
  };
  const network = {
    async fetch(...args) {
      calls.push(['fetch', ...args]);
      if (options.fetch) return options.fetch(...args);
      return {
        ok: true,
        body: {
          async cancel() {
            calls.push(['cancelBody']);
          },
        },
      };
    },
  };
  const hosts = {
    async probeAuthentication(...args) {
      calls.push(['probe', ...args]);
      if (options.ssh) await options.ssh(...args);
    },
    async testProxy(...args) {
      calls.push(['testProxy', ...args]);
      if (options.git) await options.git(...args);
    },
  };
  const resource = { agentId: randomUUID(), resourceId: randomUUID() };
  const catalog = {
    get(ref, local) {
      calls.push(['get', ref, local]);
      if (options.repoError) throw options.repoError;
      return { id: 'repo', connectionId: options.otherHost ? 'other' : 'host' };
    },
    hostBinding(id) {
      calls.push(['binding', id]);
      return options.unbound ? undefined : { resource };
    },
  };
  const ctx = {
    agentId,
    sessionId,
    taskId: randomUUID(),
    signal: new AbortController().signal,
    sessionSignal: new AbortController().signal,
    events: {
      notifyState() {
        throw Error('query must not emit mutation');
      },
    },
  };
  const handler = proxyTest(settings, network, hosts, catalog);
  return {
    handler,
    calls,
    ctx,
    resource,
    changeRevision(v) {
      revision = v;
    },
    disable() {
      enabled = false;
    },
    async run(input = {}, context = ctx) {
      const p = { revision: 'r1', kind: 'http', url: 'https://target.fixture/path', ...input };
      handler.validate(p);
      return handler.run(p, context);
    },
  };
}

test('P0 proxy controller entire frozen source decorators and four delegations preserve exact arguments and errors', async () => {
  const f = frozen(),
    ast = ts.createSourceFile(file, f.source, ts.ScriptTarget.Latest, true);
  assert.deepEqual(
    ast.statements.filter(ts.isImportDeclaration).map((n) => n.moduleSpecifier.text),
    [
      '@nestjs/common',
      'express',
      '@alune/ssh-client',
      '@alune/shared',
      '../connection/connection.service',
      '../repository/repository.service',
      './proxy.service',
    ],
  );
  const declarations = ast.statements.filter((n) => !ts.isImportDeclaration(n));
  assert.equal(declarations.length, 1);
  assert(ts.isClassDeclaration(declarations[0]));
  assert.deepEqual(
    declarations[0].members.map((n) => n.name?.getText(ast) ?? 'constructor'),
    ['constructor', 'settings', 'save', 'statuses', 'reconnect', 'test'],
  );
  assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(f.instance)), [
    'constructor',
    'settings',
    'save',
    'statuses',
    'reconnect',
    'test',
  ]);
  for (const d of f.decorators)
    if (d.index && typeof d.index === 'object') assert.equal(d.index.value, f.instance[d.key]);
  assert.deepEqual(
    plain(f.decorators),
    plain([
      {
        name: 'Get',
        args: [],
        key: 'settings',
        index: {
          value: f.instance.settings,
          writable: true,
          enumerable: false,
          configurable: true,
        },
      },
      { name: 'Body', args: [], key: 'save', index: 0 },
      {
        name: 'Put',
        args: [],
        key: 'save',
        index: { value: f.instance.save, writable: true, enumerable: false, configurable: true },
      },
      {
        name: 'Get',
        args: ['connections'],
        key: 'statuses',
        index: {
          value: f.instance.statuses,
          writable: true,
          enumerable: false,
          configurable: true,
        },
      },
      { name: 'Body', args: [], key: 'reconnect', index: 1 },
      { name: 'Param', args: ['id', 'ParseUUIDPipe'], key: 'reconnect', index: 0 },
      {
        name: 'Post',
        args: ['connections/:id/reconnect'],
        key: 'reconnect',
        index: {
          value: f.instance.reconnect,
          writable: true,
          enumerable: false,
          configurable: true,
        },
      },
      { name: 'Req', args: [], key: 'test', index: 1 },
      { name: 'Body', args: [], key: 'test', index: 0 },
      {
        name: 'Post',
        args: ['test'],
        key: 'test',
        index: { value: f.instance.test, writable: true, enumerable: false, configurable: true },
      },
      { name: 'Controller', args: ['network-proxy'], key: undefined, index: undefined },
    ]),
  );
  const input = Object.freeze({ revision: 'r1', credentials: { action: 'keep' } });
  assert.deepEqual(plain(f.instance.settings()), { revision: 'r1', enabled: true });
  assert.equal(f.instance.save(input), input);
  assert.equal(f.instance.statuses(), f.statuses);
  assert.equal(f.instance.reconnect('host', { revision: 'r1' }), f.statuses);
  assert.equal(f.instance.reconnect('host', undefined), f.statuses);
  assert.deepEqual(
    f.calls.map((c) => c.slice(0, 3)),
    [
      ['read'],
      ['save', input],
      ['statuses'],
      ['reconnect', 'host', 'r1'],
      ['reconnect', 'host', undefined],
    ],
  );
  for (const [name, dependency] of [
    ['settings', 'read'],
    ['save', 'save'],
  ]) {
    const marker = Error('synthetic delegation failure');
    f.settings[dependency] = () => {
      throw marker;
    };
    assert.throws(
      () => f.instance[name](input),
      (e) => e === marker,
    );
  }
  proof('proxy-controller-inventory', {
    imports: 7,
    classMembers: ['constructor', 'settings', 'save', 'statuses', 'reconnect', 'test'],
    decorators: f.decorators.map(({ name, args, key, index }) => ({
      name,
      args,
      key,
      parameter: typeof index === 'number' ? index : undefined,
    })),
    delegationArgumentsAndIdentity: true,
    boundary:
      'Nest decorator/connection/repository/settings ports are recording doubles. No Nest server or pipe execution claimed.',
  });
});

test('P0 proxy controller HTTP full validation response cleanup revision fencing and safe failure categories execute', async () => {
  const rows = [];
  for (const url of [
    undefined,
    null,
    1,
    '',
    'broken',
    'ftp://target/path',
    'http://user:pass@target/',
    'https://user@target/',
    'http://target/' + 'x'.repeat(2048),
  ]) {
    const f = frozen(),
      r = await f.run({ url });
    checkResult(r, false);
    assert.match(r.message, /HTTP\(S\) URL/);
    assert.equal(f.calls.filter((c) => c[0] === 'fetch').length, 0);
    assert.equal(f.res.listenerCount('close'), 0);
    rows.push({ urlKind: typeof url, success: r.success });
  }
  for (const url of [
    'http://target.fixture/',
    'https://target.fixture/' + 'x'.repeat(2048 - 'https://target.fixture/'.length),
  ]) {
    const f = frozen(),
      r = await f.run({ url });
    checkResult(r, true);
    const [, target, init] = f.calls.find((c) => c[0] === 'fetch');
    assert.equal(target.href, url);
    assert.deepEqual(Object.keys(init).sort(), ['method', 'redirect', 'signal']);
    assert.equal(init.method, 'HEAD');
    assert.equal(init.redirect, 'error');
    assert.equal(init.signal.aborted, false);
    assert.equal(f.calls.filter((c) => c[0] === 'cancelBody').length, 1);
    assert.deepEqual(
      f.calls.filter((c) => c[0] === 'revision'),
      [
        ['revision', 'r1'],
        ['revision', 'r1'],
      ],
    );
    assert.deepEqual(f.timeoutDurations, [30000]);
    assert.equal(f.res.listenerCount('close'), 0);
  }
  for (const response of [
    { ok: true },
    { ok: false, status: 403 },
    {
      ok: true,
      body: {
        cancel() {
          throw Error('synthetic-private');
        },
      },
    },
  ]) {
    const f = frozen({ fetch: () => response }),
      r = await f.run();
    checkResult(r, response.ok && !response.body);
    if (!response.ok) assert.match(r.message, /HTTP 403/);
    assert.doesNotMatch(r.message, /synthetic-private/);
    assert.equal(f.res.listenerCount('close'), 0);
  }
  const stale = frozen();
  stale.changeRevision('r2');
  await assert.rejects(stale.run(), /stale revision/);
  assert.equal(stale.res.listenerCount('close'), 0);
  const changed = frozen({
    fetch: () => {
      changed.changeRevision('r2');
      return { ok: true };
    },
  });
  await assert.rejects(changed.run(), /stale revision/);
  assert.equal(changed.res.listenerCount('close'), 0);
  const disabled = frozen();
  disabled.disable();
  await assert.rejects(disabled.run(), /启用代理/);
  await assert.rejects(frozen().run({ kind: 'wrong' }), /无效的测试类型/);
  const noRes = frozen();
  checkResult(
    await noRes.instance.test({ revision: 'r1', kind: 'http', url: 'http://target/' }, {}),
    true,
  );
  proof('proxy-controller-http', {
    invalidUrls: rows.length,
    successSchemes: ['http', 'https'],
    maxLength: 2048,
    method: 'HEAD',
    redirect: 'error',
    bodyCancelled: true,
    optionalBodyAndResponse: true,
    revisionFencedBeforeAndAfter: true,
    disabledAndInvalidKindRejectBeforeListen: true,
    noLiveNetwork: true,
  });
});

test('P0 proxy controller SSH cancellation deadline error causes and all listener cleanup branches execute', async () => {
  const ok = frozen(),
    r = await ok.run({ kind: 'ssh', connectionId: 'host' });
  checkResult(r, true);
  assert.match(r.message, /身份认证/);
  assert.equal(ok.calls.find((c) => c[0] === 'testSaved')[1], 'host');
  const missing = frozen();
  checkResult(await missing.run({ kind: 'ssh' }), false);
  assert.equal(missing.calls.filter((c) => c[0] === 'testSaved').length, 0);
  const rows = [];
  for (const [kind, error, expected] of [
    ['http', new HttpException('safe-http'), 'safe-http'],
    ['http', new GitProxyError('safe-git'), 'safe-git'],
    [
      'http',
      new ProxyTransportError('PROXY_AUTH_FAILED'),
      new ProxyTransportError('PROXY_AUTH_FAILED').message,
    ],
    [
      'http',
      Error('synthetic-private', { cause: new ProxyTransportError('PROXY_TLS_FAILED') }),
      new ProxyTransportError('PROXY_TLS_FAILED').message,
    ],
    ['http', Error('synthetic-private', { cause: Error('synthetic-private-cause') }), '连接失败'],
    ['ssh', Error('synthetic-private'), 'SSH 连接失败'],
    ['ssh', 'synthetic-private', 'SSH 连接失败'],
  ]) {
    const f = frozen({
      fetch() {
        throw error;
      },
      ssh() {
        throw error;
      },
    });
    const result = await f.run({ kind, connectionId: 'host' });
    checkResult(result, false);
    assert(result.message.includes(expected));
    assert.doesNotMatch(result.message, /synthetic-private/);
    assert.equal(f.res.listenerCount('close'), 0);
    rows.push({ kind, message: result.message });
  }
  for (const deadline of [false, true]) {
    const f = frozen({
      ssh: async (_id, signal) => {
        if (deadline) f.deadline.abort();
        else f.res.emit('close');
        assert(signal.aborted); // Deliberately return normally: trailing throwIfAborted must prevent success.
      },
    });
    const result = await f.run({ kind: 'ssh', connectionId: 'host' });
    checkResult(result, false);
    assert.match(result.message, /取消或超时/);
    assert.equal(f.res.listenerCount('close'), 0);
  }
  proof('proxy-controller-errors-cancel', {
    rows,
    requestCloseCancels: true,
    controlledDeadlineMs: 30000,
    cancellationAfterPortSuccessStillFails: true,
    listenersRemoved: true,
    boundary:
      'Deadline is controlled AbortSignal injection, not 30 seconds wall time. Arbitrary typed HttpException messages are trusted legacy port messages; only raw unexpected failures are redacted.',
  });
});

test('P0 proxy controller Git every ownership forwarding remote URL and task release responsibility executes', async () => {
  const remotes = [
    { fetchUrl: 'https://git.fixture/r', pushUrl: 'ssh://git.fixture/r' },
    { fetchUrl: 'https://git.fixture/r', pushUrl: 'git@git.fixture:r' },
    { fetchUrl: '', pushUrl: 'http://git.fixture/r' },
  ];
  const f = frozen({ remotes }),
    result = await f.run({ kind: 'git', connectionId: 'host', repositoryId: 'repo' });
  checkResult(result, true);
  assert.match(result.message, /4 个地址/);
  assert.equal(f.releases(), 1);
  const execs = f.calls.filter((c) => c[0] === 'execGit');
  assert.equal(execs.length, 4);
  for (const [index, c] of execs.entries()) {
    assert.equal(c[1], f.repo.path);
    assert.deepEqual(plain(c[2]), [
      'ls-remote',
      '--heads',
      '--',
      [...new Set(remotes.flatMap((r) => [r.fetchUrl, r.pushUrl]).filter(Boolean))][index],
    ]);
    assert.equal(c[3], f.calls.find((c) => c[0] === 'remoteList')[2]);
    assert.deepEqual(plain(c[4]), { maxOutputBytes: 1024 * 1024 });
  }
  assert.deepEqual(
    f.calls
      .filter((c) => ['hold', 'prepare', 'remoteList', 'execGit', 'release'].includes(c[0]))
      .map((c) => c[0]),
    ['hold', 'prepare', 'remoteList', 'execGit', 'execGit', 'execGit', 'execGit', 'release'],
  );
  const rows = [];
  const cases = [
    ['missing connection', {}, { connectionId: undefined }, null, 0],
    ['missing repository', {}, { repositoryId: undefined }, null, 0],
    [
      'local repository',
      {},
      {},
      (x) => {
        x.repo.source = 'local';
      },
      0,
    ],
    [
      'other host',
      {},
      {},
      (x) => {
        x.repo.connectionId = 'peer';
      },
      0,
    ],
    ['repository lookup failure', { repoError: Error('private') }, {}, null, 0],
    ['connection failure', { connectError: Error('private') }, {}, null, 0],
    [
      'stale connection',
      {},
      {},
      (x) => {
        x.conn.proxyRevision = 'r0';
      },
      0,
    ],
    ['prepare failure', { prepareError: new GitProxyError('safe preparation') }, {}, null, 1],
    ['remote list failure', { remoteError: Error('private') }, {}, null, 1],
    ['empty remotes', { remotes: [] }, {}, null, 1],
    [
      'too many URLs',
      { remotes: Array.from({ length: 21 }, (_, i) => ({ fetchUrl: 'https://git.fixture/' + i })) },
      {},
      null,
      1,
    ],
    ['file URL', { remotes: [{ fetchUrl: 'file:///private/repo' }] }, {}, null, 1],
    ['ext command', { remotes: [{ fetchUrl: 'ext::arbitrary' }] }, {}, null, 1],
    ['Git exit failure', { exitCode: 128 }, {}, null, 1],
    ['Git rejection', { execError: Error('private') }, {}, null, 1],
  ];
  for (const [label, options, input, alter, releases] of cases) {
    const h = frozen(options);
    alter?.(h);
    const r = await h.run({ kind: 'git', connectionId: 'host', repositoryId: 'repo', ...input });
    checkResult(r, false);
    assert.equal(h.releases(), releases, label);
    assert.equal(h.res.listenerCount('close'), 0);
    if (['too many URLs', 'file URL', 'ext command'].includes(label))
      assert.equal(h.calls.filter((c) => c[0] === 'execGit').length, 0);
    rows.push({ label, success: r.success, releases });
  }
  const max = frozen({
    remotes: Array.from({ length: 20 }, (_, i) => ({ fetchUrl: 'https://git.fixture/' + i })),
  });
  checkResult(await max.run({ kind: 'git', connectionId: 'host', repositoryId: 'repo' }), true);
  assert.equal(max.calls.filter((c) => c[0] === 'execGit').length, 20);
  const emptyUrls = frozen({ remotes: [{ fetchUrl: '', pushUrl: '' }] });
  const emptyResult = await emptyUrls.run({
    kind: 'git',
    connectionId: 'host',
    repositoryId: 'repo',
  });
  checkResult(emptyResult, true);
  assert.match(emptyResult.message, /0 个地址/);
  const lateInvalid = frozen({
    remotes: [{ fetchUrl: 'https://git.fixture/r', pushUrl: 'file:///private/path' }],
  });
  checkResult(
    await lateInvalid.run({ kind: 'git', connectionId: 'host', repositoryId: 'repo' }),
    false,
  );
  assert.equal(lateInvalid.calls.filter((c) => c[0] === 'execGit').length, 1);
  proof('proxy-controller-git', {
    distinctReadOnlyURLs: 4,
    rows,
    acceptedMaximum: 20,
    exactArgumentsOutputLimitSignal: true,
    releaseExactlyOnceAfterHold: true,
    legacyGap:
      'Nonempty remotes with no usable URLs reports success for zero URLs; successor snapshot rejects zero URLs. Legacy sequential validation may execute earlier allowed URLs before a later unsupported URL; successor validates entire set before execution.',
    boundary:
      'GitCommands, connection and repository ports are recording doubles; actual Git/SSH transports run in same-replay companion tests.',
  });
});

test('P0 proxy controller successor validates kind without coercion routes owner resources and fences revisions', async () => {
  const h = current();
  assert.equal(h.handler.effect, 'query');
  assert.equal(h.handler.minimumProtocolMinor, 6);
  for (const p of [
    undefined,
    null,
    [],
    {},
    { revision: 1, kind: 'http' },
    { revision: 'r1', kind: ['http'] },
    { revision: 'r1', kind: ['ssh'] },
    { revision: 'r1', kind: ['git'] },
    { revision: 'r1', kind: {} },
    { revision: 'r1', kind: 'wrong' },
  ])
    assert.throws(
      () => h.handler.validate(p),
      (e) => e.kind === 'invalid-params',
    );
  assert.deepEqual(h.calls, []);
  const http = await h.run();
  checkResult(http, true);
  const [, target, init] = h.calls.find((c) => c[0] === 'fetch');
  assert.equal(target.href, 'https://target.fixture/path');
  assert.equal(init.method, 'HEAD');
  assert.equal(init.redirect, 'error');
  assert(
    h.calls.findIndex((c) => c[0] === 'credentials') < h.calls.findIndex((c) => c[0] === 'fetch'),
  );
  assert.equal(h.calls.filter((c) => c[0] === 'cancelBody').length, 1);
  const ssh = current();
  checkResult(await ssh.run({ kind: 'ssh', connectionId: 'host', hostKey: 'a'.repeat(64) }), true);
  const probe = ssh.calls.find((c) => c[0] === 'probe');
  assert.equal(probe[1], 'host');
  assert.equal(probe[2], 'a'.repeat(64));
  const git = current();
  checkResult(
    await git.run({ kind: 'git', connectionId: 'host', repositoryId: 'local-alias' }),
    true,
  );
  assert.deepEqual(
    git.calls.find((c) => c[0] === 'get'),
    ['get', { agentId: git.ctx.agentId, resourceId: 'local-alias' }, false],
  );
  const call = git.calls.find((c) => c[0] === 'testProxy');
  assert.equal(call[1], 'host');
  assert.equal(call[2], git.resource);
  assert.equal(call[3], git.ctx.sessionId);
  for (const options of [
    { otherHost: true },
    { unbound: true },
    { repoError: new ProtocolError('not-found', 'owner mismatch') },
  ]) {
    const f = current(options),
      r = await f.run({ kind: 'git', connectionId: 'host', repositoryId: 'repo' });
    checkResult(r, false);
    assert.equal(f.calls.filter((c) => c[0] === 'testProxy').length, 0);
  }
  const disabled = current();
  disabled.disable();
  await assert.rejects(disabled.run(), (e) => e.kind === 'invalid-params');
  const stale = current();
  stale.changeRevision('r2');
  await assert.rejects(stale.run(), (e) => e.kind === 'conflict');
  const changed = current({
    fetch: () => {
      changed.changeRevision('r2');
      return { ok: true };
    },
  });
  await assert.rejects(changed.run(), (e) => e.kind === 'conflict');
  proof('proxy-controller-successor-routing', {
    strictKinds: true,
    rejectedCoercedKinds: ['http', 'ssh', 'git'],
    ownerResourceTranslatedToRemoteBinding: true,
    wrongOwnerAndUnboundNoCalls: true,
    revisionFenced: true,
    sshHostKeyForwarded: true,
    HEADNoRedirects: true,
    credentialsPrepared: true,
    boundary:
      'Actual production proxyTest handler with recording settings/network/hosts/catalog ports. Does not assert all these port implementations from doubles.',
  });
});

test('P0 proxy controller successor cancellation session closure malformed URLs and raw errors cannot report success or leak', async () => {
  const rows = [];
  for (const kind of ['http', 'ssh', 'git'])
    for (const field of ['signal', 'sessionSignal']) {
      const f = current(),
        controller = new AbortController();
      controller.abort(Error('synthetic-private-cancel'));
      const r = await f.run(
        { kind, connectionId: 'host', repositoryId: 'repo' },
        { ...f.ctx, [field]: controller.signal },
      );
      checkResult(r, false);
      assert.doesNotMatch(r.message, /synthetic-private/);
      assert.equal(
        f.calls.filter((c) => ['fetch', 'probe', 'get', 'testProxy', 'credentials'].includes(c[0]))
          .length,
        0,
      );
      rows.push({ kind, field, sideEffects: 0 });
    }
  const during = new AbortController();
  const ongoing = current({
    ssh: async (_id, _key, signal) => {
      during.abort();
      assert(signal.aborted);
    },
  });
  const result = await ongoing.run(
    { kind: 'ssh', connectionId: 'host' },
    { ...ongoing.ctx, sessionSignal: during.signal },
  );
  checkResult(result, false);
  for (const url of [
    undefined,
    null,
    1,
    '',
    'broken',
    'file:///private/path',
    'http://user:secret@target/',
    'https://target/' + 'x'.repeat(2048),
  ]) {
    const f = current(),
      r = await f.run({ url });
    checkResult(r, false);
    assert.equal(f.calls.filter((c) => c[0] === 'fetch').length, 0);
    assert.doesNotMatch(r.message, /secret|private\/path/);
  }
  const response = current({ fetch: () => ({ ok: false, status: 502 }) });
  const failure = await response.run();
  checkResult(failure, false);
  assert.match(failure.message, /502/);
  for (const options of [
    { credentialError: Error('synthetic-private') },
    {
      fetch() {
        throw Error('synthetic-private');
      },
    },
    {
      fetch: () => ({
        ok: true,
        body: {
          cancel() {
            throw Error('synthetic-private');
          },
        },
      }),
    },
    {
      ssh() {
        throw Error('synthetic-private');
      },
    },
    {
      git() {
        throw Error('synthetic-private');
      },
    },
  ]) {
    const f = current(options),
      kind = options.ssh ? 'ssh' : options.git ? 'git' : 'http';
    const r = await f.run({ kind, connectionId: 'host', repositoryId: 'repo' });
    checkResult(r, false);
    assert.doesNotMatch(r.message, /synthetic-private/);
  }
  proof('proxy-controller-successor-cancel-errors', {
    rows,
    inFlightSessionAbortObserved: true,
    invalidURLVariants: 8,
    credentialFetchBodySSHGitRawErrorsRedacted: true,
    httpStatusReported: 502,
    limitation:
      'Cancellation returns a failed query result and does not claim rollback or durable network receipts; no wall-clock timeout test.',
  });
});

test('P0 proxy controller successor remote Git snapshot validates all URLs before readonly probes and closes every transport', async () => {
  const rows = [],
    resource = { agentId: randomUUID(), resourceId: 'repo' };
  const ctx = {
    agentId: resource.agentId,
    sessionId: randomUUID(),
    signal: new AbortController().signal,
    sessionSignal: new AbortController().signal,
  };
  for (const [label, urls, exitCode, throws, success] of [
    [
      'distinct',
      [
        'https://git.fixture/r',
        'https://git.fixture/r',
        'ssh://git.fixture/r',
        'git@git.fixture:r',
      ],
      0,
      false,
      true,
    ],
    ['maximum', Array.from({ length: 20 }, (_, i) => 'https://git.fixture/' + i), 0, false, true],
    ['empty', [], 0, false, false],
    ['too many', Array.from({ length: 21 }, (_, i) => 'https://git.fixture/' + i), 0, false, false],
    ['unsupported after valid', ['https://git.fixture/r', 'file:///private/path'], 0, false, false],
    ['git error', ['https://git.fixture/r'], 128, false, false],
    ['port throw', ['https://git.fixture/r'], 0, true, false],
  ]) {
    const calls = [];
    let closed = 0;
    const conn = {
      async execGit(repoPath, argv, signal, limits) {
        calls.push({ repoPath, argv, signal, limits });
        if (argv[0] === 'remote')
          return {
            exitCode: 0,
            stdout: urls.map((u, i) => 'remote' + i + '\t' + u + ' (fetch)').join('\n'),
            stderr: '',
          };
        if (throws) throw Error('synthetic transport failure');
        return { exitCode, stdout: '', stderr: 'synthetic-private' };
      },
      async close() {
        closed++;
      },
    };
    const handler = snapshotHandler(
      {
        get(ref) {
          assert.deepEqual(ref, resource);
          return { path: '/synthetic/repo' };
        },
      },
      async () => conn,
    );
    const p = { kind: 'proxyGitTest', resource };
    handler.validate(p);
    if (success) assert.equal(await handler.run(p, ctx), true);
    else await assert.rejects(handler.run(p, ctx));
    assert.equal(closed, 1, label);
    const probes = calls.filter((c) => c.argv[0] === 'ls-remote');
    if (['empty', 'too many', 'unsupported after valid'].includes(label))
      assert.equal(probes.length, 0);
    if (success) assert.equal(probes.length, new Set(urls).size);
    for (const p of probes) {
      assert.deepEqual(p.argv.slice(0, 3), ['ls-remote', '--heads', '--']);
      assert.deepEqual(p.limits, { maxOutputBytes: 1024 * 1024 });
      assert.equal(p.repoPath, '/synthetic/repo');
      assert.equal(p.signal, calls[0].signal);
    }
    rows.push({ label, closed, probes: probes.length, success });
  }
  proof('proxy-controller-successor-git-snapshot', {
    rows,
    wholeURLSetPrevalidated: true,
    noWrites: true,
    boundary:
      'Production snapshotHandler and GitReads parser; recording transport argv, no live Git in this test. Same-run Git HTTP/SSH companion uses actual temporary repositories.',
  });
});

test('P0 proxy controller successor actual hosts kernel enforces revision session forwarding pins and busy reconnect policy', async () => {
  const dist = path.join(root, 'packages/agent/dist/bootstrap/hosts.js'),
    requireAt = createRequire(dist);
  const module = { exports: {} },
    relays = [],
    connectCalls = [],
    events = [],
    hostId = randomUUID(),
    remoteAgentId = randomUUID();
  let revision = 'r1',
    gitProxy = 'ready',
    stored = [],
    credentialReads = 0;
  const profile = {
    id: hostId,
    name: 'synthetic',
    host: 'host.fixture',
    port: 22,
    username: 'user',
  };
  const settings = {
    hosts: {
      list: () => ({ hosts: [profile] }),
      credential(id) {
        assert.equal(id, hostId);
        credentialReads++;
        return profile;
      },
    },
    proxy: {
      read: () => ({ revision, enabled: true }),
      snapshot: () => ({ revision, enabled: true }),
      assertRevision(r) {
        if (r !== revision) throw new ProtocolError('conflict', 'stale revision');
      },
    },
    async readyCredentials(signal) {
      signal.throwIfAborted();
    },
  };
  const snapshots = [],
    resource = { agentId: remoteAgentId, resourceId: 'remote-repo' };
  class HostRelay {
    activeTasks = 0;
    terminalImpact = [];
    closed = 0;
    constructor(_transport, _version, ready) {
      relays.push(this);
      queueMicrotask(() => ready({ agentId: remoteAgentId }));
    }
    async snapshot(p, signal) {
      snapshots.push({ p, signal });
      signal.throwIfAborted();
      return true;
    }
    close() {
      this.closed++;
    }
  }
  const connect = {
    async connectHost(...args) {
      connectCalls.push(args);
      args[6]('authenticated');
      return {
        transport: {},
        version: {},
        target: 'darwin-arm64',
        digest: 'synthetic-digest',
        gitAvailable: true,
        gitProxy,
        close() {},
      };
    },
    async probeAuthentication(...args) {
      connectCalls.push(['probe', ...args]);
    },
  };
  vm.runInNewContext(
    fs.readFileSync(dist, 'utf8'),
    {
      module,
      exports: module.exports,
      AbortController,
      AbortSignal,
      Buffer,
      setTimeout,
      clearTimeout,
      queueMicrotask,
      require(id) {
        if (id === '../modules/hosts/relay') return { HostRelay };
        if (id === '../adapters/ssh/connect') return connect;
        return requireAt(id);
      },
    },
    { filename: dist },
  );
  const local = { agentId: randomUUID(), list: () => [], hostBinding: () => undefined };
  const hosts = module.exports.hostsKernel('/synthetic/unused', local, settings, {
    read: () => stored,
    write: (v) => {
      stored = v;
    },
  });
  const ctx = {
    agentId: local.agentId,
    sessionId: randomUUID(),
    signal: new AbortController().signal,
    sessionSignal: new AbortController().signal,
    events: {
      notifyState(...args) {
        events.push(args);
      },
    },
  };
  const invoke = async (name, p, context = ctx) => {
    const h = hosts.handlers[name];
    h.validate(p);
    return h.run(p, context);
  };
  try {
    await assert.rejects(
      hosts.testProxy(hostId, resource, ctx.sessionId, ctx.signal),
      (e) => e.kind === 'unavailable',
    );
    for (const pin of [undefined, '', 'wrong'])
      await assert.rejects(
        hosts.probeAuthentication(hostId, pin, ctx.signal),
        (e) => e.kind === 'permission-denied',
      );
    await hosts.probeAuthentication(hostId, 'a'.repeat(64), ctx.signal);
    assert.equal(credentialReads, 1);
    const open = { hostId, hostKey: 'a'.repeat(64), install: false };
    await invoke('hosts.open', open);
    await new Promise(setImmediate);
    await hosts.probeAuthentication(hostId, undefined, ctx.signal);
    await assert.rejects(
      hosts.probeAuthentication(hostId, 'b'.repeat(64), ctx.signal),
      (e) => e.kind === 'permission-denied',
    );
    await hosts.testProxy(hostId, resource, ctx.sessionId, ctx.signal);
    assert.deepEqual(plain(snapshots[0].p), { kind: 'proxyGitTest', resource });
    const catalog = await invoke('hosts.catalog', {});
    assert.equal(catalog.hosts[0].proxyRevision, 'r1');
    assert.equal(catalog.hosts[0].gitProxy, 'ready');
    await assert.rejects(
      hosts.testProxy(hostId, resource, 'other-session', ctx.signal),
      (e) => e.kind === 'unavailable',
    );
    revision = 'r2';
    hosts.proxyChanged();
    await assert.rejects(
      hosts.testProxy(hostId, resource, ctx.sessionId, ctx.signal),
      (e) => e.kind === 'unavailable',
    );
    await assert.rejects(
      invoke('hosts.open', { ...open, reconnectRevision: 'r1' }),
      (e) => e.kind === 'conflict',
    );
    relays[0].activeTasks = 1;
    await assert.rejects(
      invoke('hosts.open', { ...open, reconnectRevision: 'r2' }),
      (e) => e.kind === 'busy',
    );
    relays[0].activeTasks = 0;
    relays[0].terminalImpact = [{ id: 'terminal' }];
    await assert.rejects(
      invoke('hosts.open', { ...open, reconnectRevision: 'r2' }),
      (e) => e.kind === 'busy',
    );
    relays[0].terminalImpact = [];
    await assert.rejects(
      invoke(
        'hosts.open',
        { ...open, reconnectRevision: 'r2' },
        { ...ctx, sessionId: 'other-session' },
      ),
      (e) => e.kind === 'busy',
    );
    gitProxy = 'denied';
    await invoke('hosts.open', { ...open, reconnectRevision: 'r2' });
    await new Promise(setImmediate);
    assert.equal(relays[0].closed, 1);
    assert.equal(connectCalls.at(-1)[3].revision, 'r2');
    await assert.rejects(
      hosts.testProxy(hostId, resource, ctx.sessionId, ctx.signal),
      (e) => e.kind === 'unavailable',
    );
    await hosts.testProxy(hostId, undefined, ctx.sessionId, ctx.signal); // SSH-only capability retained after Git forwarding denial.
    gitProxy = 'disabled';
    await invoke('hosts.open', { ...open, reconnectRevision: 'r2' });
    await new Promise(setImmediate);
    await assert.rejects(
      hosts.testProxy(hostId, undefined, ctx.sessionId, ctx.signal),
      (e) => e.kind === 'unavailable',
    );
    hosts.disconnect(ctx.sessionId);
    await assert.rejects(
      hosts.testProxy(hostId, resource, ctx.sessionId, ctx.signal),
      (e) => e.kind === 'unavailable',
    );
    assert.equal(snapshots.length, 1);
    assert(events.every((e) => e[0] === 'hosts.changed'));
    proof('proxy-controller-successor-hosts', {
      revisions: ['r1', 'r2'],
      validSnapshots: snapshots.length,
      staleWrongSessionBusyTasksAndTerminalsReject: true,
      explicitReconnectUsesCurrentRevision: true,
      forwardingDeniedRetainsSSH: true,
      disabledAndDisconnectedReject: true,
      pinRequired: true,
      boundary:
        'Entire built production hosts.js runs unchanged with recording HostRelay/connectHost/probeAuthentication network ports. This is route policy execution, not actual Agent installation/handshake; same-run ssh2/OpenSSH companions prove loopback transport only.',
    });
  } finally {
    hosts.close();
  }
});

test('P0 proxy controller successor real settings and host status handlers preserve owner isolation events and restart', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch29-')),
    kernels = [],
    ids = [randomUUID(), randomUUID()];
  t.after(async () => {
    for (const k of kernels) await k.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const open = async (name, id) => {
    const k = await openStateKernel(path.join(directory, name), id, undefined, { backend: 'file' });
    kernels.push(k);
    return k;
  };
  const a = await open('a', ids[0]),
    b = await open('b', ids[1]),
    events = [];
  const invoke = async (k, id, name, params) => {
    const h = k.handlers[name];
    h.validate(params);
    const signal = new AbortController().signal;
    return h.run(params, {
      agentId: id,
      sessionId: randomUUID(),
      taskId: randomUUID(),
      signal,
      sessionSignal: signal,
      events: {
        notifyState(...args) {
          events.push({ id, args });
        },
      },
    });
  };
  const first = await invoke(a, ids[0], 'settings.proxy.get'),
    peer = await invoke(b, ids[1], 'settings.proxy.get');
  assert.deepEqual(await invoke(a, ids[0], 'hosts.catalog', {}), { local: [], hosts: [] });
  const saved = await invoke(a, ids[0], 'settings.proxy.save', {
    config: { ...first, enabled: true, host: '127.0.0.1', credentials: { action: 'keep' } },
  });
  assert.notEqual(saved.revision, first.revision);
  assert.equal(events.length, 1);
  assert.equal(events[0].args[0], 'settings.changed');
  await assert.rejects(
    invoke(a, ids[0], 'settings.proxy.save', {
      config: { ...first, credentials: { action: 'keep' } },
    }),
    (e) => e.kind === 'conflict',
  );
  assert.equal((await invoke(b, ids[1], 'settings.proxy.get')).revision, peer.revision);
  const fail = await invoke(a, ids[0], 'network.testProxy', {
    kind: 'git',
    revision: saved.revision,
    connectionId: 'missing-host',
    repositoryId: 'missing-repo',
  });
  assert.equal(fail.success, false);
  assert.equal(events.length, 1);
  await a.close();
  const restored = await open('a', ids[0]);
  assert.equal((await invoke(restored, ids[0], 'settings.proxy.get')).revision, saved.revision);
  assert.equal((await invoke(b, ids[1], 'settings.proxy.get')).revision, peer.revision);
  proof('proxy-controller-real-kernels', {
    owners: ids,
    events: 1,
    failedSaveNoEvent: true,
    peerUnaffected: true,
    settingsRevisionPreserved: saved.revision,
    unknownRepositoryRejected: true,
    boundary:
      'Actual temporary SQLite kernels; handler context is synthetic. SDK/stdio restart and durable unknown-write receipts have separate same-run companions.',
  });
});

test(
  'P0 proxy controller real HTTP query uses saved proxy HEAD refuses redirects auth failures and closes on cancellation',
  { timeout: 30000 },
  async (t) => {
    const { listen, httpProxy } = require('./helpers/proxy-fixture.cjs');
    const records = [],
      entered = Promise.withResolvers(),
      slowClosed = Promise.withResolvers();
    const origin = await listen(
      http.createServer((req, res) => {
        records.push({
          method: req.method,
          url: req.url,
          proxyAuth: req.headers['proxy-authorization'] ?? null,
        });
        if (req.url === '/slow') {
          req.socket.once('close', slowClosed.resolve);
          entered.resolve();
          return;
        }
        if (req.url === '/redirect') {
          res.writeHead(302, { location: '/ok' });
          res.end();
          return;
        }
        res.writeHead(req.url === '/forbidden' ? 403 : 204);
        res.end();
      }),
    );
    t.after(origin.close);
    const proxy = await httpProxy({ map: () => ({ host: '127.0.0.1', port: origin.port }) });
    t.after(proxy.close);
    const denied = await httpProxy({ status: 407 });
    t.after(denied.close);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch29-http-')),
      id = randomUUID();
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const k = await openStateKernel(directory, id, undefined, { backend: 'file' });
    t.after(() => k.close());
    const ctx = {
      agentId: id,
      sessionId: randomUUID(),
      taskId: randomUUID(),
      signal: new AbortController().signal,
      sessionSignal: new AbortController().signal,
      events: { notifyState() {} },
    };
    const call = async (name, p, c = ctx) => {
      const h = k.handlers[name];
      h.validate(p);
      return h.run(p, c);
    };
    const initial = await call('settings.proxy.get');
    let saved = await call('settings.proxy.save', {
      config: {
        ...initial,
        enabled: true,
        host: '127.0.0.1',
        port: proxy.port,
        credentials: { action: 'keep' },
      },
    });
    const query = (suffix, c = ctx) =>
      call(
        'network.testProxy',
        {
          kind: 'http',
          revision: saved.revision,
          url: `http://target.fixture:${origin.port}${suffix}`,
        },
        c,
      );
    assert.equal((await query('/ok')).success, true);
    assert.equal((await query('/forbidden')).success, false);
    assert.equal((await query('/redirect')).success, false);
    assert.deepEqual(
      records.map((r) => r.url),
      ['/ok', '/forbidden', '/redirect'],
    );
    assert(records.every((r) => r.method === 'HEAD' && r.proxyAuth === null));
    assert(proxy.records.every((r) => r.host === 'target.fixture'));
    const controller = new AbortController(),
      pending = query('/slow', { ...ctx, sessionSignal: controller.signal });
    await entered.promise;
    controller.abort();
    assert.equal((await pending).success, false);
    await slowClosed.promise;
    const before = records.length;
    saved = await call('settings.proxy.save', {
      config: { ...saved, port: denied.port, credentials: { action: 'keep' } },
    });
    assert.equal((await query('/blocked')).success, false);
    assert.equal(records.length, before);
    assert.equal(denied.records.length, 1);
    proof('proxy-controller-real-http', {
      originRecords: records,
      proxyHost: 'target.fixture',
      redirectNotFollowed: true,
      cancellationFailedQuery: true,
      cancellationSocketClosed: true,
      refusedProxyNoTargetHit: true,
      actualKernelAndNetwork: true,
      boundary:
        'Disposable local HTTP CONNECT proxy and origin with proxy-side DNS mapping; no external host or TLS certificate success claim.',
    });
  },
);
