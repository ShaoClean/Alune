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
const { GitReads } = require('../dist/modules/git/git-commands');
const { gitFileCommand } = require('../dist/modules/git/git-shell');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = (v) => createHash('sha256').update(v).digest('hex');
const plain = (v) => JSON.parse(JSON.stringify(v));
const branchArgs = [
  'for-each-ref',
  '--format=%(refname)%00%(HEAD)%00%(upstream)%00%(symref)',
  'refs/heads/',
  'refs/remotes/',
];
const stashArgs = ['--no-literal-pathspecs', 'stash', 'list'];
const repo = "/仓库 ' $() /repo";
function proof(name, value) {
  if (process.env.P0_REF_LISTS_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_REF_LISTS_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function frozen() {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const file = 'packages/ssh-client/src/' + name + '.ts';
    const source = fs.readFileSync(path.join(process.env.P0_REF_LISTS_FROZEN, file), 'utf8');
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
        AbortSignal,
        process,
        require(id) {
          if (id === 'util' || id.startsWith('node:')) return require(id);
          if (id === '@alune/shared') return require('@alune/domain');
          if (['./repository-transport', './git-shell'].includes(id)) return load(id.slice(2));
          assert(
            [
              './git-signing',
              './repository-path',
              './connection-manager',
              './git-status',
              './change-entries',
              './git-log',
            ].includes(id),
            'Unexpected frozen dependency ' + id,
          );
          // These imports belong to other methods in the complete frozen class.
          // Any attempted use fails, so no substitute behavior can satisfy this scope.
          return new Proxy(
            {},
            {
              get(_target, property) {
                throw Error('Outside selected ref-list scope: ' + id + '.' + String(property));
              },
            },
          );
        },
      },
      { filename: file },
    );
    cache.set(name, module.exports);
    return module.exports;
  }
  return load('git-commands').GitCommands;
}
const versions = () => [
  ['frozen', frozen()],
  ['current', GitReads],
];
function recording(Api, expectedArgs, result = {}, { signal, error, wait, shell = false } = {}) {
  const trace = [];
  const connection = {
    signal,
    async execGit(receivedRepo, args, receivedSignal, options) {
      assert.equal(this, connection);
      assert.equal(receivedRepo, repo);
      assert.deepEqual(plain(args), expectedArgs);
      assert.equal(receivedSignal, signal);
      assert.equal(options, undefined);
      trace.push({ repo: receivedRepo, args: plain(args) });
      assert.equal(trace.length, 1, 'unexpected retry');
      if (wait) await wait;
      if (error) throw error;
      return { exitCode: 0, stdout: '', stderr: '', ...result };
    },
  };
  if (shell) {
    const exec = connection.execGit;
    delete connection.execGit;
    connection.execCommand = function (command, cwd, receivedSignal, options) {
      assert.equal(command, gitFileCommand(repo, expectedArgs));
      assert.equal(cwd, undefined);
      return exec.call(connection, repo, expectedArgs, receivedSignal, options);
    };
  }
  return { api: new Api(connection), trace };
}
async function listMatrix(kind, args, output, expected) {
  const rows = [];
  for (const [version, Api] of versions()) {
    for (const shell of [false, true]) {
      let finish;
      const wait = new Promise((r) => (finish = r));
      const f = recording(Api, args, { stdout: output }, { wait, shell });
      let settled = false;
      const pending = f.api[kind](repo).then((value) => {
        settled = true;
        return value;
      });
      await Promise.resolve();
      assert.equal(settled, false);
      finish();
      assert.deepEqual(plain(await pending), expected);
      assert.equal(f.trace.length, 1);
      const empty = recording(Api, args, { stdout: '\n\n' }, { shell });
      assert.deepEqual(plain(await empty.api[kind](repo)), []);
      for (const detail of ['literal error\n', '', 'git-lfs: not found']) {
        const failed = recording(
          Api,
          args,
          { exitCode: 7, stderr: detail, stdout: output },
          { shell },
        );
        const prefix = kind === 'branchList' ? 'git branch failed: ' : 'git stash list failed: ';
        await assert.rejects(failed.api[kind](repo), (e) => e.message === prefix + detail);
        assert.equal(failed.trace.length, 1);
      }
      const reason = new Error('transport identity'),
        failed = recording(Api, args, {}, { error: reason, shell });
      await assert.rejects(failed.api[kind](repo), (e) => e === reason);
      const c = new AbortController(),
        cancel = new Error('cancel before dispatch');
      c.abort(cancel);
      const aborted = recording(Api, args, {}, { signal: c.signal, shell });
      await assert.rejects(aborted.api[kind](repo), (e) => e === cancel);
      assert.equal(aborted.trace.length, 0);
      rows.push({
        version,
        shell,
        output,
        expected,
        trace: f.trace,
        awaited: true,
        empty: true,
        errors: 3,
        transportIdentity: true,
        cancelledBeforeDispatch: true,
        retries: 0,
      });
    }
  }
  return rows;
}
test('P0 ref lists branchList preserves ordered output exact argv errors and cancellation', async () => {
  const stdout =
    "refs/remotes/origin/远端'$()\0 \0refs/heads/main\0\n\nrefs/heads/z\0*\0refs/remotes/origin/main\0\nrefs/remotes/origin/HEAD\0 \0\0refs/remotes/origin/main\ninvalid\nrefs/heads/a\0 \0\0\n";
  const expected = [
    {
      name: "remotes/origin/远端'$()",
      isHead: false,
      isRemote: true,
      isCurrent: false,
      upstream: 'main',
    },
    { name: 'z', isHead: true, isRemote: false, isCurrent: true, upstream: 'origin/main' },
    { name: 'a', isHead: false, isRemote: false, isCurrent: false },
  ];
  proof('refs-branch-list', { rows: await listMatrix('branchList', branchArgs, stdout, expected) });
});
test('P0 ref lists stashList preserves reflog indices fallback lines errors and cancellation', async () => {
  const stdout =
    "stash@{12}: WIP on main: abcd message: more\n\nstash@{2}: On 分支'$(): 自定义: message\nunsupported literal\n \n";
  const expected = [
    { index: 12, branch: 'main', message: 'abcd message: more' },
    { index: 2, branch: "分支'$()", message: '自定义: message' },
    { index: 2, message: 'unsupported literal' },
    { index: 3, message: ' ' },
  ];
  proof('refs-stash-list', { rows: await listMatrix('stashList', stashArgs, stdout, expected) });
});
test('P0 ref lists branch parser preserves current remote upstream and symbolic filtering', () => {
  const rows = [
    [
      'refs/heads/main\0*\0refs/remotes/origin/main\0',
      { name: 'main', isHead: true, isRemote: false, isCurrent: true, upstream: 'origin/main' },
    ],
    [
      "refs/heads/中文'$()\0 \0refs/heads/local\0",
      { name: "中文'$()", isHead: false, isRemote: false, isCurrent: false, upstream: 'local' },
    ],
    [
      'refs/remotes/team/nested/topic\0*\0refs/custom/u\0',
      {
        name: 'remotes/team/nested/topic',
        isHead: true,
        isRemote: true,
        isCurrent: true,
        upstream: 'refs/custom/u',
      },
    ],
    ['refs/remotes/origin/HEAD\0 \0\0refs/remotes/origin/main', null],
    ['refs/heads/alias\0*\0\0refs/heads/main', null],
    ['refs/tags/v1\0*\0\0', null],
    ['HEAD\0*\0\0', null],
    ['', null],
    ['refs/heads/only', { name: 'only', isHead: false, isRemote: false, isCurrent: false }],
    ['refs/heads/\0+\0\0', { name: '', isHead: false, isRemote: false, isCurrent: false }],
    [
      'refs/remotes/a\0 *\0refs/remotes/o/x\0\0ignored',
      { name: 'remotes/a', isHead: false, isRemote: true, isCurrent: false, upstream: 'o/x' },
    ],
  ];
  for (const [, Api] of versions()) {
    const api = new Api({});
    for (const [input, expected] of rows)
      assert.deepEqual(plain(api._parseBranchLine(input)), expected);
  }
  proof('refs-branch-parser', {
    versions: ['frozen', 'current'],
    rows,
    boundary:
      'Historical parser tolerance is not ref validation; incomplete refs are direct parser cases, not real Git output.',
  });
});
test('P0 ref lists stash parser preserves WIP On Unicode colons and literal fallback', () => {
  const rows = [
    [
      'stash@{0007}: WIP on main: abc subject',
      0,
      { index: 7, branch: 'main', message: 'abc subject' },
    ],
    [
      "stash@{42}: On 分支'$(): Unicode 空格: colons: remain",
      1,
      { index: 42, branch: "分支'$()", message: 'Unicode 空格: colons: remain' },
    ],
    [
      'stash@{1}:\tOn\tfeature/a:\tmessage  ',
      9,
      { index: 1, branch: 'feature/a', message: 'message  ' },
    ],
    ['stash@{2}: On main: ', 4, { index: 4, message: 'stash@{2}: On main: ' }],
    ['stash@{-1}: On main: message', 6, { index: 6, message: 'stash@{-1}: On main: message' }],
    ['stash@{1}: on main: message', 8, { index: 8, message: 'stash@{1}: on main: message' }],
    ['not a stash: literal $()\0', 10, { index: 10, message: 'not a stash: literal $()\0' }],
    ['', 11, { index: 11, message: '' }],
    [
      'stash@{3}: On branch with space: subject',
      12,
      { index: 12, message: 'stash@{3}: On branch with space: subject' },
    ],
  ];
  for (const [, Api] of versions())
    for (const [input, index, expected] of rows)
      assert.deepEqual(plain(new Api({})._parseStashLine(input, index)), expected);
  proof('refs-stash-parser', {
    versions: ['frozen', 'current'],
    rows,
    boundary:
      'Unsupported or malformed lines preserve literal fallback; this does not validate stash mutation input.',
  });
});
function state(f) {
  const files = {};
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files[path.relative(f.root, p)] = hash(fs.readFileSync(p));
    }
  }
  walk(f.repo);
  if (f.linked) walk(f.linked);
  return { head: f.git('rev-parse', 'HEAD').trim(), refs: f.git('show-ref'), files };
}
function setup(f) {
  f.git('branch', '-m', 'main');
  const head = f.git('rev-parse', 'HEAD').trim();
  f.git('branch', "中文'$()/topic");
  f.git('branch', 'local-upstream');
  f.git('branch', '--set-upstream-to=main', 'local-upstream');
  f.git('config', 'remote.origin.url', path.join(f.root, 'offline-do-not-contact.git'));
  f.git('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
  f.git('update-ref', 'refs/remotes/origin/main', head);
  f.git('update-ref', "refs/remotes/origin/远端'$()", head);
  f.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  f.git('branch', '--set-upstream-to=origin/main', 'main');
  f.write('tracked.txt', 'first stash\n');
  f.git('stash', 'push', '-m', "中文'$(): colon: retained");
  f.write('tracked.txt', 'second stash\n');
  f.git('stash', 'push');
  f.linked = path.join(f.root, "linked '$() tree");
  f.git('worktree', 'add', '-q', '-b', 'linked', f.linked);
  // Preserve staged/unstaged/untracked facts during all accepted reads.
  f.write('tracked.txt', 'staged\n');
  f.git('add', '--', 'tracked.txt');
  f.write('tracked.txt', 'unstaged\n');
  f.write('loose.txt', 'untracked\n');
  return { head, subject: f.git('log', '-1', '--format=%s').trim() };
}
function expectedBranches(current) {
  return [
    {
      name: 'linked',
      isHead: current === 'linked',
      isRemote: false,
      isCurrent: current === 'linked',
    },
    { name: 'local-upstream', isHead: false, isRemote: false, isCurrent: false, upstream: 'main' },
    {
      name: 'main',
      isHead: current === 'main',
      isRemote: false,
      isCurrent: current === 'main',
      upstream: 'origin/main',
    },
    { name: "中文'$()/topic", isHead: false, isRemote: false, isCurrent: false },
    { name: 'remotes/origin/main', isHead: false, isRemote: true, isCurrent: false },
    { name: "remotes/origin/远端'$()", isHead: false, isRemote: true, isCurrent: false },
  ];
}
function expectedStashes(info) {
  return [
    { index: 0, branch: 'main', message: info.head.slice(0, 7) + ' ' + info.subject },
    { index: 1, branch: 'main', message: "中文'$(): colon: retained" },
  ];
}
async function real(t, ssh) {
  const f = createRepository(),
    unborn = createRepository({ initial: false });
  let remote;
  t.after(async () => {
    await remote?.close();
    f.close();
    unborn.close();
  });
  const info = setup(f);
  if (ssh) remote = await connectFixture(f);
  const connection = ssh ? remote.connection : new NativeRepositoryConnection();
  const rows = [];
  for (const [version, Api] of versions()) {
    const api = new Api(connection),
      before = state(f);
    const branches = await api.branchList(f.repo),
      stashes = await api.stashList(f.repo);
    assert.deepEqual(plain(branches), expectedBranches('main'));
    assert.deepEqual(plain(stashes), expectedStashes(info));
    assert.deepEqual(plain(await api.branchList(f.linked)), expectedBranches('linked'));
    assert.deepEqual(plain(await api.stashList(f.linked)), expectedStashes(info));
    assert.deepEqual(plain(await api.branchList(unborn.repo)), []);
    assert.deepEqual(plain(await api.stashList(unborn.repo)), []);
    assert.deepEqual(state(f), before);
    rows.push({
      version,
      branches: plain(branches),
      stashes: plain(stashes),
      linked: expectedBranches('linked'),
      before,
      after: state(f),
      unborn: [],
      unchanged: true,
    });
  }
  // Deliberate fixture transition outside read snapshots; detached status must not mark a branch current.
  f.git('checkout', '--detach', '-q');
  const detachedBefore = state(f);
  for (const [, Api] of versions()) {
    assert.deepEqual(plain(await new Api(connection).branchList(f.repo)), expectedBranches(null));
    assert.deepEqual(plain(await new Api(connection).stashList(f.repo)), expectedStashes(info));
  }
  assert.deepEqual(state(f), detachedBefore);
  proof(ssh ? 'refs-real-ssh' : 'refs-real-native', {
    rows,
    detached: { branches: expectedBranches(null), before: detachedBefore, after: state(f) },
    boundary: ssh
      ? 'Encrypted loopback ssh2 executes actual Git on this Mac, not an external deployment'
      : 'Native Git in isolated disposable repositories',
  });
}
test('P0 ref lists frozen and current native read real branches stashes worktrees and detached HEAD without side effects', async (t) => {
  await real(t, false);
});
test('P0 ref lists frozen and current SSH read real branches stashes worktrees and detached HEAD without side effects', async (t) => {
  await real(t, true);
});
test('P0 ref lists actual SDK stdio enforces resource ownership query validation cancellation and helper isolation', async (t) => {
  const { spawnAgent } = require('@alune/agent-client/node'),
    f = createRepository();
  t.after(f.close);
  const info = setup(f),
    child = spawnAgent(
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
    const before = state(f);
    assert.deepEqual(
      await child.client.readRepository(resource, 'branches', {}),
      expectedBranches('main'),
    );
    assert.deepEqual(
      await child.client.readRepository(resource, 'stashes', {}),
      expectedStashes(info),
    );
    for (const foreign of [
      { ...resource, agentId: randomUUID() },
      { ...resource, resourceId: randomUUID() },
    ])
      for (const kind of ['branches', 'stashes'])
        await assert.rejects(
          child.client.readRepository(foreign, kind, {}),
          (e) => e.kind === 'not-found',
        );
    for (const kind of ['branches', 'stashes']) {
      await assert.rejects(
        child.client.request('repositories.read', {
          resource,
          kind,
          params: { args: ['branch', '-D', 'main'] },
        }),
        (e) => e.kind === 'invalid-params',
      );
      const c = new AbortController();
      c.abort();
      await assert.rejects(
        child.client.readRepository(resource, kind, {}, { signal: c.signal }),
        (e) => e.kind === 'cancelled',
      );
    }
    for (const helper of [
      'gitCommands.branchList',
      'gitCommands.stashList',
      'gitCommands._parseBranchLine',
      'gitCommands._parseStashLine',
    ])
      await assert.rejects(child.client.request(helper, {}), (e) => e.kind === 'unknown-method');
    await assert.rejects(
      child.client.request('repositories.read', {
        resource,
        kind: 'execute',
        params: { args: ['stash', 'clear'] },
      }),
      (e) => e.kind === 'invalid-params',
    );
    assert.deepEqual(state(f), before);
    proof('refs-sdk-stdio', {
      resource,
      branches: expectedBranches('main'),
      stashes: expectedStashes(info),
      foreignAgentAndResourceRejected: true,
      extraQueryFieldsRejected: true,
      arbitraryGitQueryRejected: true,
      helperRPCsRejected: true,
      preAbortedQueriesRejected: true,
      before,
      after: state(f),
      unchanged: true,
      isolatedGitConfiguration: true,
    });
  } finally {
    await child.close();
  }
});
