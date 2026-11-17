// Real HTTP/IPC/Agent boundaries, with explicit Electron bootstrap dependency doubles.
// No daily state, legacy migration, OS credentials, installers or hosted-only scripts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const ts = require('typescript');
const sdk = require('@alune/agent-client/node');
const { PROTOCOL_VERSION } = require('@alune/protocol');
const repo = path.resolve(__dirname, '../../..');
const cli = path.join(repo, 'packages/agent/bin/alune-agent.cjs');
const desktopFile = path.join(repo, 'apps/desktop/src/desktop-agent.cjs');
const version = require('../../../package.json').version;
const digest = (v) => createHash('sha256').update(v).digest('hex');
const plain = (v) => JSON.parse(JSON.stringify(v));
function record(name, value) {
  if (process.env.P0_LIFECYCLE_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_LIFECYCLE_PROOF_DIR, name),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function frozenBootstrap(options = {}) {
  assert(process.env.P0_LIFECYCLE_FROZEN, 'Use the batch-08 replay driver');
  const source = fs.readFileSync(
    path.join(process.env.P0_LIFECYCLE_FROZEN, 'apps/server/src/bootstrap.ts'),
    'utf8',
  );
  const ast = ts.createSourceFile('bootstrap.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(
    (s) => ts.isInterfaceDeclaration(s) && s.name.text === 'ServerOptions',
  );
  const fields = declaration.members.map((m) => ({
    name: m.name.getText(ast),
    type: m.type.getText(ast),
    optional: Boolean(m.questionToken),
  }));
  assert.deepEqual(
    fields,
    [
      ['port', 'number'],
      ['host', 'string'],
      ['webRoot', 'string'],
      ['token', 'string'],
      ['aiSecretStorage', 'AiSecretStorage'],
      ['desktop', 'boolean'],
    ].map(([name, type]) => ({ name, type, optional: true })),
  );
  const calls = [],
    apps = [];
  class IoAdapter {
    createIOServer(port, options) {
      calls.push(['super.createIOServer', port]);
      return { port, options };
    }
  }
  const deps = {
    '@nestjs/core': {
      NestFactory: {
        async create(mod, createOptions) {
          calls.push(['create', plain(createOptions)]);
          if (options.fail === 'create') throw options.error;
          const app = {
            mod,
            options: createOptions,
            terminals: {},
            middleware: [],
            cors: [],
            prefix: [],
            get() {
              return this.terminals;
            },
            use(...args) {
              this.middleware.push(args);
              if (options.fail === 'middleware') throw options.error;
            },
            useWebSocketAdapter(value) {
              this.adapter = value;
            },
            enableCors(value) {
              this.cors.push(value);
            },
            setGlobalPrefix(value) {
              this.prefix.push(value);
            },
            async listen(...args) {
              calls.push(['listen', ...args]);
              this.listenArgs = args;
              if (options.fail === 'listen') throw options.error;
            },
            async getUrl() {
              calls.push(['getUrl']);
              if (options.fail === 'url') throw options.error;
              return 'http://synthetic.invalid';
            },
            async close() {
              calls.push(['close']);
              this.closed = true;
            },
          };
          apps.push(app);
          return app;
        },
      },
    },
    '@nestjs/platform-socket.io': { IoAdapter },
    express: {
      json: (options) => ({ parser: options ?? 'default' }),
      static: (...args) => ({ static: args }),
    },
    'node:path': path,
    './app.module': { AppModule: { register: (storage) => ({ storage }) } },
    './terminal/terminal-registry': { TerminalRegistry: class {} },
    './logging/nest-logger': { AluneNestLogger: class {} },
    './logging/logger': {
      logger: {
        info: (...args) => calls.push(['info', ...args]),
        error: (...args) => calls.push(['error', ...args]),
      },
      errorContext: (e) => e,
      logStore: () => calls.push(['logStore']),
    },
    './logging/redact': { registerSecret: (token) => calls.push(['registerSecret', token]) },
  };
  const m = { exports: {} };
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {})(
    (name) => {
      assert(Object.hasOwn(deps, name), 'Unreviewed frozen dependency: ' + name);
      return deps[name];
    },
    m,
    m.exports,
  );
  assert.deepEqual(Object.keys(m.exports), ['startServer']);
  const inventory = ast.statements.map((s) => ({
    kind: ts.SyntaxKind[s.kind],
    line: ast.getLineAndCharacterOfPosition(s.getStart(ast)).line + 1,
    text: s.getText(ast),
    sha256: digest(s.getText(ast)),
  }));
  return { source, fields, calls, apps, inventory, ...m.exports };
}
async function desktop(t, options = {}) {
  const token = Object.hasOwn(options, 'token') ? options.token : randomBytes(32).toString('hex');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch08-')),
    src = path.join(root, 'src'),
    runtime = path.join(root, 'agent-runtime');
  fs.mkdirSync(path.join(src, 'web/assets'), { recursive: true });
  fs.mkdirSync(runtime);
  fs.writeFileSync(
    path.join(runtime, 'manifest.json'),
    JSON.stringify({ version, target: process.platform + '-' + process.arch }),
  );
  fs.writeFileSync(path.join(src, 'web/index.html'), '<html>batch08 shell</html>');
  fs.writeFileSync(path.join(src, 'web/assets/app.js'), 'window.batch08 = true;');
  fs.writeFileSync(path.join(src, 'web/socket.iota'), 'not a reserved endpoint');
  fs.writeFileSync(path.join(root, 'outside.js'), 'OUTSIDE-PRIVATE-BYTES');
  fs.symlinkSync(path.join(root, 'outside.js'), path.join(src, 'web/assets/linked.js'));
  const handlers = options.handlers ?? new Map(),
    hosts = [],
    effects = [],
    servers = [];
  const contents = () => {
    const c = new EventEmitter();
    c.mainFrame = { url: '', send: (...args) => c.emit('sent', ...args) };
    c.isDestroyed = () => false;
    return c;
  };
  const workspace = contents(),
    logs = contents();
  const allowed = {
    'node:http': {
      createServer: (...args) => {
        if (options.createError) throw options.createError;
        const server = http.createServer(...args);
        servers.push(server);
        if (options.listenPort) {
          const listen = server.listen.bind(server);
          server.listen = (_port, ...args) => listen(options.listenPort, ...args);
        }
        return server;
      },
    },
    'node:path': path,
    'node:fs': fs,
    'node:os': os,
    '@alune/agent-client/node': {
      superviseUiAgent: async (node, entry, dir, v) => {
        effects.push('supervise');
        assert.equal(node, path.join(runtime, 'runtime/bin/node'));
        assert.equal(entry, path.join(runtime, 'node_modules/@alune/agent/bin/alune-agent.cjs'));
        assert.equal(dir, path.join(root, 'data/agent'));
        assert.equal(v, version);
        const h = await sdk.superviseUiAgent(process.execPath, cli, dir, v);
        hosts.push(h);
        return options.bridge ? { ...h, client: { updaterBridge: async () => options.bridge } } : h;
      },
    },
    './workspace-preferences.cjs': require('../../../apps/desktop/src/workspace-preferences.cjs'),
    './agent-window-channel.cjs': require('../../../apps/desktop/src/agent-window-channel.cjs'),
    './agent-import.cjs': {
      initializeDesktopState: async (...args) => {
        effects.push('migration-double');
        if (options.migrationError) throw options.migrationError;
        assert.equal(args[1], path.join(root, 'data'));
      },
    },
    './ai-secret-storage.cjs': {
      createAiSecretStorage: () => {
        effects.push('safeStorage-double');
        return {};
      },
    },
    electron: { safeStorage: {} },
    undici: options.undici ?? require('undici'),
  };
  const m = new Module(path.join(src, 'desktop-agent.cjs'), module);
  m.filename = path.join(src, 'desktop-agent.cjs');
  m.require = (name) => {
    assert(Object.hasOwn(allowed, name), 'Unreviewed desktop dependency: ' + name);
    return allowed[name];
  };
  m._compile(
    fs.readFileSync(process.env.P0_LIFECYCLE_DESKTOP_FILE ?? desktopFile, 'utf8'),
    m.filename,
  );
  let service;
  t.after(async () => {
    await service?.close().catch(() => {});
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
    for (const h of hosts) await h.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const start = async () => {
    service = await m.exports.startDesktopAgent({
      app: { isPackaged: false, getVersion: () => version },
      ipcMain: {
        handle(name, fn) {
          if (options.registrationError && name === 'agent:frame') throw options.registrationError;
          assert(!handlers.has(name), 'Duplicate IPC handler: ' + name);
          handlers.set(name, fn);
        },
        removeHandler(name) {
          effects.push('remove:' + name);
          handlers.delete(name);
          if (options.removeError && name === 'agent:open') throw options.removeError;
        },
      },
      token,
      dataDir: path.join(root, 'data'),
      windowContents: () => workspace,
      logContents: () => logs,
      smokeTest: true,
    });
    workspace.mainFrame.url = service.origin;
    logs.mainFrame.url = service.origin + '/logs';
    return service;
  };
  return {
    root,
    start,
    handlers,
    hosts,
    servers,
    effects,
    workspace,
    logs,
    token,
    event: (c) => ({ sender: c, senderFrame: c.mainFrame }),
  };
}
function request(origin, token, route, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      origin + '/',
      {
        path: route,
        method: options.method ?? 'GET',
        headers: {
          ...(token === undefined ? {} : { authorization: 'Bearer ' + token }),
          ...options.headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(Error('HTTP timeout')));
    req.end();
  });
}
function peer(f, c, generation) {
  return new sdk.AgentClient(
    sdk.frameTransport({
      send: async (frame) => {
        assert.equal(await f.handlers.get('agent:frame')(f.event(c), generation, frame), true);
      },
      close: () => {
        f.handlers.get('agent:close')?.(f.event(c), generation);
      },
      onFrame(fn) {
        const read = (type, g, value) => {
          if (type === 'agent:frame' && g === generation) fn(value);
        };
        c.on('sent', read);
        return () => c.off('sent', read);
      },
      onEnd(fn) {
        const read = (type, g) => {
          if (type === 'agent:end' && g === generation) fn();
        };
        c.on('sent', read);
        return () => c.off('sent', read);
      },
    }),
  );
}
const sequences = new Map();
async function raw(f, c, generation, method, params) {
  return new Promise((resolve, reject) => {
    const sequence = (sequences.get(generation) ?? 0) + 1;
    sequences.set(generation, sequence);
    const id = 'batch08:' + sequence;
    const timer = setTimeout(() => {
      c.off('sent', read);
      reject(Error('No raw response: ' + method));
    }, 5000);
    const read = (kind, g, value) => {
      if (kind !== 'agent:frame' || g !== generation) return;
      const reply = JSON.parse(value);
      if (reply.id !== id) return;
      clearTimeout(timer);
      c.off('sent', read);
      resolve(reply);
    };
    c.on('sent', read);
    void Promise.resolve(
      f.handlers.get('agent:frame')(
        f.event(c),
        generation,
        JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }),
      ),
    ).catch(reject);
  });
}

module.exports = {
  frozenBootstrap,
  desktop,
  request,
  peer,
  raw,
  record,
  digest,
  plain,
  repo,
  cli,
  version,
};
