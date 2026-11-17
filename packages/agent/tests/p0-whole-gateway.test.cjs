// Complete frozen class execution; all framework, socket, log store and timers below are doubles.
// The same replay separately executes real frozen LogStore and production Agent/SDK/stdio.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const plain = (v) => JSON.parse(JSON.stringify(v));

test('P0 whole gateway exact source export and all responsibilities execute together without hidden effects', () => {
  assert(process.env.P0_WHOLE_GATEWAY_FROZEN, 'Use batch-21 replay driver');
  const file = 'apps/server/src/events/events.gateway.ts';
  const source = fs.readFileSync(path.join(process.env.P0_WHOLE_GATEWAY_FROZEN, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  assert.deepEqual(ast.parseDiagnostics, []);
  assert.equal(ast.statements.length, 8);
  assert.deepEqual(
    ast.statements.filter(ts.isImportDeclaration).map((s) => s.moduleSpecifier.text),
    ['@nestjs/websockets', '@nestjs/common', 'socket.io', '@alune/shared', '../logging/logger'],
  );
  const declarations = ast.statements.filter(ts.isVariableStatement);
  assert.deepEqual(
    declarations.map((s) => s.getText(ast)),
    ["const LOG_ROOM = 'logs';", 'const LOG_BATCH_MS = 100;'],
  );
  const classes = ast.statements.filter(ts.isClassDeclaration);
  assert.equal(classes.length, 1);
  const klass = classes[0];
  assert.equal(klass.name.text, 'EventsGateway');
  assert(klass.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
  assert.deepEqual(
    klass.heritageClauses.flatMap((h) => h.types.map((t) => t.getText(ast))),
    ['OnGatewayInit', 'OnGatewayConnection', 'OnGatewayDisconnect', 'OnModuleDestroy'],
  );
  const members = klass.members.map((m) => m.name?.getText(ast));
  assert.deepEqual(members, [
    'server',
    'logBatch',
    'logTimer',
    'unsubscribeLogs',
    'afterInit',
    'onModuleDestroy',
    'handleConnection',
    'handleDisconnect',
    'subscribeLogs',
    'emitConnectionStatus',
    'emitRepoStatus',
    'emitCommandOutput',
    'emitCommandExit',
  ]);
  assert.equal(klass.members.filter(ts.isPropertyDeclaration).length, 4);
  assert.equal(klass.members.filter(ts.isMethodDeclaration).length, 9);

  const module = { exports: {} },
    imports = [],
    metadata = [],
    debug = [],
    packets = [],
    timers = new Map(),
    cleared = [],
    listeners = new Set(),
    joins = [],
    rooms = new Map();
  let serial = 0,
    disposals = 0;
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
      setTimeout(fn, ms) {
        const id = ++serial;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimeout(id) {
        cleared.push(id);
        timers.delete(id);
      },
      require(id) {
        imports.push(id);
        if (id === '@nestjs/websockets')
          return Object.fromEntries(
            ['WebSocketGateway', 'WebSocketServer', 'SubscribeMessage', 'ConnectedSocket'].map(
              (name) => [
                name,
                (...args) =>
                  (...target) => {
                    metadata.push({
                      name,
                      args,
                      member: target[1],
                      parameter: target[2],
                      target: target[0],
                    });
                  },
              ],
            ),
          );
        if (id === '../logging/logger')
          return {
            logger: { debug: (...args) => debug.push(args) },
            logStore: () => ({
              subscribe(fn) {
                listeners.add(fn);
                return () => {
                  disposals++;
                  listeners.delete(fn);
                };
              },
            }),
          };
        assert.fail('Unexpected runtime import: ' + id);
      },
    },
    { filename: 'frozen/' + file },
  );
  assert.deepEqual(imports, ['@nestjs/websockets', '../logging/logger']);
  assert.deepEqual(Object.keys(module.exports), ['EventsGateway']);
  const Gateway = module.exports.EventsGateway;
  assert.equal(typeof Gateway, 'function');
  assert.deepEqual(Object.getOwnPropertyNames(Gateway.prototype), [
    'constructor',
    ...members.slice(4),
  ]);
  assert.deepEqual(Object.keys(Gateway), []);
  const config = metadata.find((m) => m.name === 'WebSocketGateway');
  assert.equal(config.target, Gateway);
  assert.deepEqual(plain(config.args), [{ cors: { origin: '*' } }]);
  assert.equal(metadata.length, 4);
  assert.equal(metadata.find((m) => m.name === 'WebSocketServer').member, 'server');
  assert.equal(metadata.find((m) => m.name === 'WebSocketServer').target, Gateway.prototype);
  assert.deepEqual(plain(metadata.find((m) => m.name === 'SubscribeMessage').args), [
    'logs:subscribe',
  ]);
  assert.equal(metadata.find((m) => m.name === 'SubscribeMessage').member, 'subscribeLogs');
  assert.equal(metadata.find((m) => m.name === 'ConnectedSocket').parameter, 0);

  const gateway = new Gateway(),
    peer = new Gateway();
  assert.notEqual(gateway.logBatch, peer.logBatch);
  assert.deepEqual(plain(gateway), { logBatch: [] });
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
  assert.deepEqual(debug, []);
  assert.deepEqual(packets, []);
  gateway.onModuleDestroy(); // No initialized subscriber/timer is also safe.
  assert.equal(disposals, 0);
  gateway.afterInit();
  assert.equal(listeners.size, 1);
  const log = (row) => {
    for (const fn of listeners) fn(row);
  };
  log({ message: 'no-server' });
  assert.equal(timers.size, 0);
  assert.equal(gateway.emitConnectionStatus('a', 'connected'), undefined);
  assert.throws(() => gateway.emitRepoStatus('repo', 'a', {}));
  assert.throws(() => gateway.emitCommandOutput('a', 'git', 'x', 'stdout'));
  assert.throws(() => gateway.emitCommandExit('a', 'git', 1));
  gateway.server = {
    sockets: { adapter: { rooms } },
    to(room) {
      return {
        emit(name, payload) {
          packets.push({ room, name, payload: plain(payload) });
        },
      };
    },
    emit(name, payload) {
      packets.push({ name, payload: plain(payload) });
    },
  };
  log({ message: 'no-audience' });
  assert.equal(timers.size, 0);
  assert.deepEqual(
    plain(
      gateway.subscribeLogs({
        join: (room) => {
          joins.push(room);
          return Promise.resolve();
        },
      }),
    ),
    { ok: true },
  );
  assert.deepEqual(joins, ['logs']);
  rooms.set('logs', new Set(['client-a']));
  gateway.handleConnection({ id: 'client-a' });
  log({ message: 'first' });
  log({ message: 'second' });
  gateway.handleDisconnect({ id: 'client-a' });
  assert.equal(listeners.size, 1); // Socket disconnect is not global gateway destruction.
  assert.equal(timers.size, 1);
  assert.equal(gateway.logBatch.length, 2);
  assert.deepEqual(plain(debug), [
    ['socket', '客户端已连接', { clientId: 'client-a' }],
    ['socket', '客户端已断开', { clientId: 'client-a' }],
  ]);
  assert.throws(() => gateway.handleConnection(null));
  assert.throws(() => gateway.handleDisconnect(null));
  const [timerId, timer] = [...timers][0];
  assert.equal(timer.ms, 100);
  timers.delete(timerId);
  timer.fn();
  assert.equal(gateway.logTimer, undefined);
  assert.equal(gateway.logBatch.length, 0);
  gateway.emitConnectionStatus('a', 'connected', undefined, 17);
  gateway.emitRepoStatus('repo', 'a', { repositoryId: 'override', isDirty: true });
  gateway.emitCommandOutput('a', 'git status', '中\r\n', 'stdout');
  gateway.emitCommandOutput('a', 'git status', 'warn', 'stderr');
  gateway.emitCommandExit('a', 'git status', 7);
  assert.deepEqual(packets, [
    { room: 'logs', name: 'log:entries', payload: [{ message: 'first' }, { message: 'second' }] },
    {
      name: 'connection:status',
      payload: { connectionId: 'a', status: 'connected', updatedAt: 17 },
    },
    {
      name: 'repo:status',
      payload: { repositoryId: 'override', connectionId: 'a', isDirty: true },
    },
    {
      name: 'command:output',
      payload: { connectionId: 'a', command: 'git status', data: '中\r\n', type: 'stdout' },
    },
    {
      name: 'command:output',
      payload: { connectionId: 'a', command: 'git status', data: 'warn', type: 'stderr' },
    },
    { name: 'command:exit', payload: { connectionId: 'a', command: 'git status', exitCode: 7 } },
  ]);
  log({ message: 'cancel-pending' });
  assert.equal(timers.size, 1);
  gateway.onModuleDestroy();
  assert.equal(disposals, 1);
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(cleared.length, 1);
  log({ message: 'after-destroy' });
  assert.equal(packets.length, 6);
  assert.deepEqual(plain(peer), { logBatch: [] });
  if (process.env.P0_WHOLE_GATEWAY_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_WHOLE_GATEWAY_PROOF_DIR, 'whole-gateway-responsibilities.json'),
      JSON.stringify(
        {
          completeSourceAndExportExecuted: true,
          topLevelStatements: ast.statements.length,
          imports,
          constants: declarations.map((s) => s.getText(ast)),
          members,
          metadata: metadata.map(({ name, args, member, parameter }) => ({
            name,
            args,
            member,
            parameter: typeof parameter === 'number' ? parameter : undefined,
          })),
          debug,
          packets,
          disposals,
          timersRemaining: timers.size,
          lateSendCount: 0,
          boundary:
            'Explicit decorator/socket/store/timer doubles. Same-run companions separately use actual frozen LogStore and current production SDK/stdio/SQLite/native Git. CORS wildcard is a frozen declaration, not current access policy. No live Nest/Socket.IO, UI or production shared-kernel claim.',
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
});
