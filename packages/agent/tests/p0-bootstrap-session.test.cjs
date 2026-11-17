// Frozen greeting classes run only in an allowlisted VM. Live successors use disposable Agents.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const Module = require('node:module');
const { execFileSync, spawnSync } = require('node:child_process');
const { PassThrough } = require('node:stream');
const ts = require('typescript');
const { AgentClient, StdioTransport, spawnAgent } = require('@alune/agent-client/node');
const { PROTOCOL_VERSION } = require('@alune/protocol');
const cli = path.resolve(__dirname, '../bin/alune-agent.cjs');
const actualSession = path.resolve(__dirname, '../dist/server/session.js');
const { AgentSession } = (() => {
  if (!process.env.P0_BOOTSTRAP_SESSION_FILE) return require(actualSession);
  const m = new Module(actualSession, module);
  m.filename = actualSession;
  m.paths = Module._nodeModulePaths(path.dirname(actualSession));
  m._compile(fs.readFileSync(process.env.P0_BOOTSTRAP_SESSION_FILE, 'utf8'), actualSession);
  return m.exports;
})();
function legacy() {
  const frozen = process.env.P0_BOOTSTRAP_FROZEN;
  assert(frozen, 'Use the batch-05 replay driver');
  const metadata = { methods: [] };
  const load = (file, deps) => {
    const source = fs.readFileSync(path.join(frozen, 'apps/server/src', file + '.ts'), 'utf8');
    const ast = ts.createSourceFile(file + '.ts', source, ts.ScriptTarget.Latest, true);
    const classes = ast.statements.filter(ts.isClassDeclaration);
    assert.equal(classes.length, 1);
    const declaration = classes[0];
    assert.deepEqual(
      declaration.members.filter(ts.isMethodDeclaration).map((m) => m.name.getText(ast)),
      ['getHello'],
    );
    assert.equal(declaration.members.length, file === 'app.controller' ? 2 : 1);
    assert.equal(ast.statements.length, file === 'app.controller' ? 3 : 2);
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
      },
    }).outputText;
    const m = { exports: {} };
    vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {})(
      (name) => {
        assert(Object.hasOwn(deps, name), 'Unreviewed dependency: ' + name);
        return deps[name];
      },
      m,
      m.exports,
    );
    return m.exports;
  };
  const common = {
    Injectable: () => () => {},
    Controller: (...args) => {
      metadata.controller = args;
      return () => {};
    },
    Get:
      (...args) =>
      (_target, method) => {
        metadata.methods.push({ method, args });
      },
  };
  const service = load('app.service', { '@nestjs/common': common });
  const controller = load('app.controller', { '@nestjs/common': common, './app.service': service });
  assert.deepEqual(metadata, { methods: [{ method: 'getHello', args: [] }], controller: [] });
  return { ...service, ...controller };
}
const testResources = new WeakMap();
function resources(t) {
  if (!testResources.has(t)) {
    const owned = { directories: [], agents: [] };
    testResources.set(t, owned);
    t.after(async () => {
      await Promise.all(owned.agents.map((a) => a.close()));
      for (const root of owned.directories) fs.rmSync(root, { recursive: true, force: true });
    });
  }
  return testResources.get(t);
}
function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-p0-bootstrap-'));
  resources(t).directories.push(root);
  return root;
}
function agent(t, root = directory(t)) {
  const a = spawnAgent(process.execPath, [cli, 'serve', '--data-dir', root]);
  resources(t).agents.push(a);
  return a;
}
async function waitFor(fn) {
  for (let n = 0; n < 500; n++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error('Condition did not become true');
}

test('P0-BOOTSTRAP-0131 root controller greeting is replaced by initialized health dispatch', async (t) => {
  const { AppController, AppService } = legacy();
  assert.equal(new AppController(new AppService()).getHello(), 'Hello World!');
  const a = agent(t);
  await assert.rejects(a.client.request('agent.health'), {
    kind: 'not-initialized',
    outcome: 'not-started',
  });
  const init = await a.client.initialize();
  assert.deepEqual(await a.client.request('agent.health'), {
    status: 'ok',
    agentId: init.agentId,
    sessionId: init.sessionId,
    lifecycle: 'session',
  });
  await assert.rejects(a.client.request('getHello'), {
    kind: 'unknown-method',
    outcome: 'not-started',
  });
  await assert.rejects(a.client.request('agent.health', { token: 'synthetic' }), {
    kind: 'invalid-params',
  });
});

test('P0-BOOTSTRAP-0132 root controller export has no uninitialized or foreign Agent authority', async (t) => {
  const { AppController } = legacy();
  let called = 0;
  assert.equal(
    new AppController({
      getHello() {
        called++;
        return 'fixture';
      },
    }).getHello(),
    'fixture',
  );
  assert.equal(called, 1);
  const a = agent(t),
    b = agent(t);
  const [ai, bi] = await Promise.all([a.client.initialize(), b.client.initialize()]);
  assert.notEqual(ai.agentId, bi.agentId);
  assert.notEqual(ai.sessionId, bi.sessionId);
  const repo = directory(t);
  execFileSync('git', ['init', '-q', repo]);
  const { resource } = await b.client.registerRepository(repo);
  await assert.rejects(a.client.request('repositories.read', { resource, kind: 'status' }), {
    kind: 'invalid-params',
    outcome: 'not-started',
  });
  assert.equal((await a.client.request('agent.health')).agentId, ai.agentId);
  assert.equal((await b.client.request('agent.health')).agentId, bi.agentId);
});

test('P0-BOOTSTRAP-0138 root service greeting successor reports exact health and application version', async (t) => {
  const { AppService } = legacy();
  assert.equal(new AppService().getHello(), 'Hello World!');
  assert.deepEqual(Object.getOwnPropertyNames(AppService.prototype), ['constructor', 'getHello']);
  const a = agent(t);
  const init = await a.client.initialize();
  assert.equal(init.implementation.name, 'alune-agent');
  const version = require('../../../package.json').version;
  assert.equal(init.implementation.version, version);
  assert.deepEqual(await a.client.request('agent.version'), {
    version,
    protocol: PROTOCOL_VERSION,
  });
  assert.deepEqual(await a.client.request('agent.health'), {
    status: 'ok',
    agentId: init.agentId,
    sessionId: init.sessionId,
    lifecycle: 'session',
  });
});

test('P0-BOOTSTRAP-0139 root service ownership survives restart without reusing session identity', async (t) => {
  const { AppService } = legacy();
  const old = new AppService();
  assert.deepEqual(Object.keys(old), []);
  assert.equal(old.getHello(), old.getHello());
  const root = directory(t),
    a = agent(t, root);
  const before = await a.client.initialize();
  await a.close();
  assert.deepEqual(await a.exited, { code: 0, signal: null });
  const b = agent(t, root),
    next = await b.client.initialize();
  assert.equal(before.agentId, next.agentId);
  assert.notEqual(before.sessionId, next.sessionId);
  assert.deepEqual(await b.client.request('agent.health'), {
    status: 'ok',
    agentId: next.agentId,
    sessionId: next.sessionId,
    lifecycle: 'session',
  });
});

test('P0 bootstrap reentrant close waits for actual disposal and shares its promise', async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  const client = new AgentClient(new StdioTransport(output, input));
  let reentered,
    resolveDispose,
    startedResolve,
    abortCount = 0,
    disposeCount = 0;
  const disposing = new Promise((resolve) => {
    resolveDispose = resolve;
  });
  const started = new Promise((resolve) => {
    startedResolve = resolve;
  });
  const session = new AgentSession(new StdioTransport(input, output), {
    agentId: 'bootstrap-agent',
    version: 'fixture',
    handlers: {
      'fixture.wait': {
        effect: 'mutation',
        validate() {},
        run(_p, ctx) {
          startedResolve();
          return new Promise((_resolve, reject) =>
            ctx.signal.addEventListener(
              'abort',
              () => {
                abortCount++;
                reentered = session.close();
                reject(ctx.signal.reason);
              },
              { once: true },
            ),
          );
        },
      },
    },
    onDispose: async () => {
      disposeCount++;
      await disposing;
    },
  });
  try {
    await client.initialize();
    const pending = client.request('fixture.wait').catch((e) => e);
    await started;
    const closing = session.close();
    await waitFor(() => reentered && disposeCount);
    assert.strictEqual(reentered, closing, 'Reentrant close returned an early sentinel promise');
    let finished = false;
    void reentered.then(() => {
      finished = true;
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(finished, false, 'Close resolved before owned disposal finished');
    assert.strictEqual(session.close(), closing);
    resolveDispose();
    await closing;
    await session.closed;
    assert.equal(finished, true);
    assert.equal(abortCount, 1);
    assert.equal(disposeCount, 1);
    assert.equal((await pending).outcome, 'unknown');
    assert.equal(session.shutdownTimedOut, false);
    assert.equal(session.shutdownFailed, false);
  } finally {
    resolveDispose();
    await session.close();
    client.close();
  }
});

test('P0 bootstrap CLI EOF and signals release writer without stdout pollution', async (t) => {
  const root = directory(t);
  let agentId;
  for (const trigger of ['EOF', 'SIGTERM', 'SIGINT']) {
    const a = agent(t, root);
    const stdout = [];
    a.process.stdout.on('data', (chunk) => stdout.push(chunk));
    const init = await a.client.initialize();
    if (agentId) assert.equal(init.agentId, agentId);
    agentId = init.agentId;
    if (trigger === 'EOF') await a.close();
    else a.process.kill(trigger);
    assert.deepEqual(await a.exited, { code: 0, signal: null });
    const messages = Buffer.concat(stdout)
      .toString('utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].jsonrpc, '2.0');
    assert.equal(messages[0].result.sessionId, init.sessionId);
  }
});

test('P0 bootstrap malformed frames fail and incompatible major cannot initialize or obtain health', async (t) => {
  const root = directory(t);
  const a = agent(t, root),
    init = await a.client.initialize();
  await a.close();
  for (const malformed of [true, false]) {
    const frame = malformed
      ? 'not-json\n'
      : JSON.stringify({
          jsonrpc: '2.0',
          id: 'bad:1',
          method: 'initialize',
          params: {
            protocol: { major: PROTOCOL_VERSION.major + 1, minor: 0 },
            client: { name: 'p0', version: '1' },
          },
        }) +
        '\n' +
        JSON.stringify({ jsonrpc: '2.0', id: 'bad:2', method: 'agent.health' }) +
        '\n';
    const result = spawnSync(process.execPath, [cli, 'serve', '--data-dir', root], {
      input: frame,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, malformed ? 1 : 0, result.stderr);
    if (malformed) {
      assert.match(result.stderr, /Alune Agent: Agent protocol session failed \(parse\)/);
      assert.equal(result.stdout, '');
    } else {
      assert.equal(result.stderr, '');
      const messages = result.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(messages.length, 2);
      assert.deepEqual(
        messages.map((m) => [m.id, m.error.data.kind, m.error.data.outcome]),
        [
          ['bad:1', 'incompatible-version', 'not-started'],
          ['bad:2', 'not-initialized', 'not-started'],
        ],
      );
      assert(messages.every((m) => m.jsonrpc === '2.0' && !Object.hasOwn(m, 'result')));
    }
    const b = agent(t, root),
      next = await b.client.initialize();
    assert.equal(next.agentId, init.agentId);
    assert.notEqual(next.sessionId, init.sessionId);
    await b.close();
  }
});

test('P0 bootstrap disposal errors and deadline retain failed shutdown outcomes', async () => {
  for (const hangs of [false, true]) {
    const input = new PassThrough(),
      output = new PassThrough();
    output.resume();
    let disposed = 0;
    const session = new AgentSession(new StdioTransport(input, output), {
      agentId: 'bootstrap-agent',
      version: 'fixture',
      shutdownMs: 15,
      onDispose: async () => {
        disposed++;
        if (hangs) await new Promise(() => {});
        else throw Error('synthetic disposal fault');
      },
    });
    const closing = session.close();
    assert.strictEqual(session.close(), closing);
    await closing;
    await session.closed;
    assert.equal(disposed, 1);
    assert.equal(session.shutdownTimedOut, hangs);
    assert.equal(session.shutdownFailed, !hangs);
  }
});

test('P0 bootstrap serve-ui refuses a missing private host before creating state', (t) => {
  const root = directory(t),
    data = path.join(root, 'not-created');
  const result = spawnSync(process.execPath, [cli, 'serve-ui', '--data-dir', data], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Private host channel is required/);
  assert.equal(fs.existsSync(data), false);
});

test('P0 bootstrap whole startup files are inventoried without issuing complete replacement passes', () => {
  const frozen = process.env.P0_BOOTSTRAP_FROZEN;
  assert(frozen, 'Use the batch-05 replay driver');
  const files = ['app.controller', 'app.service', 'app.module', 'bootstrap', 'main'];
  const audit = files.map((file) => {
    const source = fs.readFileSync(path.join(frozen, 'apps/server/src', file + '.ts'), 'utf8');
    const ast = ts.createSourceFile(file + '.ts', source, ts.ScriptTarget.Latest, true);
    const calls = [],
      methods = [],
      exports = [],
      interfaces = {};
    function visit(n) {
      if (ts.isCallExpression(n)) calls.push(n.expression.getText(ast));
      if (ts.isMethodDeclaration(n)) methods.push(n.name.getText(ast));
      if (ts.isInterfaceDeclaration(n))
        interfaces[n.name.text] = n.members.map((m) => m.name.getText(ast));
      if (
        (ts.isClassDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isInterfaceDeclaration(n)) &&
        n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      )
        exports.push(n.name.text);
      ts.forEachChild(n, visit);
    }
    visit(ast);
    return {
      file: 'apps/server/src/' + file + '.ts',
      sha256: createHash('sha256').update(source).digest('hex'),
      calls,
      methods,
      exports,
      interfaces,
      statements: ast.statements.map((s) => s.getText(ast)),
      completeReplacementPassed: false,
    };
  });
  const bootstrap = audit.find((a) => a.file.endsWith('/bootstrap.ts'));
  assert.deepEqual(bootstrap.interfaces.ServerOptions, [
    'port',
    'host',
    'webRoot',
    'token',
    'aiSecretStorage',
    'desktop',
  ]);
  assert.deepEqual(bootstrap.exports, ['ServerOptions', 'startServer']);
  assert.deepEqual(bootstrap.methods, ['createIOServer']);
  for (const name of [
    'registerSecret',
    'logStore',
    'NestFactory.create',
    'AppModule.register',
    'app.get',
    'app.use',
    'super.createIOServer',
    'callback',
    'app.useWebSocketAdapter',
    'app.enableCors',
    'express.json',
    'app.setGlobalPrefix',
    'path.resolve',
    'express.static',
    'res.set',
    'res.sendFile',
    'path.extname',
    'sendIndex',
    'app.listen',
    'app.getUrl',
    'logger.info',
    'logger.error',
    'errorContext',
    'app.close',
  ])
    assert(bootstrap.calls.includes(name), name);
  const main = audit.find((a) => a.file.endsWith('/main.ts'));
  assert.deepEqual(main.exports, []);
  assert.deepEqual(main.calls, [
    'process.on',
    'logger.error',
    'errorContext',
    'startServer',
    'app.enableShutdownHooks',
    'console.log',
    'app.getUrl',
    'bootstrap',
  ]);
  assert(main.statements.some((s) => s.includes("'uncaughtExceptionMonitor'")));
  const evidence = {
    releaseEligible: false,
    scope: 'frozen-source inventory only; no whole startup pass',
    files: audit,
  };
  if (process.env.P0_BOOTSTRAP_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_BOOTSTRAP_PROOF_DIR, 'bootstrap-inventory.json'),
      JSON.stringify(evidence, null, 2) + '\n',
      { flag: 'wx' },
    );
});
