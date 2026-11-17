const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const current = require('../dist/modules/git/repository-files');
const { SSHConnection } = require('../dist/adapters/ssh/connection-manager');
const { startSSHServer } = require('./helpers/ssh-server.cjs');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = (v) => createHash('sha256').update(v).digest('hex');
function proof(name, value) {
  if (process.env.P0_REPOSITORY_HELPERS_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_REPOSITORY_HELPERS_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function frozen() {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const file = 'packages/ssh-client/src/' + name + '.ts';
    const source = fs.readFileSync(
      path.join(process.env.P0_REPOSITORY_HELPERS_FROZEN, file),
      'utf8',
    );
    assert.equal(
      source,
      execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }),
    );
    const module = { exports: {} };
    const deps = {
      util: require('node:util'),
      'node:path': require('node:path'),
      '@alune/shared': require('@alune/domain'),
      './lfs': {
        GitLfs: class {
          constructor() {
            throw Error('LFS outside selected helper scope');
          }
        },
      },
      './repository-transport': {
        runGit() {
          throw Error('Git outside selected helper scope');
        },
      },
    };
    vm.runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        module,
        exports: module.exports,
        Buffer,
        Error,
        TextDecoder,
        require(id) {
          if (Object.hasOwn(deps, id)) return deps[id];
          assert(
            ['./git-shell', './repository-path', './sftp-file'].includes(id),
            'Unexpected frozen dependency: ' + id,
          );
          return load(id.slice(2));
        },
      },
      { filename: file },
    );
    cache.set(name, module.exports);
    return module.exports;
  }
  return load('repository-files');
}
const versions = () => [
  ['frozen', frozen()],
  ['current', current],
];
function temporary(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alune-file-helpers-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function bytesPort(bytes, options = {}) {
  const trace = [];
  const handle = Buffer.from('handle');
  return {
    trace,
    open(target, flags, cb) {
      trace.push(['open', target, flags]);
      cb(options.openError ?? null, handle);
    },
    read(h, buffer, offset, length, position, cb) {
      assert.equal(h, handle);
      trace.push(['read', position, length]);
      if (options.readError) return cb(options.readError);
      const n = Math.min(options.chunkSize ?? length, length, bytes.length - position);
      bytes.copy(buffer, offset, position, position + n);
      cb(null, n, buffer);
    },
    close(h, cb) {
      assert.equal(h, handle);
      trace.push(['close']);
      if (options.close) return options.close(cb);
      cb(options.closeError ?? null);
    },
  };
}

test('P0 repository helpers frozen and current resolve preserve exact canonical roots Windows comparison and error identity', async () => {
  const rows = [];
  for (const [version, api] of versions()) {
    for (const entry of [
      { repo: '/alias', relative: '', canonical: '/actual', expected: '/actual' },
      {
        repo: '/alias',
        relative: "子目录 '$()'/leaf",
        canonical: '/actual',
        expected: "/actual/子目录 '$()'/leaf",
      },
      {
        repo: 'C:/Repo',
        relative: 'Sub',
        canonical: 'C:/Repo',
        resolved: 'c:\\REPO\\sub',
        expected: 'C:/Repo/Sub',
      },
      {
        repo: '//server/Share',
        relative: 'Sub',
        canonical: '//server/Share',
        resolved: '//SERVER/share/sub',
        expected: '//server/Share/Sub',
      },
    ]) {
      for (const method of ['export', 'private']) {
        const calls = [];
        const sftp = {
          realpath(p, cb) {
            assert.equal(this, sftp);
            calls.push(p);
            cb(null, calls.length === 1 ? entry.canonical : (entry.resolved ?? p));
          },
        };
        const files = new api.RepositoryFiles({});
        const result =
          method === 'export'
            ? await api.resolveRepositoryDirectory(sftp, entry.repo, entry.relative, 'requested')
            : await files.resolve(sftp, entry.repo, entry.relative, 'requested');
        assert.equal(result, entry.expected);
        assert.deepEqual(calls, entry.relative ? [entry.repo, entry.expected] : [entry.repo]);
        rows.push({ version, method, ...entry, calls, result });
      }
    }
    for (const failAt of [1, 2]) {
      const reason = Object.assign(new Error('realpath failed'), { code: 'EIO' });
      let calls = 0;
      const port = {
        realpath(p, cb) {
          calls++;
          cb(calls === failAt ? reason : null, p);
        },
      };
      await assert.rejects(
        api.resolveRepositoryDirectory(port, '/repo', 'sub', 'display'),
        (e) => e === reason,
      );
      assert.equal(calls, failAt);
    }
    for (const resolved of ['/outside/sub', '/repo/Sub']) {
      const port = {
        realpath(p, cb) {
          cb(null, p === '/repo' ? p : resolved);
        },
      };
      await assert.rejects(
        new api.RepositoryFiles({}).resolve(port, '/repo', 'sub', 'visible.txt'),
        (e) =>
          e instanceof api.RepositoryFileError &&
          e.statusCode === 400 &&
          e.message.includes('visible.txt') &&
          /符号链接/.test(e.message),
      );
    }
  }
  proof('helpers-resolve', {
    rows,
    boundary:
      'Windows and UNC string comparison via recording port; no Windows OS execution. Caller validates relative paths; helper alone is not an authorization boundary.',
  });
});

test('P0 repository helpers readCapped returns exact bytes at zero and boundary with bounded sequential reads', async () => {
  const rows = [];
  for (const [version, api] of versions()) {
    for (const [size, limit, chunkSize] of [
      [0, 0, 7],
      [17, 17, 3],
      [131073, 131073, 65536],
      [19, 32, 4],
    ]) {
      const bytes = Buffer.alloc(size);
      for (let i = 0; i < size; i++) bytes[i] = i % 256;
      const port = bytesPort(bytes, { chunkSize });
      const result = await new api.RepositoryFiles({}).readCapped(port, 'literal 文件', limit);
      assert.deepEqual(result, bytes);
      assert.deepEqual(port.trace[0], ['open', 'literal 文件', 'r']);
      assert.deepEqual(port.trace.at(-1), ['close']);
      const reads = port.trace.filter((x) => x[0] === 'read');
      assert.deepEqual(
        reads.map((x) => x[1]),
        Array.from({ length: Math.ceil(size / chunkSize) + 1 }, (_, i) =>
          Math.min(i * chunkSize, size),
        ),
      );
      assert(reads.every((x) => x[2] === 65536));
      rows.push({ version, size, limit, sha256: hash(result), trace: port.trace });
    }
  }
  proof('helpers-capped-bytes', rows);
});

test('P0 repository helpers readCapped awaits close on overflow and propagates open read close failures', async () => {
  const rows = [];
  for (const [version, api] of versions()) {
    const files = new api.RepositoryFiles({});
    let acknowledge;
    let closeRequested;
    const closed = new Promise((resolve) => {
      closeRequested = resolve;
    });
    const port = bytesPort(Buffer.alloc(32), {
      chunkSize: 8,
      close(cb) {
        acknowledge = cb;
        closeRequested();
      },
    });
    let settled = false;
    const pending = files.readCapped(port, '/target', 8).then(
      () => {
        throw Error('overflow accepted');
      },
      (error) => {
        settled = true;
        return error;
      },
    );
    await closed;
    await new Promise(setImmediate);
    assert.equal(settled, false);
    assert.deepEqual(port.trace, [
      ['open', '/target', 'r'],
      ['read', 0, 65536],
      ['read', 8, 65536],
      ['close'],
    ]);
    acknowledge(null);
    assert.equal((await pending).constructor.name, 'PreviewLimitError');
    rows.push({ version, overflow: true, waitsForClose: true, trace: port.trace });
    for (const which of ['openError', 'readError', 'closeError']) {
      const reason = new Error(which);
      const broken = bytesPort(Buffer.from('data'), { [which]: reason });
      await assert.rejects(files.readCapped(broken, '/target', 8), (e) => e === reason);
      assert.equal(
        broken.trace.filter((x) => x[0] === 'close').length,
        which === 'openError' ? 0 : 1,
      );
      rows.push({ version, failure: which, originalError: true, trace: broken.trace });
    }
    const readError = new Error('read'),
      closeError = new Error('close');
    await assert.rejects(
      files.readCapped(bytesPort(Buffer.alloc(1), { readError, closeError }), '/target', 1),
      (e) => e === closeError,
    );
    rows.push({
      version,
      bothFail: 'close error supersedes read error under existing finally semantics',
    });
  }
  proof('helpers-capped-lifecycle', rows);
});

test('P0 repository helpers sftp preserves operation identity completion and every error mapping without retries', async () => {
  const rows = [];
  for (const [version, api] of versions()) {
    const token = {},
      value = {};
    let received, complete;
    const connection = {
      withSftp(operation) {
        received = operation;
        return operation(token);
      },
    };
    const files = new api.RepositoryFiles(connection);
    const operation = (port) => {
      assert.equal(port, token);
      return new Promise((resolve) => {
        complete = resolve;
      });
    };
    let settled = false;
    const pending = files.sftp('文件', operation).then((v) => {
      settled = true;
      return v;
    });
    assert.equal(received, operation);
    await new Promise(setImmediate);
    assert.equal(settled, false);
    complete(value);
    assert.equal(await pending, value);
    for (const source of ['connection', 'operation']) {
      for (const [error, status, message] of [
        [
          Object.assign(new Error('missing'), { code: 2 }),
          404,
          '文件不存在，可能已被移动或删除，请刷新后重试。',
        ],
        [
          Object.assign(new Error('missing'), { code: 'ENOENT' }),
          404,
          '文件不存在，可能已被移动或删除，请刷新后重试。',
        ],
        [Object.assign(new Error('denied'), { code: 3 }), 403, '没有读取此文件的权限。'],
        [Object.assign(new Error('denied'), { code: 'EACCES' }), 403, '没有读取此文件的权限。'],
        [new Error('broken'), 400, '无法读取文件：broken'],
        [new Error(''), 400, '无法读取文件：仓库文件操作失败'],
        ['non-error', 400, '无法读取文件：仓库文件操作失败'],
        [null, 400, '无法读取文件：仓库文件操作失败'],
      ]) {
        let calls = 0;
        const transport = {
          withSftp(op) {
            calls++;
            if (source === 'connection') throw error;
            return op(token);
          },
        };
        await assert.rejects(
          new api.RepositoryFiles(transport).sftp('文件', async () => {
            throw error;
          }),
          (e) =>
            e instanceof api.RepositoryFileError &&
            e.statusCode === status &&
            e.message === message,
        );
        assert.equal(calls, 1);
        rows.push({ version, source, code: error?.code, status, message, calls });
      }
    }
    const original = new api.RepositoryFileError('original', 409);
    await assert.rejects(
      new api.RepositoryFiles({
        withSftp() {
          throw original;
        },
      }).sftp('目录', operation),
      (e) => e === original,
    );
    await assert.rejects(
      new api.RepositoryFiles({
        withSftp() {
          throw { code: 3 };
        },
      }).sftp('目录', operation),
      (e) => e.message === '没有读取此目录的权限。',
    );
  }
  proof('helpers-error-mapping', {
    rows,
    exactOperation: true,
    exactResult: true,
    waitsForCompletion: true,
    repositoryErrorIdentity: true,
  });
});

test(
  'P0 repository helpers real loopback SSH canonical symlink refusal capped bytes and permission mapping preserve files',
  { timeout: 30000 },
  async (t) => {
    const directory = temporary(t);
    const repo = path.join(directory, "repo '$()' 中文");
    fs.mkdirSync(path.join(repo, 'deep'), { recursive: true });
    const bytes = Buffer.alloc(131073);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    const target = path.join(repo, 'deep', 'raw.bin');
    fs.writeFileSync(target, bytes);
    fs.symlinkSync('deep', path.join(repo, 'link'));
    fs.symlinkSync(directory, path.join(repo, 'outside'));
    fs.symlinkSync(repo, path.join(directory, 'root-alias'));
    const remote = await startSSHServer({
      onSftp(sftp) {
        const handlers = sftp.listeners('OPEN');
        sftp.removeAllListeners('OPEN');
        sftp.on('OPEN', (id, name, ...args) => {
          if (name.endsWith('/denied')) return sftp.status(id, 3, 'fixture denied');
          for (const handler of handlers) handler(id, name, ...args);
        });
      },
    });
    const connection = new SSHConnection(remote.options);
    connection.on('error', () => {});
    t.after(async () => {
      connection.disconnect();
      await remote.close();
    });
    await connection.connect();
    const rows = [];
    for (const [version, api] of versions()) {
      const files = new api.RepositoryFiles(connection);
      await connection.withSftp(async (sftp) => {
        assert.equal(
          await api.resolveRepositoryDirectory(sftp, path.join(directory, 'root-alias'), '', ''),
          repo,
        );
        assert.equal(
          await files.resolve(sftp, repo, 'deep', 'deep/raw.bin'),
          path.join(repo, 'deep'),
        );
        for (const relative of ['link', 'outside'])
          await assert.rejects(
            files.resolve(sftp, repo, relative, relative + '/raw.bin'),
            (e) => e instanceof api.RepositoryFileError && /符号链接/.test(e.message),
          );
        assert.deepEqual(await files.readCapped(sftp, target, bytes.length), bytes);
        await assert.rejects(
          files.readCapped(sftp, target, bytes.length - 1),
          (e) => e.constructor.name === 'PreviewLimitError',
        );
      });
      for (const [name, status] of [
        ['missing', 404],
        ['denied', 403],
      ])
        await assert.rejects(
          files.sftp('文件', (sftp) => files.readCapped(sftp, path.join(repo, name), 16)),
          (e) => e instanceof api.RepositoryFileError && e.statusCode === status,
        );
      assert.deepEqual(fs.readFileSync(target), bytes);
      rows.push({
        version,
        canonical: repo,
        symlinksRefused: ['link', 'outside'],
        byteLength: bytes.length,
        sha256: hash(bytes),
        overflowRejected: true,
        statuses: [404, 403],
        unchanged: true,
      });
    }
    proof('helpers-real-ssh', {
      rows,
      boundary:
        'Actual ssh2 client/server with SFTP over loopback on local temporary files; no remote host installation or Windows claim.',
    });
  },
);

test('P0 repository helpers actual SDK stdio preserves preview ownership paths bytes and index', async (t) => {
  const { spawnAgent } = require('@alune/agent-client/node');
  const { randomUUID } = require('node:crypto');
  const directory = temporary(t),
    repo = path.join(directory, 'owner repo');
  fs.mkdirSync(repo);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(directory, 'empty-config'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'preserved\n');
  git('add', '--', 'tracked.txt');
  git('commit', '-qm', 'fixture');
  const index = hash(fs.readFileSync(path.join(repo, '.git/index'))),
    head = git('rev-parse', 'HEAD');
  const child = spawnAgent(process.execPath, [
    path.join(__dirname, 'settings-fixture.cjs'),
    path.join(directory, 'state'),
  ]);
  t.after(() => child.close());
  try {
    const init = await child.client.initialize();
    const registered = await child.client.registerRepository(repo);
    assert.equal(registered.resource.agentId, init.agentId);
    const status = await child.client.readRepository(registered.resource, 'status', {});
    assert.equal(status.branch, 'main');
    assert.equal(
      (await child.client.readRepository(registered.resource, 'file', { path: 'tracked.txt' }))
        .content,
      'preserved\n',
    );
    fs.symlinkSync(directory, path.join(repo, 'outside-link'));
    const tree = await child.client.readRepository(registered.resource, 'tree', { path: '' });
    assert(tree.entries.some((e) => e.name === 'tracked.txt' && e.kind === 'file'));
    assert(!tree.entries.some((e) => e.name.toLowerCase() === '.git'));
    await assert.rejects(
      child.client.readRepository(registered.resource, 'file', {
        path: 'outside-link/empty-config',
      }),
    );
    const link = await child.client.readRepository(registered.resource, 'file', {
      path: 'outside-link',
    });
    assert.equal(link.kind, 'symlink');
    for (const forbidden of ['.git/config', '../outside', '/etc/passwd'])
      await assert.rejects(
        child.client.readRepository(registered.resource, 'file', { path: forbidden }),
        (e) => e.kind === 'invalid-params',
      );
    for (const resource of [
      { ...registered.resource, agentId: randomUUID() },
      { ...registered.resource, resourceId: randomUUID() },
    ])
      await assert.rejects(
        child.client.readRepository(resource, 'file', { path: 'tracked.txt' }),
        (e) => e.kind === 'not-found',
      );
    await assert.rejects(
      child.client.request('repositories.read', {
        resource: registered.resource,
        kind: 'execute',
        params: { args: ['reset', '--hard'] },
      }),
      (e) => e.kind === 'invalid-params',
    );
    await assert.rejects(
      child.client.request('git.stage', { resource: registered.resource, files: ['.'] }),
      (e) => e.kind === 'unknown-method',
    );
    await assert.rejects(
      child.client.readRepository(registered.resource, 'file', { path: '../outside' }),
      (e) => e.kind === 'invalid-params',
    );
    assert.equal(hash(fs.readFileSync(path.join(repo, '.git/index'))), index);
    assert.equal(git('rev-parse', 'HEAD'), head);
    assert.equal(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'), 'preserved\n');
    proof('helpers-sdk-stdio', {
      agentId: init.agentId,
      resource: registered.resource,
      branch: status.branch,
      indexUnchanged: true,
      headUnchanged: true,
      rejected: [
        'other Agent',
        'unknown resource',
        'arbitrary execute query',
        'unregistered git.stage method',
        'outside path',
        'symlink ancestor',
        '.git',
        'absolute path',
      ],
      boundary:
        'Actual SDK and stdio state-kernel child with temporary repository/data. No remote SSH transport or machine claim.',
    });
  } finally {
    await child.close();
  }
});
