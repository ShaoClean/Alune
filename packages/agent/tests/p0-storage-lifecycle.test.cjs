// Disposable databases only. Frozen Nest decorators capture metadata; no old server boots.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const Database = require('better-sqlite3');
const { AgentState } = require('../dist/adapters/sqlite/state');
const { openStateKernel } = require('../dist/bootstrap/state-kernel');
const frozen = process.env.P0_STORAGE_FROZEN;
assert(frozen, 'Use the batch-04 replay driver');

function legacy(file, directory) {
  let metadata,
    global = false;
  const source = fs.readFileSync(
    path.join(frozen, 'apps/server/src/database', file + '.ts'),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
    },
  }).outputText;
  const module = { exports: {} };
  const dependencies = {
    '@nestjs/common': {
      Module: (value) => {
        metadata = value;
        return () => {};
      },
      Global: () => {
        global = true;
        return () => {};
      },
      Injectable: () => () => {},
      Inject: (token) => {
        assert.equal(token, 'DATABASE');
        return () => {};
      },
    },
    'better-sqlite3': Database,
    fs,
    path,
    os: {
      homedir: () => {
        throw Error('Daily home directory access denied');
      },
    },
  };
  const context = vm.createContext({
    module,
    exports: module.exports,
    process: { env: { ALUNE_DATA_DIR: directory } },
  });
  vm.runInContext('(function(require,module,exports){' + output + '\n})', context)(
    (name) => {
      assert(Object.hasOwn(dependencies, name), 'Unreviewed frozen dependency: ' + name);
      return dependencies[name];
    },
    module,
    module.exports,
  );
  return { exports: module.exports, metadata, global };
}
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-p0-storage-'));
  const id = randomUUID();
  const f = { root, id, store: null };
  t.after(async () => {
    await f.store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  f.store = await AgentState.open(root, id);
  return f;
}
async function pair(t) {
  const f = await fixture(t);
  const directory = path.join(f.root, 'old');
  const module = legacy('database.module', directory);
  const oldDb = module.metadata.providers[0].useFactory();
  const Old = legacy('database.service', directory).exports.DatabaseService;
  const old = new Old(oldDb);
  t.after(() => {
    if (oldDb.open) old.onModuleDestroy();
  });
  const current = {
    run: (sql, ...params) => f.store.database.prepare(sql).run(...params),
    get: (sql, ...params) => f.store.database.prepare(sql).get(...params),
    all: (sql, ...params) => f.store.database.prepare(sql).all(...params),
  };
  for (const db of [oldDb, f.store.database]) {
    db.exec(
      'CREATE TEMP TABLE sample(id INTEGER PRIMARY KEY, value TEXT UNIQUE, bytes BLOB, nullable TEXT);',
    );
  }
  return { ...f, old, oldDb, current, module };
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const sqlError = (fn) => {
  try {
    fn();
    assert.fail('Expected SQLite refusal');
  } catch (error) {
    assert(error.code?.startsWith('SQLITE_'), error.stack);
    return error.code;
  }
};

test('P0-STORAGE-0180 database module successor owns durable private WAL state', async (t) => {
  const f = await fixture(t);
  const old = legacy('database.module', path.join(f.root, 'old'));
  const db = old.metadata.providers[0].useFactory();
  t.after(() => db.close());
  for (const connection of [db, f.store.database]) {
    assert.equal(connection.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(connection.pragma('foreign_keys', { simple: true }), 1);
  }
  const doc = f.store.document('fixture');
  doc.read();
  doc.write({ unicode: '中文', nested: [0, false, null] });
  const generation = f.store.generation;
  await f.store.close();
  f.store = await AgentState.open(f.root, f.id);
  assert.equal(f.store.generation, generation);
  assert.deepEqual(f.store.document('fixture').read(), {
    unicode: '中文',
    nested: [0, false, null],
  });
  assert.equal(fs.statSync(f.root).mode & 0o777, 0o700);
  assert.equal(fs.statSync(f.store.database.name).mode & 0o777, 0o600);
  assert.equal(f.store.database.pragma('synchronous', { simple: true }), 2);
});

test('P0-STORAGE-0181 database provider has explicit agent ownership and exclusive lifecycle', async (t) => {
  const f = await fixture(t);
  const old = legacy('database.module', path.join(f.root, 'old'));
  assert.equal(old.global, true);
  assert.deepEqual(Object.keys(old.exports), ['DatabaseModule']);
  assert.deepEqual(plain(old.metadata.exports), ['DATABASE']);
  assert.equal(old.metadata.providers.length, 1);
  assert.equal(old.metadata.providers[0].provide, 'DATABASE');
  assert.deepEqual(f.store.status(), {
    agentId: f.id,
    schemaVersion: 1,
    generation: f.store.generation,
    writer: true,
  });
  await assert.rejects(AgentState.open(f.root, f.id), (e) => e.kind === 'busy');
  await f.store.close();
  await assert.rejects(AgentState.open(f.root, randomUUID()), (e) => e.kind === 'conflict');
  f.store = await AgentState.open(f.root, f.id);
  const other = await fixture(t);
  const a = f.store.resource('repository', '/same-local-path');
  const b = other.store.resource('repository', '/same-local-path');
  assert.notEqual(a, b);
  assert.equal(f.store.resource('repository', '/same-local-path'), a);
});

test('P0-STORAGE-0182 database service successor retains SQL errors and atomic rollback', async (t) => {
  const f = await pair(t);
  const results = [];
  for (const [service, db] of [
    [f.old, f.oldDb],
    [f.current, f.store.database],
  ]) {
    const failure = sqlError(() =>
      db.transaction(() => {
        service.run('INSERT INTO sample VALUES(?,?,?,?)', 1, 'first', null, null);
        service.run('INSERT INTO sample VALUES(?,?,?,?)', 2, 'first', null, null);
      })(),
    );
    assert.equal(failure, 'SQLITE_CONSTRAINT_UNIQUE');
    assert.deepEqual(service.all('SELECT * FROM sample'), []);
    results.push([
      failure,
      sqlError(() => service.run('INSERT INTO missing_table VALUES(?)', 1)),
      sqlError(() => service.get('SELECT bad syntax')),
      sqlError(() => service.all('SELECT * FROM missing_table')),
    ]);
    assert.equal(db.open, true);
  }
  assert.deepEqual(results[1], results[0]);
});

test('P0-STORAGE-0183 database service raw handle remains an internal port', async (t) => {
  const f = await pair(t);
  assert.equal(f.old.database, f.oldDb);
  assert.deepEqual(
    Object.getOwnPropertyNames(Object.getPrototypeOf(f.old)).sort(),
    ['constructor', 'database', 'onModuleDestroy', 'run', 'get', 'all'].sort(),
  );
  assert.equal(f.store.database.open, true);
  const kernel = await openStateKernel(path.join(f.root, 'kernel'), randomUUID(), undefined, {
    backend: 'file',
  });
  t.after(() => kernel.close());
  const methods = Object.keys(kernel.handlers)
    .filter((n) => n.startsWith('storage.'))
    .sort();
  assert.deepEqual(methods, ['storage.backupDatabase', 'storage.status']);
  const status = kernel.handlers['storage.status'];
  status.validate({});
  assert.equal(status.effect, 'query');
  assert.equal(status.minimumProtocolMinor, 1);
  assert.deepEqual(Object.keys(status.run()).sort(), [
    'agentId',
    'generation',
    'schemaVersion',
    'writer',
  ]);
  for (const name of methods)
    assert.throws(
      () => kernel.handlers[name].validate({ sql: 'SELECT * FROM documents' }),
      (e) => e.kind === 'invalid-params',
    );
});

test('P0-STORAGE-0184 database shutdown closes handles and rejects captured ports', async (t) => {
  const f = await pair(t);
  const doc = f.store.document('closing');
  doc.read();
  doc.write({ retained: true });
  const journal = f.store.taskJournal();
  const prepared = f.store.database.prepare('SELECT 1');
  f.old.onModuleDestroy();
  assert.equal(f.oldDb.open, false);
  assert.throws(() => f.old.get('SELECT 1'));
  const a = f.store.close(),
    b = f.store.close();
  assert.equal(a, b);
  await a;
  assert.equal(f.store.database.open, false);
  assert.equal(f.store.status().writer, false);
  for (const action of [
    () => doc.read(),
    () => doc.write({ lost: true }),
    () => f.store.resource('r', 'k'),
    () => journal.find({ requestId: 'x' }),
    () => prepared.get(),
  ])
    assert.throws(action);
  await assert.rejects(f.store.backup(), (e) => e.kind === 'unavailable');
  const reopened = await AgentState.open(f.root, f.id);
  try {
    assert.deepEqual(reopened.document('closing').read(), { retained: true });
  } finally {
    await reopened.close();
  }
});

test('P0-STORAGE-0185 database run preserves bindings changes and constraint refusal', async (t) => {
  const f = await pair(t),
    results = [];
  for (const service of [f.old, f.current]) {
    const text = "中文\n'); DROP TABLE sample; --\0";
    const inserted = service.run(
      'INSERT INTO sample VALUES(?,?,?,?)',
      7,
      text,
      Buffer.from([0, 255]),
      null,
    );
    assert.deepEqual(inserted, { changes: 1, lastInsertRowid: 7 });
    const update = service.run('UPDATE sample SET nullable=@value WHERE id=@id', {
      value: 'bound',
      id: 7,
    });
    assert.equal(update.changes, 1);
    const missing = service.run('DELETE FROM sample WHERE id=?', 99);
    assert.equal(missing.changes, 0);
    assert.equal(service.get('SELECT value FROM sample WHERE id=7').value, text);
    results.push([
      inserted,
      update,
      missing,
      sqlError(() => service.run('INSERT INTO sample(id) VALUES(?)', 7)),
    ]);
  }
  assert.deepEqual(results[1], results[0]);
});

test('P0-STORAGE-0186 database get preserves absent null binary and first row values', async (t) => {
  const f = await pair(t),
    results = [];
  for (const service of [f.old, f.current]) {
    assert.equal(service.get('SELECT * FROM sample WHERE id=?', 999), undefined);
    service.run('INSERT INTO sample VALUES(?,?,?,?)', 1, '中文', Buffer.from([0, 128, 255]), null);
    service.run('INSERT INTO sample VALUES(?,?,?,?)', 2, 'second', null, 'non-null');
    const row = service.get('SELECT * FROM sample ORDER BY id');
    assert.deepEqual(row, {
      id: 1,
      value: '中文',
      bytes: Buffer.from([0, 128, 255]),
      nullable: null,
    });
    assert.deepEqual(
      service.get('SELECT id,nullable FROM sample WHERE value=@value', { value: 'second' }),
      { id: 2, nullable: 'non-null' },
    );
    results.push(row);
  }
  assert.deepEqual(results[1], results[0]);
});

test('P0-STORAGE-0187 database all preserves empty ordered and parameterized result sets', async (t) => {
  const f = await pair(t),
    results = [];
  for (const service of [f.old, f.current]) {
    assert.deepEqual(service.all('SELECT * FROM sample'), []);
    for (const [id, value] of [
      [3, '三'],
      [1, '一'],
      [2, '二'],
    ])
      service.run('INSERT INTO sample(id,value) VALUES(?,?)', id, value);
    const rows = service.all('SELECT id,value FROM sample WHERE id>=? ORDER BY id DESC', 2);
    assert.deepEqual(rows, [
      { id: 3, value: '三' },
      { id: 2, value: '二' },
    ]);
    assert.deepEqual(service.all('SELECT value FROM sample WHERE id=@id', { id: 1 }), [
      { value: '一' },
    ]);
    results.push(rows);
  }
  assert.deepEqual(results[1], results[0]);
});

test('P0 storage failed kernel initialization releases writer without erasing corrupt state', async (t) => {
  const f = await fixture(t);
  const doc = f.store.document('ssh-routes');
  doc.read();
  doc.write({ invalid: 'retained evidence' });
  await f.store.close();
  const script = `
    const assert = require('node:assert/strict');
    let kernel = require('./packages/agent/dist/bootstrap/state-kernel');
    if (process.env.P0_STORAGE_KERNEL_FILE) {
      const fs = require('node:fs'), vm = require('node:vm');
      const req = require('node:module').createRequire(require.resolve('./packages/agent/dist/bootstrap/state-kernel'));
      const archived = {exports:{}};
      vm.compileFunction(fs.readFileSync(process.env.P0_STORAGE_KERNEL_FILE,'utf8'),['require','module','exports'])(req,archived,archived.exports);
      kernel = archived.exports;
    }
    const {openStateKernel} = kernel;
    const {AgentState} = require('./packages/agent/dist/adapters/sqlite/state');
    (async () => {
      const [root,id] = process.argv.slice(1);
      await assert.rejects(openStateKernel(root,id,undefined,{backend:'file'}), e=>e.kind==='state-corrupt');
      const state=await AgentState.open(root,id);
      try { assert.deepEqual(state.document('ssh-routes').read(),{invalid:'retained evidence'}); }
      finally { await state.close(); }
    })().catch(e=>{ console.error(e); process.exitCode=1; });`;
  const child = spawnSync(process.execPath, ['-e', script, f.root, f.id], {
    cwd: path.resolve(__dirname, '../../..'),
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.signal, null);
});

test('P0 storage shutdown releases the writer even when an owned component fails to close', async (t) => {
  const f = await fixture(t);
  await f.store.close();
  const dependency = require('../dist/bootstrap/repositories-kernel');
  const original = dependency.repositoriesKernel;
  let kernel;
  dependency.repositoriesKernel = (...args) => {
    const repositories = original(...args);
    const close = repositories.close.bind(repositories);
    return {
      ...repositories,
      async close() {
        await close();
        throw Error('synthetic component cleanup failure');
      },
    };
  };
  try {
    kernel = await openStateKernel(f.root, f.id, undefined, { backend: 'file' });
  } finally {
    dependency.repositoriesKernel = original;
  }
  const a = kernel.close(),
    b = kernel.close();
  assert.equal(a, b);
  await assert.rejects(
    a,
    (error) =>
      error instanceof AggregateError &&
      error.errors.length === 1 &&
      error.errors[0].message === 'synthetic component cleanup failure',
  );
  assert.equal(kernel.state.database.open, false);
  f.store = await AgentState.open(f.root, f.id);
  assert.equal(f.store.status().writer, true);
});
