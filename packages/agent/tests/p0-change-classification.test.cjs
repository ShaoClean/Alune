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
const current = require('../dist/modules/git/change-entries');
const { parseStatus } = require('../dist/modules/git/git-status');
const { changeActions } = require('@alune/domain');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = (v) => createHash('sha256').update(v).digest('hex');
const plain = (v) => JSON.parse(JSON.stringify(v));
function proof(name, value) {
  if (process.env.P0_CHANGE_CLASSIFICATION_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_CHANGE_CLASSIFICATION_PROOF_DIR, name + '.json'),
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
      path.join(process.env.P0_CHANGE_CLASSIFICATION_FROZEN, file),
      'utf8',
    );
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
              './change-entries',
              './git-status',
              './worktrees',
              './repository-files',
              './repository-transport',
              './git-shell',
              './repository-path',
              './sftp-file',
              './lfs',
            ].includes(id),
            'Unexpected frozen dependency ' + id,
          );
          return load(id.slice(2));
        },
      },
      { filename: file },
    );
    return module.exports;
  }
  return { ...load('change-entries'), parseStatus: load('git-status').parseStatus };
}
const versions = () => [
  ['frozen', frozen()],
  ['current', { ...current, parseStatus }],
];
const dir = () => ({ isDirectory: () => true });
const other = () => ({ isDirectory: () => false });
function scripted(options = {}) {
  const trace = [],
    repo = options.repo ?? '/repo',
    canonical = options.canonical ?? '/canonical';
  const disk = options.disk ?? {};
  const connection = {
    signal: options.connectionSignal,
    async withSftp(fn) {
      trace.push({ kind: 'sftp' });
      return fn({
        realpath(value, callback) {
          trace.push({ kind: 'realpath', path: value });
          if (options.realpathError) return callback(options.realpathError);
          const actual = value === repo ? canonical : options.aliases?.[value];
          callback(
            actual instanceof Error
              ? actual
              : actual === undefined
                ? Object.assign(new Error('missing'), { code: 'ENOENT' })
                : null,
            actual,
          );
        },
        lstat(value, callback) {
          trace.push({ kind: 'lstat', path: value });
          options.onStat?.(value);
          const found = disk[value];
          callback(
            found instanceof Error
              ? found
              : !found
                ? Object.assign(new Error('absent'), { code: 'ENOENT' })
                : null,
            found instanceof Error ? undefined : found,
          );
        },
      });
    },
    async execGit(value, args, signal, commandOptions) {
      assert.equal(value, repo);
      assert.deepEqual(plain(args), ['worktree', 'list', '--porcelain', '-z']);
      assert.equal(commandOptions, undefined);
      trace.push({ kind: 'git', repo: value, args: plain(args) });
      assert.equal(trace.filter((e) => e.kind === 'git').length, 1, 'No automatic retry');
      if (options.execute) return options.execute(signal);
      if (options.gitError) throw options.gitError;
      return {
        exitCode: options.code ?? 0,
        stdout: options.stdout ?? '',
        stderr: options.stderr ?? '',
      };
    },
  };
  return { connection, trace, repo };
}
const file = (name, extra = {}) => ({
  path: name,
  kind: 'directory',
  status: 'untracked',
  staged: false,
  ...extra,
});
const list = (...items) =>
  items.map((i) => `worktree ${i.path}\0${i.extra ?? 'HEAD ' + 'a'.repeat(40)}\0\0`).join('');

test('P0 change classification special reasons preserve exact directory submodule and ordinary record semantics', () => {
  const directory = '目录或嵌套仓库，请在对应仓库中处理',
    submodule = '子模块，请在对应仓库中处理';
  const rows = [
    [
      { path: '普通.txt', kind: '1', raw: '1 .M N... 100644 100644 100644 abc def 普通.txt' },
      undefined,
    ],
    [{ path: "中文 '$()\n目录/", kind: '?', raw: '? any' }, directory],
    [{ path: 'module/', kind: '1', raw: '1 M. SC.. 160000 160000 160000 a b module/' }, directory],
    [{ path: 'file', kind: '?', raw: '? file' }, undefined],
    [{ path: 'file', kind: '?', raw: '? M. S.MU 160000 160000 160000 file' }, undefined],
    ...['SC..', 'S.M.', 'S..U', 'S.MU', 'S...', 'unknown'].map((s) => [
      { path: 'module', kind: '1', raw: `1 .M ${s} 100644 100644 100644 a b module` },
      submodule,
    ]),
    ...[3, 4, 5].map((i) => {
      const parts = ['2', 'R.', 'N...', '100644', '100644', '100644', 'a', 'b', 'R100', 'renamed'];
      parts[i] = '160000';
      return [{ path: 'renamed', kind: '2', raw: parts.join(' ') }, submodule];
    }),
    [
      { path: 'conflict', kind: 'u', raw: 'u UU N... 100644 100644 100644 100644 a b c conflict' },
      undefined,
    ],
    [{ path: 'unknown', kind: '1', raw: '1' }, submodule],
  ];
  for (const [, api] of versions())
    for (const [record, expected] of rows) {
      const before = plain(record);
      assert.equal(api.specialChangeReason(record), expected);
      assert.deepEqual(record, before);
    }
  proof('changes-special-reasons', {
    rows: rows.map(([record, expected]) => ({ record, expected: expected ?? null })),
    versions: ['frozen', 'current'],
    immutableInputs: true,
    boundary:
      'Internal parsed-record helper; malformed record fallback retained, not a public validator.',
  });
});

test('P0 change classification candidates types missing files aliases and literal paths match frozen baseline', async () => {
  const rows = [];
  for (const [version, api] of versions()) {
    const f = scripted({
      disk: {
        '/canonical/plain': dir(),
        '/canonical/nested': dir(),
        '/canonical/nested/.git': other(),
        '/canonical/tree': dir(),
        '/canonical/tree/.git': other(),
        '/canonical/sub': dir(),
        '/canonical/sub/.git': dir(),
        '/canonical/replacement': dir(),
        '/canonical/symlink': other(),
        '/canonical/regular': other(),
        '/canonical/notdir': Object.assign(new Error('notdir'), { code: 'ENOTDIR' }),
        '/canonical/numeric': Object.assign(new Error('missing'), { code: 2 }),
        "/canonical/中文 '$()\n目录": dir(),
      },
      stdout: list(
        { path: '/registered-alias' },
        { path: '/missing-sibling' },
        { path: '/bare', extra: 'bare' },
        { path: '/pruned', extra: 'prunable gone' },
      ),
      aliases: {
        '/registered-alias': '/canonical/tree',
        '/missing-sibling': Object.assign(new Error('denied'), { code: 'EACCES' }),
      },
    });
    const files = [
      file('plain/'),
      file('nested/'),
      file('tree/'),
      file('sub', { kind: 'submodule', submodule: { commitChanged: true } }),
      file('replacement', { kind: undefined, status: 'deleted' }),
      file('symlink/'),
      file('regular/'),
      file('gone/'),
      file('notdir/'),
      file('numeric/'),
      file("中文 '$()\n目录/"),
      file('ignored.txt', { kind: undefined, status: 'modified' }),
    ];
    const refs = [...files];
    const expected = plain(files);
    expected[1].kind = 'repository';
    expected[1].repositoryPath = '/canonical/nested';
    expected[2].kind = 'worktree';
    expected[2].repositoryPath = '/registered-alias';
    expected[3].repositoryPath = '/canonical/sub';
    expected[4].kind = 'directory';
    assert.equal(await api.classifyChanges(f.connection, f.repo, files), undefined);
    assert.deepEqual(plain(files), expected);
    files.forEach((v, i) =>
      assert.equal(v, refs[i], 'Mutates original records without replacing them'),
    );
    assert(!f.trace.some((e) => ['/bare', '/pruned'].includes(e.path)));
    assert(!f.trace.some((e) => e.path?.endsWith('ignored.txt')));
    assert(!f.trace.some((e) => e.path?.endsWith('symlink/.git')));
    rows.push({ version, expected, trace: f.trace });
    const windows = scripted({
      repo: 'C:/Repo',
      canonical: '/C:/Canonical',
      disk: { '/C:/Canonical/Tree': dir(), '/C:/Canonical/Tree/.git': other() },
      stdout: list({ path: 'c:/canonical/tree' }),
    });
    const entries = [file('Tree/')];
    await api.classifyChanges(windows.connection, windows.repo, entries);
    assert.deepEqual(plain(entries), [
      file('Tree/', { kind: 'worktree', repositoryPath: 'c:/canonical/tree' }),
    ]);
    rows.push({ version, windowsPathLexicalFixture: entries, trace: windows.trace });
  }
  proof('changes-classify-matrix', {
    rows,
    windowsBoundary: 'String-path normalization fixture on Mac, not a Windows platform pass.',
  });
});

test('P0 change classification errors malformed lists path validation and partial mutation never retry', async () => {
  const rows = [];
  for (const [version, api] of versions()) {
    for (const [label, options, expected] of [
      [
        'root',
        { realpathError: Object.assign(new Error('root denied'), { code: 'EACCES' }) },
        'root denied',
      ],
      [
        'stat',
        { disk: { '/canonical/a': Object.assign(new Error('stat denied'), { code: 'EACCES' }) } },
        'stat denied',
      ],
      [
        'metadata',
        {
          disk: {
            '/canonical/a': dir(),
            '/canonical/a/.git': Object.assign(new Error('metadata denied'), { code: 'EACCES' }),
          },
        },
        'metadata denied',
      ],
      ['exit', { code: 7, stderr: 'exact stderr\n' }, '无法识别 Worktree：exact stderr\n'],
      ['transport', { gitError: new Error('transport identity') }, 'transport identity'],
      [
        'truncated',
        { stdout: 'worktree /canonical/a\0HEAD a\0' },
        'Worktree 列表不完整，请刷新后重试。',
      ],
      ['malformed', { stdout: 'not-worktree\0\0' }, '无法解析 Worktree 列表。'],
    ]) {
      const f = scripted({
        disk: { '/canonical/a': dir(), '/canonical/a/.git': other() },
        ...options,
      });
      const files = [file('a/')];
      await assert.rejects(
        api.classifyChanges(f.connection, f.repo, files),
        (e) =>
          e.message === expected &&
          (!options.gitError || e === options.gitError) &&
          (!options.realpathError || e === options.realpathError),
      );
      assert(f.trace.filter((e) => e.kind === 'git').length <= 1);
      rows.push({ version, label, error: expected, files, trace: f.trace });
    }
    for (const invalid of [
      '../outside/',
      '/absolute/',
      '.git/',
      'a/../../outside/',
      'bad\0path/',
    ]) {
      const f = scripted();
      await assert.rejects(api.classifyChanges(f.connection, f.repo, [file(invalid)]));
      assert(!f.trace.some((e) => e.kind === 'lstat' || e.kind === 'git'));
      rows.push({ version, invalid, trace: f.trace });
    }
    const f = scripted({
      disk: {
        '/canonical/a': dir(),
        '/canonical/a/.git': other(),
        '/canonical/b': Object.assign(new Error('second denied'), { code: 'EACCES' }),
      },
    });
    const files = [file('a/'), file('b/')];
    await assert.rejects(api.classifyChanges(f.connection, f.repo, files), /second denied/);
    assert.equal(files[0].kind, 'repository');
    assert.equal(files[0].repositoryPath, '/canonical/a');
    assert(!f.trace.some((e) => e.kind === 'git'));
    rows.push({ version, partialInMemoryMutation: files, filesystemWrites: 0 });
  }
  proof('changes-classify-errors', {
    rows,
    boundary:
      'The helper mutates in-memory entries progressively. Failure has no rollback guarantee; SDK does not return a partial successful status. Lexical helper validation is not a standalone filesystem authorization boundary.',
  });
});

test('P0 change classification cancellation preserves cooperative Git and uncancellable SFTP boundaries', async () => {
  const rows = [];
  for (const [version, api] of versions()) {
    const c = new AbortController(),
      reason = new Error('before candidate');
    c.abort(reason);
    const empty = scripted();
    await api.classifyChanges(
      empty.connection,
      empty.repo,
      [file('ordinary', { kind: undefined, status: 'modified' })],
      c.signal,
    );
    assert.deepEqual(empty.trace, []);
    const before = scripted();
    await assert.rejects(
      api.classifyChanges(before.connection, before.repo, [file('a/')], c.signal),
      (e) => e === reason,
    );
    assert.deepEqual(
      before.trace.map((e) => e.kind),
      ['sftp', 'realpath'],
    );
    // SFTP does not accept AbortSignal: cancelling during a final non-directory lstat can return normally.
    const during = new AbortController();
    const nonDirectory = scripted({
      disk: { '/canonical/a': other() },
      onStat: () => during.abort(reason),
    });
    await api.classifyChanges(
      nonDirectory.connection,
      nonDirectory.repo,
      [file('a/')],
      during.signal,
    );
    assert(during.signal.aborted);
    for (const useConnectionSignal of [false, true]) {
      const abort = new AbortController();
      const f = scripted({
        disk: { '/canonical/a': dir(), '/canonical/a/.git': other() },
        connectionSignal: useConnectionSignal ? abort.signal : undefined,
        execute: (signal) =>
          new Promise((resolve, reject) => {
            assert(signal);
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            abort.abort(reason);
          }),
      });
      await assert.rejects(
        api.classifyChanges(
          f.connection,
          f.repo,
          [file('a/')],
          useConnectionSignal ? undefined : abort.signal,
        ),
        (e) => e === reason,
      );
      assert.equal(f.trace.filter((e) => e.kind === 'git').length, 1);
      rows.push({ version, useConnectionSignal, trace: f.trace, reasonIdentity: true });
    }
    const connectionOnly = scripted({
      connectionSignal: c.signal,
      disk: { '/canonical/a': dir() },
    });
    await api.classifyChanges(connectionOnly.connection, connectionOnly.repo, [file('a/')]);
    const aliasCancel = new AbortController();
    const alias = scripted({
      connectionSignal: aliasCancel.signal,
      disk: { '/canonical/a': dir(), '/canonical/a/.git': other() },
      stdout: list({ path: '/alias' }),
      aliases: { '/alias': Object.assign(new Error('alias denied'), { code: 'EACCES' }) },
      execute: () => {
        aliasCancel.abort(reason);
        return { exitCode: 0, stdout: list({ path: '/alias' }), stderr: '' };
      },
    });
    await assert.rejects(
      api.classifyChanges(alias.connection, alias.repo, [file('a/')]),
      (e) => e === reason,
    );
    rows.push({
      version,
      emptyFastPathIgnoresAbort: true,
      preAbortedCandidateStillResolvesRoot: before.trace,
      lateNonDirectorySftpMaySucceed: true,
      connectionOnlyNoGitMaySucceed: connectionOnly.trace,
      aliasCancellationNotSwallowed: true,
    });
  }
  proof('changes-classify-cancel', {
    rows,
    boundary:
      'Cooperative Git cancellation, SFTP has no signal. Direct helper fast path and late SFTP completion can succeed after cancellation; no unconditional cancellation or rollback claim. Public SDK rejects pre-aborted requests.',
  });
});

function nested(f, name) {
  f.git('init', '-q', name);
  f.git('-C', name, 'config', 'user.name', 'Classification fixture');
  f.git('-C', name, 'config', 'user.email', 'fixture@example.invalid');
  f.git('-C', name, 'config', 'commit.gpgSign', 'false');
  f.write(name + '/keep.txt', 'keep\n');
  f.git('-C', name, 'add', '--', 'keep.txt');
  f.git('-C', name, 'commit', '-qm', 'nested fixture');
}
function setup(f) {
  // macOS /var is an alias for /private/var. The production classifier returns
  // SFTP realpath values, so derive exact expectations from the actual root.
  f.root = fs.realpathSync(f.root);
  f.repo = fs.realpathSync(f.repo);
  f.git('config', 'commit.gpgSign', 'false');
  nested(f, 'module');
  f.git('add', '--', 'module');
  f.git('commit', '-qm', 'gitlink');
  f.write('module/keep.txt', 'dirty module\n');
  f.write('module/untracked.txt');
  nested(f, "嵌套 '$()\nrepo");
  f.git('worktree', 'add', '-q', '--detach', '.claude/worktrees/linked');
  f.git('worktree', 'add', '-qb', 'missing', '../missing');
  fs.rmSync(path.join(f.root, 'missing'), { recursive: true });
  const alias = path.join(f.root, 'repo alias');
  fs.symlinkSync(f.repo, alias, 'dir');
  f.registered = path.join(alias, '.claude/worktrees/linked');
  f.write('.git/worktrees/linked/gitdir', f.registered + '/.git\n');
  f.write('staged.txt', 'staged\n');
  f.git('add', '--', 'staged.txt');
  f.write('staged.txt', 'unstaged\n');
  fs.unlinkSync(path.join(f.repo, 'tracked.txt'));
  f.write('tracked.txt/child.txt', 'replacement\n');
  f.write('normal folder/new.txt');
  fs.symlinkSync('module', path.join(f.repo, 'module-link'));
}
function snapshot(f) {
  const files = {},
    links = {};
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name),
        rel = path.relative(f.root, p);
      if (e.isSymbolicLink()) links[rel] = fs.readlinkSync(p);
      else if (e.isDirectory()) walk(p);
      else if (e.isFile()) files[rel] = hash(fs.readFileSync(p));
    }
  }
  walk(f.repo);
  links['repo alias'] = fs.readlinkSync(path.join(f.root, 'repo alias'));
  return {
    head: f.git('rev-parse', 'HEAD').trim(),
    refs: f.git('show-ref'),
    index: hash(fs.readFileSync(path.join(f.repo, '.git/index'))),
    files,
    links,
  };
}
function checkFiles(files, f) {
  const at = (p) => {
    const value = files.find((e) => e.path === p);
    assert(value, 'Missing ' + p);
    return value;
  };
  assert.equal(at("嵌套 '$()\nrepo/").kind, 'repository');
  assert.equal(at("嵌套 '$()\nrepo/").repositoryPath, path.join(f.repo, "嵌套 '$()\nrepo"));
  assert.equal(at('.claude/worktrees/linked/').kind, 'worktree');
  assert.equal(at('.claude/worktrees/linked/').repositoryPath, f.registered);
  assert.equal(at('module').kind, 'submodule');
  assert.equal(at('module').submodule.trackedChanges, true);
  assert.equal(at('module').submodule.untrackedChanges, true);
  assert.equal(at('module').repositoryPath, path.join(f.repo, 'module'));
  assert.equal(at('tracked.txt').kind, 'directory');
  assert.equal(at('module-link').kind, undefined);
  assert.equal(at('normal folder/new.txt').kind, undefined);
  for (const p of ["嵌套 '$()\nrepo/", '.claude/worktrees/linked/', 'tracked.txt']) {
    assert.equal(changeActions(at(p)).stage, false);
    assert.equal(changeActions(at(p)).delete, false);
  }
  assert.equal(changeActions(at('.claude/worktrees/linked/')).open, true);
}
async function real(t, ssh) {
  const f = createRepository();
  let remote, local;
  t.after(async () => {
    await remote?.close();
    await local?.close();
    f.close();
  });
  setup(f);
  if (ssh) remote = await connectFixture(f);
  else local = new NativeRepositoryConnection();
  const connection = remote?.connection ?? local;
  const raw = f.git(
    '--no-optional-locks',
    'status',
    '--porcelain=v2',
    '--branch',
    '-z',
    '--untracked-files=all',
  );
  const before = snapshot(f),
    rows = [];
  let expected;
  for (const [version, api] of versions()) {
    const parsed = api.parseStatus(raw),
      recordsBefore = plain(parsed.records);
    const reasons = parsed.records.map((record) => ({
      path: record.path,
      reason: api.specialChangeReason(record) ?? null,
    }));
    assert.equal(reasons.find((r) => r.path === 'module').reason, '子模块，请在对应仓库中处理');
    assert.equal(
      reasons.find((r) => r.path === '.claude/worktrees/linked/').reason,
      '目录或嵌套仓库，请在对应仓库中处理',
    );
    await api.classifyChanges(connection, f.repo, parsed.files);
    checkFiles(parsed.files, f);
    assert.deepEqual(plain(parsed.records), recordsBefore);
    if (expected) assert.deepEqual(plain(parsed.files), expected);
    else expected = plain(parsed.files);
    assert.deepEqual(snapshot(f), before);
    rows.push({ version, raw, files: plain(parsed.files), reasons, before, after: snapshot(f) });
  }
  proof(ssh ? 'changes-real-ssh' : 'changes-real-native', {
    rows,
    unchanged: true,
    boundary: ssh
      ? 'Encrypted local loopback ssh2 with actual SFTP and Git. Not an external server/platform pass.'
      : 'Actual native Git with dirty index/worktree, detached linked worktree, alias and missing sibling. Preparation writes precede snapshots.',
  });
}
test('P0 change classification frozen and current native classify actual dirty repositories linked aliases and submodules without writes', async (t) => {
  await real(t, false);
});
test('P0 change classification frozen and current SSH classify actual dirty repositories linked aliases and submodules without writes', async (t) => {
  await real(t, true);
});

test('P0 change classification actual SDK status enforces owning resource typed query cancellation and helper isolation', async (t) => {
  const { spawnAgent } = require('@alune/agent-client/node'),
    f = createRepository();
  t.after(f.close);
  setup(f);
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
    const before = snapshot(f),
      result = await child.client.readRepository(resource, 'status', {});
    checkFiles(result.files, f);
    for (const foreign of [
      { ...resource, agentId: randomUUID() },
      { ...resource, resourceId: randomUUID() },
    ])
      await assert.rejects(
        child.client.readRepository(foreign, 'status', {}),
        (e) => e.kind === 'not-found',
      );
    for (const params of [
      { args: ['worktree', 'remove', '--force', 'module'] },
      { path: '../outside' },
      { files: [file('../outside/')] },
      { refreshIndex: true },
    ])
      await assert.rejects(
        child.client.request('repositories.read', { resource, kind: 'status', params }),
        (e) => e.kind === 'invalid-params',
      );
    for (const helper of [
      'classifyChanges',
      'specialChangeReason',
      'changeEntries.classifyChanges',
      'changeEntries.specialChangeReason',
    ])
      await assert.rejects(child.client.request(helper, {}), (e) => e.kind === 'unknown-method');
    await assert.rejects(
      child.client.request('repositories.read', {
        resource,
        kind: 'execute',
        params: { args: ['clean', '-fd'] },
      }),
      (e) => e.kind === 'invalid-params',
    );
    const c = new AbortController();
    c.abort();
    await assert.rejects(
      child.client.readRepository(resource, 'status', {}, { signal: c.signal }),
      (e) => e.kind === 'cancelled',
    );
    assert.deepEqual(snapshot(f), before);
    proof('changes-sdk-status', {
      resource,
      result,
      before,
      after: snapshot(f),
      unchanged: true,
      foreignAgentAndResourceRejected: true,
      extraQueryAndPathAndArgvRejected: true,
      helperRPCRejected: true,
      preAbortedRequestRejected: true,
      boundary:
        'Current SDK/stdio status read; specialChangeReason is separately executed on original porcelain records. No helper RPC or mutation introduced.',
    });
  } finally {
    await child.close();
  }
});
