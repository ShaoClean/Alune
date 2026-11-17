const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');
const { NativeRepositoryConnection } = require('../dist/adapters/git/native');
const current = {
  ...require('../dist/modules/git/workspace-file-actions'),
  ...require('../dist/modules/git/repository-files'),
};
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = (v) => createHash('sha256').update(v).digest('hex');
const digest = (v) => hash(JSON.stringify(v));
const plain = (v) => JSON.parse(JSON.stringify(v));
function proof(name, value) {
  if (process.env.P0_WORKSPACE_HELPERS_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_WORKSPACE_HELPERS_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function loaded(version, timeouts) {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    if (version === 'current' && name !== 'workspace-file-actions')
      return require('../dist/modules/git/' + name);
    const file =
      version === 'frozen'
        ? 'packages/ssh-client/src/' + name + '.ts'
        : 'packages/agent/src/modules/git/' + name + '.ts';
    const source = fs.readFileSync(
      path.join(version === 'frozen' ? process.env.P0_WORKSPACE_HELPERS_FROZEN : root, file),
      'utf8',
    );
    if (version === 'frozen')
      assert.equal(
        source,
        execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }),
      );
    const module = { exports: {} };
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
        process,
        AbortSignal: timeouts
          ? {
              timeout(ms) {
                timeouts.push(ms);
                return AbortSignal.timeout(ms);
              },
              any: AbortSignal.any.bind(AbortSignal),
            }
          : AbortSignal,
        require(id) {
          if (id.startsWith('node:') || id === 'util') return require(id);
          if (id === '@alune/shared') return require('@alune/domain');
          if (id === './lfs')
            return {
              GitLfs: class {
                constructor() {
                  throw Error('LFS outside helper scope');
                }
              },
            };
          assert(
            [
              './repository-files',
              './repository-path',
              './repository-transport',
              './git-shell',
              './sftp-file',
            ].includes(id),
            'Unexpected dependency ' + id,
          );
          return load(id.slice(2));
        },
      },
      { filename: file },
    );
    cache.set(name, module.exports);
    return module.exports;
  }
  return { ...load('workspace-file-actions'), ...load('repository-files') };
}
function versions() {
  return [
    ['frozen', loaded('frozen')],
    ['current', current],
  ];
}
const missing = (code = 2) => Object.assign(new Error('missing'), { code });
function stat(kind = 'file', changes = {}) {
  return {
    mode: kind === 'link' ? 0o120777 : kind === 'directory' ? 0o040755 : 0o100644,
    size: 5,
    mtime: 100,
    uid: 1,
    gid: 2,
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
    isSymbolicLink: () => kind === 'link',
    ...changes,
  };
}
function port(options = {}) {
  const trace = [],
    bytes = options.bytes ?? Buffer.from([0, 255, 3, 7, 11]),
    handle = Buffer.from('handle');
  let targetStats = 0;
  const sftp = {
    trace,
    realpath(p, cb) {
      assert.equal(this, sftp);
      trace.push(['realpath', p]);
      cb(null, options.realpath ? options.realpath(p) : p === '/alias' ? '/repo' : p);
    },
    lstat(p, cb) {
      assert.equal(this, sftp);
      trace.push(['lstat', p]);
      if (p.endsWith('/.git'))
        return cb(options.nestedError ?? (options.nested ? null : missing()), stat('file'));
      if (p === options.target || p === '/repo/a/file') {
        targetStats++;
        if (options.targetError) return cb(options.targetError);
        return cb(null, stat(options.kind, targetStats > 1 ? options.after : undefined));
      }
      if (options.ancestorError) return cb(options.ancestorError);
      cb(null, stat(options.ancestorKind ?? 'directory'));
    },
    readlink(p, cb) {
      assert.equal(this, sftp);
      trace.push(['readlink', p]);
      cb(options.linkError ?? null, options.link ?? '../outside');
    },
    open(p, flags, cb) {
      assert.equal(this, sftp);
      trace.push(['open', p, flags]);
      cb(options.openError ?? null, handle);
    },
    read(h, b, o, l, p, cb) {
      assert.equal(this, sftp);
      assert.equal(h, handle);
      trace.push(['read', p, l]);
      if (options.readError) return cb(options.readError);
      options.onRead?.();
      const n = Math.min(options.chunk ?? 65536, l, bytes.length - p);
      bytes.copy(b, o, p, p + n);
      cb(null, n, b);
    },
    close(h, cb) {
      assert.equal(this, sftp);
      assert.equal(h, handle);
      trace.push(['close']);
      cb(options.closeError ?? null);
    },
  };
  return sftp;
}
function recording(api, options = {}) {
  const sftp = port(options),
    calls = [],
    connection = {
      signal: options.signal,
      async execGit(repo, args, signal) {
        assert.equal(this, connection);
        calls.push([repo, [...args]]);
        assert(signal instanceof AbortSignal);
        signal.throwIfAborted();
        if (options.gitError) throw options.gitError;
        if (args[0] === 'rev-parse')
          return { exitCode: 0, stdout: options.prefix ?? '', stderr: '' };
        if (args[0] === 'ls-files')
          return {
            exitCode: 0,
            stdout:
              args.at(-1) === 'a'
                ? (options.parents ?? '')
                : (options.index ?? '100644 aaaa 0\ta/file\0'),
            stderr: '',
          };
        assert.equal(args[0], 'diff');
        return { exitCode: 0, stdout: options.staged ? 'a/file\0' : '', stderr: '' };
      },
      withSftp(op) {
        calls.push(['sftp']);
        if (options.sftpError) throw options.sftpError;
        return op(sftp);
      },
    };
  return { actions: new api.WorkspaceFileActions(connection), calls, sftp };
}

test('P0 workspace helpers git preserves exact argv timeout stdout errors and predispatch cancellation', async () => {
  const rows = [];
  for (const version of ['frozen', 'current']) {
    const timeouts = [],
      api = loaded(version, timeouts),
      rootName = "/repo ' 中文 $()",
      args = ['ls-files', '--stage', '-z', '--', '*literal\nname'];
    let result = { exitCode: 0, stdout: ' raw\0中文\n ', stderr: 'ignored' },
      calls = 0,
      received;
    const connection = {
      async execGit(repo, argv, signal) {
        assert.equal(this, connection);
        assert.equal(repo, rootName);
        assert.equal(argv, args);
        assert(signal instanceof AbortSignal);
        received = signal;
        calls++;
        return result;
      },
    };
    const action = new api.WorkspaceFileActions(connection);
    assert.equal(await action.git(rootName, args), result.stdout);
    assert.equal(received.aborted, false);
    for (const [stderr, message] of [
      ['  denied\n', 'denied'],
      [' \n', '无法核验 Git 状态'],
    ]) {
      result = { exitCode: 1, stdout: 'ignored', stderr };
      await assert.rejects(
        action.git(rootName, args),
        (e) => e.constructor === Error && e.message === message,
      );
    }
    const original = new Error('transport original');
    connection.execGit = async () => {
      calls++;
      throw original;
    };
    await assert.rejects(action.git(rootName, args), (e) => e === original);
    const controller = new AbortController();
    controller.abort(original);
    connection.signal = controller.signal;
    const before = calls;
    await assert.rejects(action.git(rootName, args), (e) => e === original);
    assert.equal(calls, before);
    assert.deepEqual(timeouts, [15000, 15000, 15000, 15000, 15000]);
    rows.push({
      version,
      root: rootName,
      args,
      timeouts,
      calls,
      abortedDispatches: 0,
      rawStdoutPreserved: true,
    });
  }
  proof('workspace-git', rows);
});

test('P0 workspace helpers parent validates canonical ancestors nested metadata and error identity', async () => {
  const rows = [];
  for (const [version, api] of versions()) {
    const a = new api.WorkspaceFileActions({}),
      sftp = port();
    assert.deepEqual(plain(await a.parent(sftp, '/alias', 'a/file')), {
      root: '/repo',
      target: '/repo/a/file',
    });
    assert.deepEqual(sftp.trace, [
      ['realpath', '/alias'],
      ['lstat', '/repo/a'],
      ['lstat', '/repo/a/.git'],
      ['realpath', '/repo/a'],
    ]);
    for (const bad of [
      '',
      '../outside',
      '/outside',
      'a/../file',
      '.git/config',
      'a/.git/config',
      'bad\0path',
    ]) {
      const p = port();
      await assert.rejects(a.parent(p, '/repo', bad), (e) => e instanceof api.RepositoryFileError);
      assert.equal(p.trace.length, 0);
    }
    for (const [options, pattern] of [
      [{ ancestorKind: 'link' }, /符号链接/],
      [{ ancestorKind: 'file' }, /不是目录/],
      [{ nested: true }, /嵌套仓库/],
      [{ realpath: (p) => (p === '/repo/a' ? '/changed' : p) }, /父目录发生变化/],
    ]) {
      await assert.rejects(
        a.parent(port(options), '/repo', 'a/file'),
        (e) => e.statusCode === 409 && pattern.test(e.message),
      );
    }
    for (const code of [2, 'ENOENT'])
      await a.parent(port({ nestedError: missing(code) }), '/repo', 'a/file');
    for (const which of ['ancestorError', 'nestedError']) {
      const error = Object.assign(new Error(which), { code: 'EACCES' });
      await assert.rejects(
        a.parent(port({ [which]: error }), '/repo', 'a/file'),
        (e) => e === error,
      );
    }
    const realError = new Error('realpath error');
    await assert.rejects(
      a.parent(
        {
          realpath(_p, cb) {
            cb(realError);
          },
        },
        '/repo',
        'a/file',
      ),
      (e) => e === realError,
    );
    for (const repo of ['C:/Repo', '//server/Share']) {
      const p = port({ realpath: (x) => (x === repo ? x : x.toLowerCase()) });
      assert.equal((await a.parent(p, repo, 'a/file')).target, repo + '/a/file');
    }
    await assert.rejects(
      a.parent(port({ realpath: (p) => (p === '/repo/a' ? '/repo/A' : p) }), '/repo', 'a/file'),
      /父目录发生变化/,
    );
    const alias = 'a/.g\u200cit/config',
      p = port();
    if (version === 'current') {
      await assert.rejects(a.parent(p, '/repo', alias), /Git 元数据/);
      assert.equal(p.trace.length, 0);
    } else await a.parent(p, '/repo', alias);
    rows.push({
      version,
      canonicalTrace: sftp.trace,
      invalidPathsRejectedBeforeIO: true,
      ancestorRefusals: ['symlink', 'file', 'nested .git', 'realpath changed'],
      originalErrors: true,
      windowsAndUNC: 'recording ports only',
      metadataAlias: version === 'current' ? 'refused before IO' : 'baseline permitted',
    });
  }
  proof('workspace-parent', rows);
});

test('P0 workspace helpers inspect preserves exact index staged bytes attributes token and refusals', async () => {
  const rows = [];
  for (const [version, api] of versions()) {
    for (const staged of [false, true])
      for (const kind of ['file', 'link']) {
        const f = recording(api, { staged, kind, chunk: 2 }),
          value = await f.actions.inspect('/alias', 'a/file');
        const content = kind === 'file' ? Buffer.from([0, 255, 3, 7, 11]) : '../outside';
        assert.deepEqual(plain(value), {
          path: 'a/file',
          absolutePath: '/repo/a/file',
          staged,
          canModify: true,
          token: digest([
            '/repo',
            'a/file',
            '100644 aaaa 0\ta/file\0',
            staged,
            [stat(kind).mode, 5, 100, 1, 2],
            hash(content),
          ]),
        });
        assert.deepEqual(f.calls, [
          ['/alias', ['rev-parse', '--show-prefix']],
          ['/alias', ['ls-files', '--stage', '-z', '--', 'a']],
          ['/alias', ['ls-files', '--stage', '-z', '--', 'a/file']],
          ['/alias', ['diff', '--cached', '--name-only', '-z', '--', 'a/file']],
          ['sftp'],
        ]);
        if (kind === 'file')
          assert.deepEqual(
            f.sftp.trace.filter((e) => ['open', 'read', 'close'].includes(e[0])),
            [
              ['open', '/repo/a/file', 'r'],
              ['read', 0, 65536],
              ['read', 2, 65536],
              ['read', 4, 65536],
              ['read', 5, 65536],
              ['close'],
            ],
          );
        else assert.equal(f.sftp.trace.filter((e) => e[0] === 'open').length, 0);
        rows.push({ version, kind, staged, value, calls: f.calls, trace: f.sftp.trace });
      }
    for (const code of [2, 'ENOENT']) {
      const f = recording(api, { targetError: missing(code) }),
        v = await f.actions.inspect('/alias', 'a/file');
      assert.deepEqual(plain(v), {
        path: 'a/file',
        absolutePath: '/repo/a/file',
        staged: false,
        canModify: false,
        reason: '工作区文件已不存在。',
        token: '',
      });
    }
    for (const options of [
      { kind: 'directory' },
      { kind: 'special' },
      { index: '160000 hash 0\ta/file\0' },
    ]) {
      const f = recording(api, options),
        v = await f.actions.inspect('/alias', 'a/file');
      assert.equal(v.canModify, false);
      assert.equal(v.token, '');
      assert.match(v.reason, /普通文件/);
      assert.equal(f.sftp.trace.filter((e) => e[0] === 'open').length, 0);
    }
    const prefix = recording(api, { prefix: 'sub/\n' });
    await assert.rejects(prefix.actions.inspect('/repo', 'a/file'), /仓库根目录/);
    assert.equal(prefix.calls.length, 1);
    const module = recording(api, { parents: '160000 abc 0\ta\0' });
    await assert.rejects(module.actions.inspect('/repo', 'a/file'), /子模块/);
    assert.equal(module.calls.length, 2);
    const notParent = recording(api, { parents: '160000 abc 0\tother\0' });
    assert.equal((await notParent.actions.inspect('/repo', 'a/file')).canModify, true);
    const race = recording(api, { after: { mtime: 101 } });
    await assert.rejects(race.actions.inspect('/repo', 'a/file'), /读取期间发生变化/);
    assert.equal(race.sftp.trace.at(-2)[0], 'close');
    const first = await recording(api).actions.inspect('/repo', 'a/file'),
      second = await recording(api, { bytes: Buffer.from('other') }).actions.inspect(
        '/repo',
        'a/file',
      );
    assert.notEqual(first.token, second.token);
    for (const key of [
      'gitError',
      'sftpError',
      'targetError',
      'openError',
      'readError',
      'closeError',
      'linkError',
    ]) {
      const error = new Error(key),
        f = recording(api, { [key]: error, ...(key === 'linkError' ? { kind: 'link' } : {}) });
      await assert.rejects(f.actions.inspect('/repo', 'a/file'), (e) => e === error);
    }
    const ctl = new AbortController(),
      reason = new Error('cancel after read');
    const aborted = recording(api, { signal: ctl.signal, onRead: () => ctl.abort(reason) });
    await assert.rejects(aborted.actions.inspect('/repo', 'a/file'), (e) => e === reason);
    assert.equal(aborted.sftp.trace.at(-1)[0], 'close');
    rows.push({
      version,
      missingCodes: [2, 'ENOENT'],
      unsupportedNoRead: true,
      prefixAndGitlinkBeforeSftp: true,
      exactTokens: true,
      sameAttributesDifferentContentChangesToken: true,
      readTimeAttributesRejected: true,
      abortedReadClosed: true,
      errorIdentity: true,
    });
  }
  proof('workspace-inspect', rows);
});

test('P0 workspace helpers guard preserves completion identity maps all failures and never retries', async () => {
  const rows = [];
  for (const [version, api] of versions()) {
    const a = new api.WorkspaceFileActions({}),
      value = {},
      received = [];
    let complete,
      settled = false;
    const pending = a
      .guard(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .then((v) => {
        settled = true;
        return v;
      });
    await new Promise(setImmediate);
    assert.equal(settled, false);
    complete(value);
    assert.equal(await pending, value);
    const original = new api.RepositoryFileError('original', 409);
    await assert.rejects(
      a.guard(async () => {
        throw original;
      }),
      (e) => e === original,
    );
    for (const code of [2, 'ENOENT', 3, 'EACCES', 'EPERM', 'EIO', undefined])
      for (const asError of [true, false]) {
        const error = asError ? Object.assign(new Error('original failure'), { code }) : { code };
        const message = [2, 'ENOENT'].includes(code)
          ? '文件或父目录已消失，请刷新。'
          : [3, 'EACCES', 'EPERM'].includes(code)
            ? '没有修改此文件的权限：' + (asError ? 'original failure' : '权限被拒绝')
            : asError
              ? 'original failure'
              : '连接或文件操作失败';
        let calls = 0;
        await assert.rejects(
          a.guard(() => {
            calls++;
            throw error;
          }),
          (e) =>
            e instanceof api.RepositoryFileError &&
            e.statusCode === 502 &&
            e.message === `操作未完成：${message}。请刷新并核对文件状态；暂存内容未被此操作修改。`,
        );
        assert.equal(calls, 1);
        received.push({ code, asError, message, calls });
      }
    for (const error of [null, 'string', new Error('')]) {
      const message = error instanceof Error ? '' : '连接或文件操作失败';
      await assert.rejects(
        a.guard(async () => {
          throw error;
        }),
        (e) =>
          e.statusCode === 502 &&
          e.message === `操作未完成：${message}。请刷新并核对文件状态；暂存内容未被此操作修改。`,
      );
    }
    if (version === 'current') {
      const stale = new api.StaleWorkspaceFilePreview();
      await assert.rejects(
        a.guard(async () => {
          throw stale;
        }),
        (e) => e === stale,
      );
    }
    rows.push({
      version,
      awaited: true,
      resultIdentity: true,
      repositoryErrorIdentity: true,
      matrix: received,
      staleType:
        version === 'current'
          ? 'typed identity preserved'
          : 'baseline uses RepositoryFileError 409',
    });
  }
  proof('workspace-guard', rows);
});

async function real(t, remote) {
  const f = createRepository();
  t.after(f.close);
  const ssh = remote ? await connectFixture(f) : null;
  if (ssh) t.after(ssh.close);
  const connection = ssh?.connection ?? new NativeRepositoryConnection(),
    rows = [];
  f.write("deep/中文 '$()' [*].bin", Buffer.from([0, 255, 3, 7, 11]));
  f.git('add', '--', "deep/中文 '$()' [*].bin");
  f.write('nested/.git', 'gitdir: elsewhere');
  f.write('nested/file', 'keep');
  fs.symlinkSync(f.root, path.join(f.repo, 'outside-link'));
  fs.symlinkSync('deep', path.join(f.repo, 'inside-link'));
  fs.symlinkSync(f.repo, path.join(f.root, 'root-alias'));
  const before = hash(fs.readFileSync(path.join(f.repo, '.git/index'))),
    head = f.git('rev-parse', 'HEAD');
  for (const [version, api] of versions()) {
    const a = new api.WorkspaceFileActions(connection),
      name = "deep/中文 '$()' [*].bin",
      v = await a.preview(path.join(f.root, 'root-alias'), name);
    assert.equal(v.canModify, true);
    assert.equal(v.staged, true);
    assert.equal(v.absolutePath, path.join(fs.realpathSync(f.repo), name));
    assert.match(v.token, /^[a-f0-9]{64}$/);
    const link = await a.preview(f.repo, 'outside-link');
    assert.equal(link.canModify, true);
    assert.equal((await a.preview(f.repo, 'missing')).canModify, false);
    for (const bad of [
      'outside-link/outside',
      'inside-link/nope',
      'nested/file',
      '.git/config',
      '../outside',
    ])
      await assert.rejects(a.preview(f.repo, bad));
    assert.equal(hash(fs.readFileSync(path.join(f.repo, '.git/index'))), before);
    assert.equal(f.git('rev-parse', 'HEAD'), head);
    assert.deepEqual(fs.readFileSync(path.join(f.repo, name)), Buffer.from([0, 255, 3, 7, 11]));
    rows.push({
      version,
      preview: plain(v),
      linkPreview: plain(link),
      indexSha256: before,
      head: head.trim(),
      unchanged: true,
    });
  }
  proof(remote ? 'workspace-real-ssh' : 'workspace-real-native', {
    rows,
    boundary: remote
      ? 'Real encrypted ssh2 loopback SFTP and Git over isolated local repository; no remote deployment claim'
      : 'Actual native argv and fs ports in isolated temporary repository',
  });
}
test('P0 workspace helpers frozen and current real native previews preserve index bytes and canonical boundaries', async (t) => {
  await real(t, false);
});
test(
  'P0 workspace helpers frozen and current real SSH previews preserve index bytes and canonical boundaries',
  { timeout: 60000 },
  async (t) => {
    await real(t, true);
  },
);

test('P0 workspace helpers actual SDK stdio enforces preview ownership resource paths and preserves index', async (t) => {
  const { spawnAgent } = require('@alune/agent-client/node'),
    f = createRepository();
  t.after(f.close);
  const child = spawnAgent(process.execPath, [
    path.join(__dirname, 'settings-fixture.cjs'),
    path.join(f.root, 'state'),
  ]);
  t.after(() => child.close());
  try {
    const init = await child.client.initialize(),
      registered = await child.client.registerRepository(f.repo);
    assert.equal(registered.resource.agentId, init.agentId);
    const before = hash(fs.readFileSync(path.join(f.repo, '.git/index'))),
      head = f.git('rev-parse', 'HEAD');
    const preview = await child.client.readRepository(registered.resource, 'previewWorkspaceFile', {
      path: 'tracked.txt',
    });
    assert.equal(preview.canModify, true);
    assert.match(preview.token, /^[a-f0-9]{64}$/);
    assert.equal(preview.staged, false);
    for (const resource of [
      { ...registered.resource, agentId: randomUUID() },
      { ...registered.resource, resourceId: randomUUID() },
    ])
      await assert.rejects(
        child.client.readRepository(resource, 'previewWorkspaceFile', { path: 'tracked.txt' }),
        (e) => e.kind === 'not-found',
      );
    for (const bad of ['../outside', '.git/config', '/etc/passwd'])
      await assert.rejects(
        child.client.readRepository(registered.resource, 'previewWorkspaceFile', { path: bad }),
        (e) => e.kind === 'invalid-params',
      );
    fs.symlinkSync(f.root, path.join(f.repo, 'outside-link'));
    await assert.rejects(
      child.client.readRepository(registered.resource, 'previewWorkspaceFile', {
        path: 'outside-link/outside',
      }),
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
      child.client.request('workspaceFileActions.guard', {}),
      (e) => e.kind === 'unknown-method',
    );
    assert.equal(hash(fs.readFileSync(path.join(f.repo, '.git/index'))), before);
    assert.equal(f.git('rev-parse', 'HEAD'), head);
    assert.equal(fs.readFileSync(path.join(f.repo, 'tracked.txt'), 'utf8'), 'original\n');
    proof('workspace-sdk-stdio', {
      resource: registered.resource,
      preview,
      indexSha256: before,
      head: head.trim(),
      unchanged: true,
      rejected: [
        'foreign agent',
        'unknown resource',
        'traversal',
        'metadata',
        'absolute path',
        'symlink ancestor',
        'arbitrary Git read',
        'helper RPC',
      ],
      boundary:
        'Actual SDK/stdio query only; no public helper mutation RPC added; write/cancel/unknown covered separately by companion tests.',
    });
  } finally {
    await child.close();
  }
});
