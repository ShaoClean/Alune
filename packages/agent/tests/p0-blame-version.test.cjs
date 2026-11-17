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
const current = require('../dist/modules/git/git-blame');
const currentError = require('../dist/modules/git/repository-files').RepositoryFileError;
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = (v) => createHash('sha256').update(v).digest('hex');
const plain = (v) => JSON.parse(JSON.stringify(v));
const revision = 'a'.repeat(40);
const limitMessage = '文件超过逐行追溯上限（256 KB 或 5000 行），请在终端使用 git blame。';
function proof(name, value) {
  if (process.env.P0_BLAME_VERSION_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_BLAME_VERSION_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function frozen() {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const file = 'packages/ssh-client/src/' + name + '.ts';
    const source = fs.readFileSync(path.join(process.env.P0_BLAME_VERSION_FROZEN, file), 'utf8');
    assert.equal(
      source,
      execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }),
    );
    const module = { exports: {} };
    cache.set(name, module.exports);
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
        AbortSignal,
        AbortController,
        setTimeout,
        clearTimeout,
        require(id) {
          if (id === 'util' || id.startsWith('node:')) return require(id);
          if (id === '@alune/shared') return require('@alune/domain');
          assert(
            [
              './repository-files',
              './repository-transport',
              './git-shell',
              './repository-path',
              './sftp-file',
              './lfs',
            ].includes(id),
            'Unexpected dependency: ' + id,
          );
          return load(id.slice(2));
        },
      },
      { filename: file },
    );
    cache.set(name, module.exports);
    return module.exports;
  }
  return {
    Api: load('git-blame').GitBlame,
    FileError: load('repository-files').RepositoryFileError,
  };
}
const versions = () => [
  ['frozen', frozen()],
  ['current', { Api: current.GitBlame, FileError: currentError }],
];
function porcelain(content, file = 'file.txt') {
  const lines = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '')
    .split('\n');
  return lines
    .map(
      (text, i) =>
        `${revision} ${i + 1} ${i + 1}\nauthor Fixture\nauthor-mail <test@example.invalid>\nauthor-time 1700000000\nsummary exact subject\nfilename ${file}\n\t${text}\n`,
    )
    .join('');
}
function scripted(options = {}) {
  const trace = [],
    bytes = options.bytes ?? Buffer.from('one\ntwo\n');
  const connection = {
    trace,
    withSftp: options.withSftp ?? ((fn) => fn(fs)),
    async execGit(repo, args, signal, commandOptions) {
      trace.push({
        repo,
        args: [...args],
        options: commandOptions,
        signalAborted: signal?.aborted,
      });
      signal?.throwIfAborted();
      if (options.execute) return options.execute(args, signal, commandOptions);
      if (args[0] === 'ls-tree')
        return {
          exitCode: 0,
          stdout: options.tree ?? `100644 blob ${revision}\tfile.txt\0`,
          stderr: '',
        };
      if (args[0] === 'cat-file' && args[1] === '-s')
        return { exitCode: 0, stdout: String(options.size ?? bytes.length), stderr: '' };
      if (args[0] === 'cat-file')
        return { exitCode: 0, stdout: bytes.toString(), stdoutBytes: bytes, stderr: '' };
      if (args[0] === 'rev-parse')
        return { exitCode: options.headCode ?? 0, stdout: revision, stderr: 'HEAD denied' };
      if (args[0] === 'ls-files')
        return { exitCode: 0, stdout: options.tracked === false ? '' : 'file.txt\0', stderr: '' };
      assert(args.includes('blame'), JSON.stringify(args));
      return { exitCode: 0, stdout: options.porcelain ?? porcelain(bytes.toString()), stderr: '' };
    },
  };
  return connection;
}
const call = (api, repo, options, signal = new AbortController().signal) =>
  api.readVersion(repo, options, signal);
test('P0 blame version historical modes byte and line limits encodings and exact argv match frozen baseline', async () => {
  const cases = [
    { label: 'absent', tree: '', message: '此版本没有可追溯的普通文件。', commands: 1 },
    {
      label: 'symlink',
      tree: `120000 blob ${revision}\tfile.txt\0`,
      message: '此版本没有可追溯的普通文件。',
      commands: 1,
    },
    {
      label: 'tree',
      tree: `040000 tree ${revision}\tdir\0`,
      message: '此版本没有可追溯的普通文件。',
      commands: 1,
    },
    {
      label: 'submodule',
      tree: `160000 commit ${revision}\tsub\0`,
      message: '此版本没有可追溯的普通文件。',
      commands: 1,
    },
    { label: 'oversize', size: 262145, message: limitMessage, commands: 2 },
    {
      label: 'binary',
      bytes: Buffer.from([0, 1, 2]),
      message: '二进制文件及非 UTF-8 文件暂不支持逐行追溯。',
      commands: 3,
    },
    {
      label: 'utf16',
      bytes: Buffer.from([255, 254, 97, 0]),
      message: '二进制文件及非 UTF-8 文件暂不支持逐行追溯。',
      commands: 3,
    },
    {
      label: 'invalid-utf8',
      bytes: Buffer.from([0xff]),
      message: '二进制文件及非 UTF-8 文件暂不支持逐行追溯。',
      commands: 3,
    },
    { label: 'empty', bytes: Buffer.alloc(0), message: '空文件没有可追溯的行。', commands: 3 },
    {
      label: 'too-many-lines',
      bytes: Buffer.from('x\n'.repeat(5001)),
      message: limitMessage,
      commands: 3,
    },
    {
      label: 'bare-CR',
      bytes: Buffer.from('a\rb\r'),
      message: '仅使用 CR 换行的文件暂不支持逐行追溯。',
      commands: 3,
    },
    { label: 'exact-byte-limit', bytes: Buffer.from('x'.repeat(262144)), commands: 4 },
    { label: 'exact-line-limit', bytes: Buffer.from('x\n'.repeat(5000)), commands: 4 },
    { label: 'executable', tree: `100755 blob ${revision}\tfile.txt\0`, commands: 4 },
    { label: 'CRLF', bytes: Buffer.from('one\r\ntwo\r\n'), commands: 4 },
    { label: 'no-final-newline', bytes: Buffer.from('one\ntwo'), commands: 4 },
    { label: 'UTF8-BOM', bytes: Buffer.from('\uFEFFone\ntwo\n'), commands: 4 },
  ];
  const rows = [],
    paired = new Map();
  for (const [version, { Api }] of versions())
    for (const c of cases) {
      const port = scripted(c),
        api = new Api(port);
      const result = await call(api, '/repo', {
        path: 'file.txt',
        revision,
        useIgnoreRevs: false,
        ignoreWhitespace: true,
      });
      assert.equal(port.trace.length, c.commands, c.label);
      assert.deepEqual(port.trace[0].args, ['ls-tree', '-z', revision, '--', 'file.txt']);
      if (c.commands >= 3) {
        assert.deepEqual(port.trace[1].args, ['cat-file', '-s', revision + ':file.txt']);
        assert.deepEqual(port.trace[2].args, ['cat-file', 'blob', revision + ':file.txt']);
        assert.deepEqual(plain(port.trace[2].options), { maxOutputBytes: 262144, binary: true });
      }
      if (c.message)
        assert.deepEqual(plain(result), {
          path: 'file.txt',
          revision,
          kind: 'unavailable',
          message: c.message,
        });
      else {
        assert.equal(result.kind, 'ready');
        const content = (c.bytes ?? Buffer.from('one\ntwo\n')).toString().replace(/^\uFEFF/, '');
        assert.equal(result.content, content);
        assert.equal(result.ignoreRevsApplied, false);
        assert.equal(result.version, hash(JSON.stringify([content, plain(result.lines)])));
        assert.equal(
          result.lines.length,
          c.label === 'exact-line-limit' ? 5000 : c.label === 'exact-byte-limit' ? 1 : 2,
        );
        assert.deepEqual(port.trace[3].args, [
          '-c',
          'core.quotePath=false',
          '-c',
          'blame.markIgnoredLines=true',
          '-c',
          'blame.markUnblamableLines=true',
          'blame',
          '--line-porcelain',
          '--no-textconv',
          '--encoding=UTF-8',
          '--ignore-revs-file',
          '',
          '-w',
          revision,
          '--',
          'file.txt',
        ]);
      }
      if (version === 'frozen') paired.set(c.label, plain(result));
      else assert.deepEqual(plain(result), paired.get(c.label));
      rows.push({
        version,
        case: c.label,
        kind: result.kind,
        message: result.message,
        contentHash: result.content === undefined ? undefined : hash(result.content),
        versionHash: result.version,
        lineCount: result.lines?.length,
        commands: port.trace.map((x) => ({ ...x, options: plain(x.options ?? {}) })),
      });
    }
  proof('blame-version-revision', { rows });
});
test('P0 blame version working previews reject unsupported files and preserve exact unavailable reasons', async (t) => {
  const f = createRepository();
  t.after(f.close);
  const unsupported = '二进制文件、图片、符号链接及非 UTF-8 文件暂不支持逐行追溯。';
  const cases = [
    ['binary.dat', Buffer.from([0, 1, 2]), unsupported],
    ['utf16.txt', Buffer.from([255, 254, 97, 0]), unsupported],
    ['bad.txt', Buffer.from([255]), unsupported],
    ['image.png', Buffer.from([1, 2, 3]), unsupported],
    [
      'pointer.txt',
      `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 100\n`,
      unsupported,
    ],
    ['empty.txt', '', '空文件没有可追溯的行。'],
    ['max.txt', 'x'.repeat(262145), limitMessage],
    ['preview-max.txt', 'x'.repeat(4 * 1024 * 1024 + 1), limitMessage],
    ['lines.txt', 'x\n'.repeat(5001), limitMessage],
    ['cr.txt', 'a\rb\r', '仅使用 CR 换行的文件暂不支持逐行追溯。'],
  ];
  for (const [name, bytes] of cases) f.write(name, bytes);
  fs.symlinkSync('/no-such-target', path.join(f.repo, 'link.txt'));
  const rows = [];
  for (const [version, { Api, FileError }] of versions()) {
    const port = scripted(),
      api = new Api(port);
    for (const [name, , message] of [...cases, ['link.txt', '', unsupported]]) {
      const result = await call(api, f.repo, { path: name });
      assert.deepEqual(plain(result), { path: name, kind: 'unavailable', message });
      rows.push({ version, name, result });
    }
    assert.equal(port.trace.length, 0, 'no Git dispatch for unavailable working previews');
    await assert.rejects(
      call(api, f.repo, { path: 'missing.txt' }),
      (e) => e instanceof FileError && e.statusCode === 404,
    );
    fs.mkdirSync(path.join(f.repo, 'dir'), { recursive: true });
    await assert.rejects(
      call(api, f.repo, { path: 'dir' }),
      (e) => e instanceof FileError && e.message === '此路径是目录，请在目录树中展开查看。',
    );
  }
  proof('blame-version-working', {
    rows,
    noGitForUnavailable: true,
    missing404: true,
    directoryRejected: true,
  });
});
test('P0 blame version rejects read races malformed porcelain HEAD failures and invalid ignore files', async (t) => {
  const f = createRepository();
  t.after(f.close);
  f.write('file.txt', 'one\ntwo\n');
  const rows = [];
  for (const [version, { Api, FileError }] of versions()) {
    for (const [label, output, message] of [
      ['race', porcelain('changed\ntwo\n'), '文件在读取期间发生变化，请刷新后重试。'],
      ['incomplete', `${revision} 1 1\nauthor Fixture\n`, '追溯结果不完整，请重试。'],
      [
        'line-gap',
        porcelain('one\ntwo\n').replace(`${revision} 1 1`, `${revision} 1 2`),
        '追溯行号不完整，请刷新后重试。',
      ],
    ]) {
      const port = scripted({ porcelain: output });
      await assert.rejects(
        call(new Api(port), f.repo, { path: 'file.txt', revision, useIgnoreRevs: false }),
        (e) => e instanceof FileError && e.message === message,
      );
      assert.equal(port.trace.length, 4);
      rows.push({ version, label, message });
    }
    await assert.rejects(
      call(new Api(scripted({ headCode: 128 })), f.repo, {
        path: 'file.txt',
        useIgnoreRevs: false,
      }),
      (e) => e instanceof FileError && e.message === '无法读取 HEAD：HEAD denied',
    );
    for (const [label, write] of [
      ['binary', () => f.write('.git-blame-ignore-revs', Buffer.from([0, 1]))],
      ['symlink', () => fs.symlinkSync('file.txt', path.join(f.repo, '.git-blame-ignore-revs'))],
    ]) {
      write();
      await assert.rejects(
        call(new Api(scripted()), f.repo, { path: 'file.txt', revision }),
        (e) =>
          e instanceof FileError &&
          e.message === '.git-blame-ignore-revs 必须是仓库内的 UTF-8 普通文本文件。',
      );
      fs.unlinkSync(path.join(f.repo, '.git-blame-ignore-revs'));
      rows.push({ version, label, invalidIgnoreRejected: true });
    }
    const failure = new Error('transport identity');
    await assert.rejects(
      call(
        new Api(
          scripted({
            execute() {
              throw failure;
            },
          }),
        ),
        f.repo,
        { path: 'file.txt', revision },
      ),
      (e) => e === failure,
    );
    const nonzero = scripted({
      execute() {
        return { exitCode: 1, stdout: '', stderr: ' denied \n' };
      },
    });
    await assert.rejects(
      call(new Api(nonzero), f.repo, { path: 'file.txt', revision }),
      (e) => e instanceof FileError && e.message === '无法读取追溯信息：denied',
    );
    assert.equal(nonzero.trace.length, 1);
  }
  proof('blame-version-failures', {
    rows,
    transportIdentity: true,
    nonzeroStopsWithoutRetry: true,
    trackedHeadFailure: true,
  });
});
test('P0 blame version cancellation propagates through Git and documents uncancellable file preview boundary', async (t) => {
  const f = createRepository();
  t.after(f.close);
  f.write('file.txt', 'one\ntwo\n');
  const rows = [];
  for (const [version, { Api }] of versions()) {
    const c = new AbortController(),
      reason = new Error('cancel identity');
    c.abort(reason);
    const historical = scripted();
    await assert.rejects(
      call(new Api(historical), f.repo, { path: 'file.txt', revision }, c.signal),
      (e) => e === reason,
    );
    assert.equal(historical.trace.length, 0);
    let previews = 0;
    const working = scripted({
      withSftp(fn) {
        previews++;
        return fn(fs);
      },
    });
    await assert.rejects(
      call(new Api(working), f.repo, { path: 'file.txt' }, c.signal),
      (e) => e === reason,
    );
    assert.equal(previews, 1);
    assert.equal(working.trace.length, 0);
    // Unavailable previews return before the explicit cancellation check.
    f.write('empty.txt', '');
    const empty = await call(new Api(working), f.repo, { path: 'empty.txt' }, c.signal);
    assert.equal(empty.kind, 'unavailable');
    assert.equal(previews, 2);
    const running = new AbortController();
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const port = scripted({
      execute(args, signal) {
        assert.equal(args[0], 'ls-tree');
        started();
        return new Promise((_r, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      },
    });
    const pending = call(new Api(port), f.repo, { path: 'file.txt', revision }, running.signal);
    const rejected = assert.rejects(pending, (e) => e === reason);
    await ready;
    running.abort(reason);
    await rejected;
    assert.equal(port.trace.length, 1);
    const disconnected = scripted();
    disconnected.signal = c.signal;
    await assert.rejects(
      call(new Api(disconnected), f.repo, { path: 'file.txt', revision }),
      (e) => e === reason,
    );
    assert.equal(disconnected.trace.length, 0);
    rows.push({
      version,
      historicalPreAbortZeroDispatch: true,
      workingPreviewRunsBeforeCancelCheck: true,
      unavailableCanReturnAfterAbort: true,
      runningGitAbortIdentity: true,
      connectionAbortZeroDispatch: true,
      retries: 0,
    });
  }
  proof('blame-version-cancellation', {
    rows,
    boundary:
      'readVersion is private; public SDK rejects pre-aborted requests. Direct file previews have no AbortSignal and can complete before explicit check. No rollback or guaranteed rejection of every unavailable preview claimed.',
  });
});
function state(f) {
  const files = {};
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files[path.relative(f.root, p)] = hash(fs.readFileSync(p));
      else if (e.isSymbolicLink())
        files[path.relative(f.root, p)] = 'symlink:' + fs.readlinkSync(p);
    }
  }
  walk(f.repo);
  if (f.linked) walk(f.linked);
  return { head: f.git('rev-parse', 'HEAD').trim(), refs: f.git('show-ref'), files };
}
test('P0 blame version unborn untracked staged and tracked lines preserve content and version semantics', async (t) => {
  const f = createRepository({ initial: false });
  t.after(f.close);
  const rows = [];
  for (const stage of ['unborn', 'unborn-staged', 'tracked', 'untracked', 'staged-new']) {
    const name = stage === 'untracked' || stage === 'staged-new' ? 'new.txt' : 'file.txt';
    f.write(name, '\uFEFFone\r\ntwo');
    if (stage === 'unborn-staged' || stage === 'staged-new') f.git('add', '--', name);
    if (stage === 'tracked') f.git('commit', '-qm', 'initial');
    for (const [version, { Api }] of versions()) {
      const before = stage.startsWith('unborn') ? null : state(f);
      const result = await call(new Api(new NativeRepositoryConnection()), f.repo, {
        path: name,
        useIgnoreRevs: false,
      });
      assert.equal(result.kind, 'ready');
      assert.equal(result.content, 'one\r\ntwo');
      assert.equal(result.lines.length, 2);
      assert.equal(result.ignoreRevsApplied, false);
      if (['unborn', 'unborn-staged', 'untracked'].includes(stage)) {
        assert.equal(result.version, hash('one\r\ntwo'));
        assert.equal(result.notice, '新文件尚无提交记录，所有行均为未提交的改动。');
        assert.deepEqual(
          plain(result.lines),
          [1, 2].map((n) => ({
            line: n,
            originalLine: n,
            hash: '0'.repeat(40),
            path: name,
            uncommitted: true,
          })),
        );
      } else {
        assert.equal(
          result.lines[0].hash,
          stage === 'tracked' ? f.git('rev-parse', 'HEAD').trim() : '0'.repeat(40),
        );
        assert.equal(result.version, hash(JSON.stringify([result.content, plain(result.lines)])));
      }
      if (before) assert.deepEqual(state(f), before);
      rows.push({ version, stage, result });
    }
  }
  proof('blame-version-new-files', { rows });
});
function setup(f) {
  const oldName = "中文 '$().txt",
    name = "重命名 '$().txt";
  f.write(oldName, 'one\ntwo\nthree\nfour\nfive\nsix\n');
  f.git('add', '--', oldName);
  f.git('commit', '-qm', 'original');
  const first = f.git('rev-parse', 'HEAD').trim();
  f.git('mv', '--', oldName, name);
  f.write(name, '  one\nTWO\nthree\nfour\nfive\nsix\n');
  f.git('commit', '-qam', 'format and rename');
  const second = f.git('rev-parse', 'HEAD').trim();
  f.linked = path.join(f.root, "linked '$() tree");
  f.git('worktree', 'add', '--detach', '-q', f.linked, second);
  f.write(name, '  one\nTWO\nthree\nfour\nfive\nsix\nworking\n');
  f.write('.git-blame-ignore-revs', second + '\n');
  f.write('tracked.txt', 'staged\n');
  f.git('add', '--', 'tracked.txt');
  f.write('tracked.txt', 'unstaged\n');
  f.write('loose.txt', 'untracked\n');
  return { oldName, name, first, second };
}
// Git assigns its current wall clock to the synthetic uncommitted commit.
// Validate that timestamp per call; retain raw values in evidence while comparing
// every stable field (including version, lines and committed timestamps) exactly.
function comparable(result, startedAt, finishedAt) {
  const value = plain(result);
  const uncommitted = value.commits?.['0'.repeat(40)];
  if (uncommitted) {
    const time = Date.parse(uncommitted.date);
    assert(Number.isFinite(time));
    assert(time >= startedAt - 1000 && time <= finishedAt);
    uncommitted.date = '<validated Git wall clock>';
  }
  return value;
}
async function real(t, ssh) {
  const f = createRepository();
  let remote;
  t.after(async () => {
    await remote?.close();
    f.close();
  });
  const info = setup(f);
  if (ssh) remote = await connectFixture(f);
  const connection = ssh ? remote.connection : new NativeRepositoryConnection(),
    before = state(f),
    rows = [],
    paired = new Map();
  for (const [version, { Api }] of versions())
    for (const repo of [f.repo, f.linked]) {
      const api = new Api(connection);
      for (const options of [
        { path: info.name, useIgnoreRevs: false },
        { path: info.name, ignoreWhitespace: true, useIgnoreRevs: false },
        { path: info.name },
        { path: info.oldName, revision: info.first, useIgnoreRevs: false },
        { path: info.name, revision: info.second, useIgnoreRevs: false },
      ]) {
        const startedAt = Date.now();
        const result = await call(api, repo, options);
        const stable = comparable(result, startedAt, Date.now());
        assert.equal(result.kind, 'ready');
        assert.equal(result.ignoreRevsApplied, options.useIgnoreRevs !== false && repo === f.repo);
        if (!options.revision) {
          assert.equal(
            result.lines[0].hash,
            options.ignoreWhitespace || result.ignoreRevsApplied ? info.first : info.second,
          );
          if (repo === f.repo) assert.equal(result.lines.at(-1).uncommitted, true);
        }
        const cliArgs = [
          '-c',
          'blame.markIgnoredLines=true',
          '-c',
          'blame.markUnblamableLines=true',
          'blame',
          '--line-porcelain',
          '--no-textconv',
          '--encoding=UTF-8',
          '--ignore-revs-file',
          '',
          ...(options.ignoreWhitespace ? ['-w'] : []),
          ...(result.ignoreRevsApplied ? ['--ignore-revs-file', '.git-blame-ignore-revs'] : []),
          ...(options.revision ? [options.revision] : []),
          '--',
          options.path,
        ];
        const output = execFileSync('git', ['-C', repo, ...cliArgs], {
          encoding: 'utf8',
          env: {
            ...process.env,
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_OPTIONAL_LOCKS: '0',
            LC_ALL: 'C',
          },
        });
        const cliHashes = [...output.matchAll(/^([a-f0-9]{40}) \d+ \d+(?: \d+)?$/gm)].map(
          (m) => m[1],
        );
        assert.deepEqual(plain(result.lines.map((line) => line.hash)), cliHashes);
        const expected = options.revision
          ? f.git('show', options.revision + ':' + options.path)
          : fs.readFileSync(path.join(repo, options.path), 'utf8');
        assert.equal(result.content, expected);
        assert.equal(result.version, hash(JSON.stringify([expected, plain(result.lines)])));
        const key = JSON.stringify([repo, options]);
        if (version === 'frozen') paired.set(key, stable);
        else assert.deepEqual(stable, paired.get(key));
        rows.push({ version, repo, options, result, cliHashes });
      }
    }
  assert.deepEqual(state(f), before);
  proof(ssh ? 'blame-version-real-ssh' : 'blame-version-real-native', {
    rows,
    before,
    after: state(f),
    unchanged: true,
    boundary: ssh
      ? 'Encrypted ssh2 loopback on this Mac, actual SFTP plus Git historical binary transport; no external host claim'
      : 'Native Git and disk, main and detached linked worktree, index and all ordinary Git/worktree bytes and symlink targets unchanged',
  });
}
test('P0 blame version frozen and current real native reads match Git and preserve main linked repository bytes', async (t) => {
  await real(t, false);
});
test('P0 blame version frozen and current real SSH reads match Git and preserve main linked repository bytes', async (t) => {
  await real(t, true);
});
test('P0 blame version actual SDK stdio enforces resource ownership typed query and private helper isolation', async (t) => {
  const { spawnAgent } = require('@alune/agent-client/node');
  const f = createRepository();
  t.after(f.close);
  const info = setup(f);
  const child = spawnAgent(
    process.execPath,
    [path.join(__dirname, 'settings-fixture.cjs'), path.join(f.root, 'state')],
    {
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
    },
  );
  t.after(() => child.close());
  try {
    const init = await child.client.initialize(),
      { resource } = await child.client.registerRepository(f.repo);
    assert.equal(resource.agentId, init.agentId);
    const before = state(f),
      results = [];
    for (const params of [
      { path: info.name },
      { path: info.oldName, revision: info.first, useIgnoreRevs: false },
    ]) {
      const startedAt = Date.now();
      const result = await child.client.readRepository(resource, 'blame', params);
      const stable = comparable(result, startedAt, Date.now());
      const directStartedAt = Date.now();
      const direct = await new current.GitBlame(new NativeRepositoryConnection()).read(
        f.repo,
        params,
      );
      assert.deepEqual(stable, comparable(direct, directStartedAt, Date.now()));
      assert.equal(result.kind, 'ready');
      results.push(result);
    }
    for (const foreign of [
      { ...resource, agentId: randomUUID() },
      { ...resource, resourceId: randomUUID() },
    ])
      await assert.rejects(
        child.client.readRepository(foreign, 'blame', { path: info.name }),
        (e) => e.kind === 'not-found',
      );
    for (const params of [
      { path: '../outside' },
      { path: '.git/config' },
      { path: info.name, revision: '--help' },
      { path: info.name, args: ['show'] },
      { path: info.name, previousLine: 0 },
    ])
      await assert.rejects(
        child.client.request('repositories.read', { resource, kind: 'blame', params }),
      );
    await assert.rejects(
      child.client.request('gitBlame.readVersion', {}),
      (e) => e.kind === 'unknown-method',
    );
    await assert.rejects(
      child.client.request('repositories.read', {
        resource,
        kind: 'execute',
        params: { args: ['show'] },
      }),
      (e) => e.kind === 'invalid-params',
    );
    const c = new AbortController();
    c.abort();
    await assert.rejects(
      child.client.readRepository(resource, 'blame', { path: info.name }, { signal: c.signal }),
      (e) => e.kind === 'cancelled',
    );
    assert.deepEqual(state(f), before);
    proof('blame-version-sdk', {
      resource,
      results,
      foreignAgentAndResourceRejected: true,
      invalidQueriesRejected: true,
      helperRPCRejected: true,
      preAbortedRejected: true,
      before,
      after: state(f),
      unchanged: true,
    });
  } finally {
    await child.close();
  }
});
