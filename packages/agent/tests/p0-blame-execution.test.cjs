const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { BLAME_TIMEOUT_MS, BLAME_MAX_BYTES } = require('@alune/domain');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');
const { NativeRepositoryConnection } = require('../dist/adapters/git/native');
const current = require('../dist/modules/git/git-blame');
const currentError = require('../dist/modules/git/repository-files').RepositoryFileError;
const { gitFileCommand } = require('../dist/modules/git/git-shell');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = (v) => createHash('sha256').update(v).digest('hex');
const plain = (v) => JSON.parse(JSON.stringify(v));
function proof(name, value) {
  if (process.env.P0_BLAME_EXECUTION_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_BLAME_EXECUTION_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function frozen() {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const file = 'packages/ssh-client/src/' + name + '.ts';
    const source = fs.readFileSync(path.join(process.env.P0_BLAME_EXECUTION_FROZEN, file), 'utf8');
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
        AbortController,
        process,
        setTimeout,
        clearTimeout,
        require(id) {
          if (id === 'util' || id.startsWith('node:')) return require(id);
          if (id === '@alune/shared') return require('@alune/domain');
          if (['./repository-files', './repository-transport', './git-shell'].includes(id))
            return load(id.slice(2));
          assert(
            ['./lfs', './repository-path', './sftp-file'].includes(id),
            'Unexpected frozen dependency ' + id,
          );
          return new Proxy(
            {},
            {
              get(_target, property) {
                throw Error('Outside selected blame helper scope: ' + id + '.' + String(property));
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
  return {
    Api: load('git-blame').GitBlame,
    FileError: load('repository-files').RepositoryFileError,
  };
}
const versions = () => [
  ['frozen', frozen()],
  ['current', { Api: current.GitBlame, FileError: currentError }],
];
const sameError = (reason) => (error) => error === reason;
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('P0 blame deadline preserves success rejection sync throw and final signal cleanup', async () => {
  const rows = [];
  for (const [version, { Api }] of versions()) {
    const api = new Api({});
    const value = { literal: "中文 '$()", bytes: Buffer.from([0, 255]) };
    let signal, finish;
    const p = api.deadline((s) => {
      signal = s;
      return new Promise((r) => {
        finish = r;
      });
    });
    let settled = false;
    p.then(() => {
      settled = true;
    });
    await tick();
    assert.equal(settled, false);
    assert.equal(signal.aborted, false);
    finish(value);
    assert.equal(await p, value);
    assert.equal(signal.aborted, true);
    const failure = new Error('operation identity');
    for (const synchronous of [false, true]) {
      let inner;
      await assert.rejects(
        api.deadline((s) => {
          inner = s;
          if (synchronous) throw failure;
          return Promise.reject(failure);
        }),
        sameError(failure),
      );
      assert.equal(inner.aborted, true);
    }
    const caller = new AbortController();
    assert.equal(
      await api.deadline(async (s) => {
        assert.notEqual(s, caller.signal);
        assert.equal(s.aborted, false);
        return value;
      }, caller.signal),
      value,
    );
    assert.equal(caller.signal.aborted, false);
    rows.push({
      version,
      pendingUntilOperation: true,
      exactValueIdentity: true,
      rejectionAndSyncThrowIdentity: true,
      finallyAborted: true,
      callerUnchanged: true,
    });
  }
  proof('blame-deadline-settlement', { rows });
});
test('P0 blame deadline propagates cooperative cancellation and records noncooperative limits', async () => {
  const rows = [];
  for (const [version, { Api }] of versions()) {
    const api = new Api({});
    for (const before of [true, false]) {
      const c = new AbortController(),
        reason = new Error('caller cancel identity');
      if (before) c.abort(reason);
      let inner,
        calls = 0;
      const p = api.deadline((s) => {
        inner = s;
        calls++;
        s.throwIfAborted();
        return new Promise((_r, reject) =>
          s.addEventListener('abort', () => reject(s.reason), { once: true }),
        );
      }, c.signal);
      const rejected = assert.rejects(p, sameError(reason));
      if (!before) c.abort(reason);
      await rejected;
      assert.equal(inner.reason, reason);
      assert.equal(calls, 1); // deadline invokes the callback; callback/transport checks pre-abort.
    }
    const c = new AbortController(),
      reason = new Error('ignored by operation');
    let finish, inner;
    const p = api.deadline((s) => {
      inner = s;
      return new Promise((r) => {
        finish = r;
      });
    }, c.signal);
    c.abort(reason);
    assert.equal(inner.reason, reason);
    let settled = false;
    p.then(() => {
      settled = true;
    });
    await tick();
    assert.equal(settled, false);
    finish('noncooperative result');
    assert.equal(await p, 'noncooperative result');
    assert.equal(c.signal.reason, reason);
    rows.push({
      version,
      preAbortedCallbackInvoked: true,
      callbackChecksSignal: true,
      cooperativeIdentity: true,
      inFlightAbort: true,
      noncooperativeResultCanWin: true,
      rollbackClaimed: false,
    });
  }
  proof('blame-deadline-cancellation', { rows });
});
test('P0 blame deadline uses real production timeout and aborts pending operation with exact error', async () => {
  assert.equal(BLAME_TIMEOUT_MS, 15000);
  const rows = await Promise.all(
    versions().map(async ([version, { Api, FileError }]) => {
      const started = performance.now();
      let inner,
        aborts = 0,
        operationCalls = 0;
      const p = new Api({}).deadline((s) => {
        inner = s;
        operationCalls++;
        s.addEventListener(
          'abort',
          () => {
            aborts++;
          },
          { once: true },
        );
        return new Promise(() => {});
      });
      const rejected = assert.rejects(p, (error) => {
        assert(error instanceof FileError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, '逐行追溯超时，请稍后重试或在终端使用 git blame。');
        assert.equal(inner.reason, error);
        return true;
      });
      await tick();
      assert.equal(inner.aborted, false);
      await rejected;
      const elapsedMs = performance.now() - started;
      assert(elapsedMs >= BLAME_TIMEOUT_MS - 10);
      assert.equal(aborts, 1);
      assert.equal(operationCalls, 1);
      return {
        version,
        productionTimeoutMs: BLAME_TIMEOUT_MS,
        elapsedMs,
        aborts,
        operationCalls,
        exactTimeoutReason: true,
        schedulerSubstituted: false,
        noncooperativeOperationRemainsUnsettled: true,
      };
    }),
  );
  proof('blame-deadline-timeout', { rows });
});
test('P0 blame git preserves argv output identity limits exact errors transport cancellation and shell fallback', async () => {
  const rows = [],
    repo = "/仓库 '$() /literal";
  for (const [version, { Api, FileError }] of versions()) {
    for (const shell of [false, true])
      for (const binary of [false, true]) {
        const c = new AbortController(),
          args = binary
            ? ['cat-file', 'blob', "HEAD:中文 '$().txt"]
            : ['show', '--no-patch', 'HEAD', '--'];
        const options = { binary, maxOutputBytes: binary ? BLAME_MAX_BYTES : 8 * 1024 * 1024 };
        const result = {
          exitCode: 0,
          stdout: 'literal\0\n中文',
          stderr: 'warning\n',
          stdoutBytes: Buffer.from([0, 255, 13, 10]),
        };
        let calls = 0,
          finish,
          transportError,
          receivedOptions;
        const connection = {};
        const execute = async (s, o) => {
          calls++;
          receivedOptions = o;
          assert.equal(s, c.signal);
          assert.deepEqual(plain(o), options);
          if (transportError) throw transportError;
          return new Promise((r) => {
            finish = r;
          });
        };
        if (shell)
          connection.execCommand = function (cmd, cwd, s, o) {
            assert.equal(this, connection);
            assert.equal(cmd, gitFileCommand(repo, args));
            assert.equal(cwd, undefined);
            return execute(s, o);
          };
        else
          connection.execGit = function (r, argv, s, o) {
            assert.equal(this, connection);
            assert.equal(r, repo);
            assert.deepEqual(plain(argv), args);
            return execute(s, o);
          };
        const api = new Api(connection);
        const pending = api.git(repo, args, c.signal, binary);
        await tick();
        assert.equal(calls, 1);
        finish(result);
        assert.equal(await pending, result);
        for (const stderr of ['  中文 failure\n\t', '', 'git-lfs: not found']) {
          const p = api.git(repo, args, c.signal, binary);
          await tick();
          finish({ ...result, exitCode: 7, stderr });
          await assert.rejects(
            p,
            (error) =>
              error instanceof FileError &&
              error.statusCode === 400 &&
              error.message === '无法读取追溯信息：' + stderr.trim(),
          );
        }
        transportError = new Error('transport error identity');
        await assert.rejects(api.git(repo, args, c.signal, binary), sameError(transportError));
        assert.equal(calls, 5, 'show/cat-file does not retry');
        c.abort(transportError);
        await assert.rejects(api.git(repo, args, c.signal, binary), sameError(transportError));
        assert.equal(calls, 5, 'no dispatch after operation abort');
        const external = new AbortController();
        external.abort(transportError);
        connection.signal = external.signal;
        await assert.rejects(
          api.git(repo, args, new AbortController().signal, binary),
          sameError(transportError),
        );
        assert.equal(calls, 5, 'no dispatch after connection abort');
        rows.push({
          version,
          shell,
          binary,
          args,
          options: plain(receivedOptions),
          outputIdentity: true,
          binaryIdentity: true,
          errors: 3,
          transportIdentity: true,
          operationAndConnectionCancelBeforeDispatch: true,
          calls,
          retries: 0,
        });
      }
    // Running transport cancellation must be observed by the operation.
    const c = new AbortController(),
      reason = new Error('running transport cancelled');
    let calls = 0,
      reached;
    const api = new Api({
      execGit(_r, args, signal, options) {
        calls++;
        reached = signal;
        assert.deepEqual(plain(args), ['blame', '--line-porcelain', '--', 'a']);
        assert.equal(options.binary, false);
        return new Promise((_r, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      },
    });
    const p = api.git(repo, ['blame', '--line-porcelain', '--', 'a'], c.signal);
    const rejected = assert.rejects(p, sameError(reason));
    assert.equal(reached, c.signal);
    c.abort(reason);
    await rejected;
    assert.equal(calls, 1);
  }
  proof('blame-git-matrix', {
    rows,
    runningCancellation: true,
    fallbackBoundary:
      'shell cannot provide native binary stdoutBytes; result identity here tests adapter contract only; real binary read below uses native execGit',
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
function setup(f) {
  const name = "中文 '$().txt",
    content = Buffer.from('alpha\n中文\n');
  f.write(name, content);
  f.git('add', '--', name);
  f.git('commit', '-qm', "literal '$() message\n\nfull body");
  const commit = f.git('rev-parse', 'HEAD').trim();
  f.linked = path.join(f.root, "linked '$() tree");
  f.git('worktree', 'add', '--detach', '-q', f.linked, commit);
  f.write('tracked.txt', 'staged\n');
  f.git('add', '--', 'tracked.txt');
  f.write('tracked.txt', 'unstaged\n');
  f.write('loose.txt', 'untracked\n');
  return { name, content, commit };
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
  const connection = ssh ? remote.connection : new NativeRepositoryConnection();
  const rows = [];
  for (const [version, { Api, FileError }] of versions()) {
    const api = new Api(connection),
      before = state(f);
    for (const repo of [f.repo, f.linked]) {
      const detail = await api.commit(repo, info.commit);
      assert.equal(detail.hash, info.commit);
      assert.equal(detail.body, "literal '$() message\n\nfull body");
      assert.equal(detail.author, 'Deletion test');
      const result = await api.deadline((signal) =>
        api.git(repo, ['cat-file', 'blob', info.commit + ':' + info.name], signal, !ssh),
      );
      if (ssh) assert.equal(result.stdout, info.content.toString());
      else assert.deepEqual(result.stdoutBytes, info.content);
      await assert.rejects(
        api.commit(repo, 'f'.repeat(40)),
        (e) => e instanceof FileError && e.message.startsWith('无法读取追溯信息：'),
      );
    }
    const c = new AbortController(),
      reason = new Error('before real git');
    c.abort(reason);
    await assert.rejects(api.commit(f.repo, info.commit, c.signal), sameError(reason));
    assert.deepEqual(state(f), before);
    rows.push({
      version,
      commit: info.commit,
      nativeBinary: !ssh,
      sshTextOnly: ssh,
      mainAndLinked: true,
      missingObjectError: true,
      preAborted: true,
      before,
      after: state(f),
      unchanged: true,
    });
  }
  proof(ssh ? 'blame-real-ssh' : 'blame-real-native', {
    rows,
    boundary: ssh
      ? 'Encrypted loopback ssh2 executes actual Git on this Mac; shell transport text output only, no remote binary byte-cap claim'
      : 'Native Git in isolated repositories; literal binary bytes checked; snapshot covers HEAD refs index Git/worktree ordinary bytes and symlink targets',
  });
}
test('P0 blame frozen and current real native commit reads preserve repository and linked worktree bytes', async (t) => {
  await real(t, false);
});
test('P0 blame frozen and current real SSH commit reads preserve repository and linked worktree bytes', async (t) => {
  await real(t, true);
});
test('P0 blame actual SDK stdio enforces ownership query validation cancellation and helper isolation', async (t) => {
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
    const before = state(f),
      detail = await child.client.readRepository(resource, 'blameCommit', { hash: info.commit });
    assert.equal(detail.hash, info.commit);
    assert.equal(detail.body, "literal '$() message\n\nfull body");
    for (const foreign of [
      { ...resource, agentId: randomUUID() },
      { ...resource, resourceId: randomUUID() },
    ])
      await assert.rejects(
        child.client.readRepository(foreign, 'blameCommit', { hash: info.commit }),
        (e) => e.kind === 'not-found',
      );
    for (const params of [{ hash: '--help' }, { hash: info.commit, args: ['show'] }])
      await assert.rejects(
        child.client.request('repositories.read', { resource, kind: 'blameCommit', params }),
        (e) => e.kind === 'invalid-params',
      );
    for (const helper of ['gitBlame.git', 'gitBlame.deadline'])
      await assert.rejects(child.client.request(helper, {}), (e) => e.kind === 'unknown-method');
    const c = new AbortController();
    c.abort();
    await assert.rejects(
      child.client.readRepository(
        resource,
        'blameCommit',
        { hash: info.commit },
        { signal: c.signal },
      ),
      (e) => e.kind === 'cancelled',
    );
    await assert.rejects(
      child.client.request('repositories.read', {
        resource,
        kind: 'execute',
        params: { args: ['show'] },
      }),
      (e) => e.kind === 'invalid-params',
    );
    assert.deepEqual(state(f), before);
    proof('blame-sdk-stdio', {
      resource,
      commit: info.commit,
      detail,
      foreignAgentAndResourceRejected: true,
      queryValidation: true,
      helperRPCsRejected: true,
      preAbortedRejected: true,
      before,
      after: state(f),
      unchanged: true,
    });
  } finally {
    await child.close();
  }
});
