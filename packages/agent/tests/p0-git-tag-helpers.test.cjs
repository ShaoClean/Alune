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
const { GitTags } = require('../dist/modules/git/git-tags-writes');
const { gitFileCommand } = require('../dist/modules/git/git-shell');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = (v) => createHash('sha256').update(v).digest('hex');
const plain = (v) => JSON.parse(JSON.stringify(v));
const messages = {
  name: '请输入有效的标签名称。',
  ref: '标签名称无效，不能包含空格、..、~、^、:、?、*、[ 或反斜杠。',
  stale: '标签已变化，请刷新列表后重试。',
  remote: '请选择有效的远程。',
  absent: '远程已不存在，请刷新列表。',
  multiple: '此远程配置了多个推送地址，请使用只有一个推送地址的远程管理标签。',
};
function proof(name, value) {
  if (process.env.P0_TAG_HELPERS_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_TAG_HELPERS_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function frozen() {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const file = 'packages/ssh-client/src/' + name + '.ts';
    const source = fs.readFileSync(path.join(process.env.P0_TAG_HELPERS_FROZEN, file), 'utf8');
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
        AbortSignal,
        process,
        require(id) {
          if (id.startsWith('node:')) return require(id);
          if (id === '@alune/shared') return require('@alune/domain');
          assert(
            ['./git-signing', './repository-transport', './git-shell'].includes(id),
            'Unexpected frozen dependency ' + id,
          );
          return load(id.slice(2));
        },
      },
      { filename: file },
    );
    cache.set(name, module.exports);
    return module.exports;
  }
  return load('git-tags').GitTags;
}
const versions = () => [
  ['frozen', frozen()],
  ['current', GitTags],
];
function recording(Api, steps, signal, shell = false) {
  const trace = [];
  const connection = {
    signal,
    async execGit(repo, args, receivedSignal, options) {
      assert.equal(this, connection);
      assert.equal(repo, "/仓库 ' $() /repo");
      assert.equal(receivedSignal, signal);
      assert.equal(options, undefined);
      const step = steps[trace.length];
      assert(step, 'unexpected command');
      assert.deepEqual(plain(args), step.args);
      trace.push({ repo, args: plain(args) });
      if (step.wait) await step.wait;
      if (step.after) step.after();
      if (step.error) throw step.error;
      return { exitCode: 0, stdout: '', stderr: '', ...step.result };
    },
  };
  if (shell) {
    const git = connection.execGit;
    delete connection.execGit;
    connection.execCommand = async function (command, cwd, receivedSignal, options) {
      assert.equal(cwd, undefined);
      const step = steps[trace.length];
      assert.equal(command, gitFileCommand("/仓库 ' $() /repo", step.args));
      return git.call(connection, "/仓库 ' $() /repo", step.args, receivedSignal, options);
    };
  }
  return { api: new Api(connection), connection, trace, repo: "/仓库 ' $() /repo" };
}
const exactError = (message) => (e) => e instanceof Error && e.message === message;

test('P0 tag helpers checked preserves argv output error selection identity and cancellation without retries', async () => {
  const rows = [];
  for (const [version, Api] of versions()) {
    for (const shell of [false, true]) {
      const args = ['show-ref', '--verify', "refs/tags/中文'$()*;echo"];
      let complete;
      const wait = new Promise((r) => (complete = r));
      const f = recording(
        Api,
        [{ args, wait, result: { stdout: '  raw\0bytes\n', stderr: 'ignored warning' } }],
        undefined,
        shell,
      );
      let settled = false;
      const pending = f.api.checked(f.repo, args).then((v) => {
        settled = true;
        return v;
      });
      await Promise.resolve();
      assert.equal(settled, false);
      complete();
      assert.equal(await pending, '  raw\0bytes\n');
      assert.equal(f.trace.length, 1);
      for (const [result, expected] of [
        [{ exitCode: 3, stderr: '  precise stderr\n', stdout: 'fallback' }, '  precise stderr\n'],
        [{ exitCode: 1, stderr: '', stdout: 'fallback\n' }, 'fallback\n'],
        [{ exitCode: 1 }, '标签操作失败。'],
        [
          { exitCode: 1, stderr: 'gpg: pinentry canceled' },
          '签名失败，操作未完成。GPG 请配置可弹窗的 pinentry；SSH 请用 ssh-add 加载密钥。也可在终端解锁后重试；Alune 不会收集密钥口令。 SSH 仓库请在远端主机检查。\nGit 原因：gpg: pinentry canceled',
        ],
      ]) {
        const p = recording(Api, [{ args, result }], undefined, shell);
        await assert.rejects(p.api.checked(p.repo, args), exactError(expected));
        assert.equal(p.trace.length, 1);
        rows.push({ version, shell, result, expected });
      }
      const reason = new Error('transport failed');
      const p = recording(Api, [{ args, error: reason }], undefined, shell);
      await assert.rejects(p.api.checked(p.repo, args), (e) => e === reason);
      assert.equal(p.trace.length, 1);
      const c = new AbortController(),
        cancel = new Error('cancel before command');
      c.abort(cancel);
      const aborted = recording(Api, [], c.signal, shell);
      await assert.rejects(aborted.api.checked(aborted.repo, args), (e) => e === cancel);
      assert.equal(aborted.trace.length, 0);
    }
  }
  proof('tags-checked', {
    rows,
    awaited: true,
    transportIdentity: true,
    preDispatchCancel: true,
    retries: 0,
  });
});

test('P0 tag helpers ref rejects invalid inputs before IO and preserves exact full literal ref', async () => {
  const rows = [];
  for (const [version, Api] of versions()) {
    for (const name of [undefined, null, 0, {}, [], false, '', '-all', 'a\0b']) {
      const f = recording(Api, []);
      await assert.rejects(f.api.ref(f.repo, name), exactError(messages.name));
      assert.equal(f.trace.length, 0);
      rows.push({ version, input: String(name), rejectedBeforeIO: true });
    }
    for (const name of ['v1', '中文/v2', "版本'$();echo", 'nested/ref']) {
      const ref = 'refs/tags/' + name,
        f = recording(Api, [{ args: ['check-ref-format', ref] }]);
      assert.equal(await f.api.ref(f.repo, name), ref);
      assert.equal(f.trace.length, 1);
      rows.push({ version, name, ref });
    }
    for (const name of [
      'bad name',
      'a..b',
      'x.lock',
      'a\nb',
      'bad~',
      'bad^',
      'bad:',
      'bad?',
      'bad*',
      'bad[',
      'a\\b',
    ]) {
      const f = recording(Api, [
        {
          args: ['check-ref-format', 'refs/tags/' + name],
          result: { exitCode: 1, stderr: 'git diagnostic' },
        },
      ]);
      await assert.rejects(f.api.ref(f.repo, name), exactError(messages.ref));
      assert.equal(f.trace.length, 1);
    }
    const reason = new Error('ref transport failed'),
      f = recording(Api, [{ args: ['check-ref-format', 'refs/tags/v1'], error: reason }]);
    await assert.rejects(f.api.ref(f.repo, 'v1'), (e) => e === reason);
    const c = new AbortController(),
      cancel = new Error('ref canceled');
    c.abort(cancel);
    const p = recording(Api, [], c.signal);
    await assert.rejects(p.api.ref(p.repo, 'v1'), (e) => e === cancel);
    assert.equal(p.trace.length, 0);
  }
  proof('tags-ref', {
    rows,
    invalidGitNames: 11,
    transportIdentity: true,
    preDispatchCancel: true,
  });
});

test('P0 tag helpers snapshot requires exact object identity and ordered validation without mutation', async () => {
  const rows = [];
  for (const [version, Api] of versions()) {
    for (const size of [40, 64]) {
      const object = 'a'.repeat(size),
        ref = "refs/tags/中文'$()",
        steps = [
          { args: ['check-ref-format', ref] },
          {
            args: ['show-ref', '--verify', '--hash', ref],
            result: { stdout: ' \n' + object + '\n\t' },
          },
        ];
      const f = recording(Api, steps);
      assert.equal(await f.api.snapshot(f.repo, "中文'$()", object), ref);
      assert.equal(f.trace.length, 2);
      rows.push({ version, size, ref, trace: f.trace });
      for (const expected of [
        undefined,
        null,
        0,
        {},
        object + '\n',
        object.toUpperCase(),
        'b'.repeat(size),
      ]) {
        const p = recording(Api, steps);
        await assert.rejects(
          p.api.snapshot(p.repo, "中文'$()", expected),
          exactError(messages.stale),
        );
        assert.equal(p.trace.length, 2);
      }
    }
    const ref = 'refs/tags/v1';
    for (const stage of [0, 1]) {
      const steps = [
        { args: ['check-ref-format', ref] },
        { args: ['show-ref', '--verify', '--hash', ref] },
      ];
      const reason = new Error('snapshot transport failed');
      steps[stage].error = reason;
      const f = recording(Api, steps);
      await assert.rejects(f.api.snapshot(f.repo, 'v1', 'a'.repeat(40)), (e) => e === reason);
      assert.equal(f.trace.length, stage + 1);
    }
    const missing = recording(Api, [
      { args: ['check-ref-format', ref] },
      {
        args: ['show-ref', '--verify', '--hash', ref],
        result: { exitCode: 1, stderr: 'missing ref' },
      },
    ]);
    await assert.rejects(
      missing.api.snapshot(missing.repo, 'v1', 'a'.repeat(40)),
      exactError('missing ref'),
    );
    const invalid = recording(Api, []);
    await assert.rejects(
      invalid.api.snapshot(invalid.repo, '-x', 'a'.repeat(40)),
      exactError(messages.name),
    );
    assert.equal(invalid.trace.length, 0);
    const c = new AbortController(),
      cancel = new Error('between snapshot commands');
    const f = recording(
      Api,
      [{ args: ['check-ref-format', ref], after: () => c.abort(cancel) }],
      c.signal,
    );
    await assert.rejects(f.api.snapshot(f.repo, 'v1', 'a'.repeat(40)), (e) => e === cancel);
    assert.equal(f.trace.length, 1);
  }
  proof('tags-snapshot', {
    rows,
    strictExpectedComparison: true,
    missingAndStaleRefuse: true,
    betweenCommandCancellation: true,
    noMutation: true,
  });
});

test('P0 tag helpers remoteUrl selects exactly one configured push URL and refuses unsafe remotes', async () => {
  const rows = [];
  for (const [version, Api] of versions()) {
    for (const remote of [undefined, null, 0, {}, [], false, '', '-all', 'a\0b', 'a\rb', 'a\nb']) {
      const f = recording(Api, []);
      await assert.rejects(f.api.remoteUrl(f.repo, remote), exactError(messages.remote));
      assert.equal(f.trace.length, 0);
    }
    for (const remote of ['origin', "中文'$()", 'team/a']) {
      const url = "/local/push 中文'$() remote.git",
        steps = [
          { args: ['remote'], result: { stdout: ' other\n' + remote + '\n' } },
          {
            args: ['remote', 'get-url', '--push', '--all', remote],
            result: { stdout: '  ' + url + '\n' },
          },
        ];
      const f = recording(Api, steps);
      assert.equal(await f.api.remoteUrl(f.repo, remote), url);
      assert.equal(f.trace.length, 2);
      rows.push({ version, remote, url, trace: f.trace });
    }
    for (const stdout of ['', 'origin2\n', 'Origin\n']) {
      const f = recording(Api, [{ args: ['remote'], result: { stdout } }]);
      await assert.rejects(f.api.remoteUrl(f.repo, 'origin'), exactError(messages.absent));
      assert.equal(f.trace.length, 1);
    }
    for (const stdout of ['/one\n/two\n', '/one\n/one\n']) {
      const f = recording(Api, [
        { args: ['remote'], result: { stdout: 'origin\n' } },
        { args: ['remote', 'get-url', '--push', '--all', 'origin'], result: { stdout } },
      ]);
      await assert.rejects(f.api.remoteUrl(f.repo, 'origin'), exactError(messages.multiple));
      assert.equal(f.trace.length, 2);
    }
    // An empty successful Git URL is passed through by both historical and current helper.
    // Real public reads then fail at ls-remote; do not claim stronger URL validation here.
    const empty = recording(Api, [
      { args: ['remote'], result: { stdout: 'origin\n' } },
      { args: ['remote', 'get-url', '--push', '--all', 'origin'] },
    ]);
    assert.equal(await empty.api.remoteUrl(empty.repo, 'origin'), '');
    for (const stage of [0, 1]) {
      const steps = [
        { args: ['remote'], result: { stdout: 'origin\n' } },
        { args: ['remote', 'get-url', '--push', '--all', 'origin'] },
      ];
      const reason = new Error('remote transport failure');
      steps[stage].error = reason;
      const f = recording(Api, steps);
      await assert.rejects(f.api.remoteUrl(f.repo, 'origin'), (e) => e === reason);
      assert.equal(f.trace.length, stage + 1);
      delete steps[stage].error;
      steps[stage].result = { exitCode: 1, stderr: 'remote failed' };
      const p = recording(Api, steps);
      await assert.rejects(p.api.remoteUrl(p.repo, 'origin'), exactError('remote failed'));
      assert.equal(p.trace.length, stage + 1);
    }
    const c = new AbortController(),
      cancel = new Error('between remote commands');
    const f = recording(
      Api,
      [{ args: ['remote'], result: { stdout: 'origin\n' }, after: () => c.abort(cancel) }],
      c.signal,
    );
    await assert.rejects(f.api.remoteUrl(f.repo, 'origin'), (e) => e === cancel);
    assert.equal(f.trace.length, 1);
  }
  proof('tags-remote-url', {
    rows,
    multipleURLsRefused: true,
    emptySuccessURL: 'legacy pass-through; not a URL authorization boundary',
    betweenCommandCancellation: true,
  });
});

function state(f) {
  return {
    head: f.git('rev-parse', 'HEAD'),
    refs: f.git('show-ref'),
    index: hash(fs.readFileSync(path.join(f.repo, '.git/index'))),
    content: hash(fs.readFileSync(path.join(f.repo, 'tracked.txt'))),
  };
}
function setupRemotes(f) {
  const fetch = path.join(f.root, 'fetch.git'),
    push = path.join(f.root, "push 中文 '$().git");
  for (const dir of [fetch, push]) execFileSync('git', ['init', '--bare', '-q', dir]);
  f.git('remote', 'add', 'origin', fetch);
  f.git('remote', 'set-url', '--push', 'origin', push);
  return { fetch, push };
}
async function real(t, ssh) {
  const f = createRepository();
  let remote;
  t.after(async () => {
    await remote?.close();
    f.close();
  });
  const { fetch, push } = setupRemotes(f),
    name = "版本/v1'$()",
    object = f.git('rev-parse', 'HEAD').trim();
  f.git('tag', name);
  f.git('tag', '-a', 'v2', '-m', '中文说明');
  f.git('push', push, 'refs/tags/' + name + ':refs/tags/' + name);
  if (ssh) remote = await connectFixture(f);
  const connection = remote?.connection ?? new NativeRepositoryConnection(),
    before = state(f),
    rows = [];
  for (const [version, Api] of versions()) {
    const tags = new Api(connection),
      ref = 'refs/tags/' + name;
    assert.equal(await tags.ref(f.repo, name), ref);
    assert.equal(await tags.snapshot(f.repo, name, object), ref);
    assert.equal(await tags.remoteUrl(f.repo, 'origin'), push);
    assert.equal(
      (await tags.checked(f.repo, ['show-ref', '--verify', '--hash', ref])).trim(),
      object,
    );
    const list = await tags.list(f.repo),
      remoteTags = await tags.remoteTags(f.repo, 'origin');
    assert(list.some((v) => v.name === name && v.objectHash === object));
    assert.deepEqual(plain(remoteTags), [{ name, objectHash: object }]);
    for (const bad of [
      'bad name',
      'a..b',
      'x.lock',
      'bad~',
      'bad^',
      'bad:',
      'bad?',
      'bad*',
      'bad[',
      'a\\b',
    ])
      await assert.rejects(tags.ref(f.repo, bad), exactError(messages.ref));
    for (const expected of ['b'.repeat(40), object + '\n']) {
      await assert.rejects(tags.snapshot(f.repo, name, expected), exactError(messages.stale));
      await assert.rejects(
        tags.delete(f.repo, { name, objectHash: expected, confirmed: true }),
        exactError(messages.stale),
      );
      await assert.rejects(
        tags.checkout(f.repo, { name, objectHash: expected, confirmed: true }),
        exactError(messages.stale),
      );
    }
    await assert.rejects(tags.snapshot(f.repo, 'missing', object));
    await assert.rejects(tags.remoteUrl(f.repo, 'missing'), exactError(messages.absent));
    f.git('config', '--add', 'remote.origin.pushurl', fetch);
    await assert.rejects(tags.remoteUrl(f.repo, 'origin'), exactError(messages.multiple));
    f.git('config', '--unset-all', 'remote.origin.pushurl');
    f.git('config', 'remote.origin.pushurl', push);
    f.git('config', 'remote.origin.pushurl', path.join(f.root, 'missing.git'));
    await assert.rejects(tags.remoteTags(f.repo, 'origin'));
    f.git('config', 'remote.origin.pushurl', push);
    assert.deepEqual(state(f), before);
    assert.equal(f.git('ls-remote', '--tags', fetch), '');
    rows.push({
      version,
      ref,
      object,
      localTags: plain(list),
      remoteTags: plain(remoteTags),
      fetch,
      push,
      unchanged: true,
    });
  }
  proof(ssh ? 'tags-real-ssh' : 'tags-real-native', {
    rows,
    before,
    after: state(f),
    boundary: ssh
      ? 'Encrypted loopback ssh2 exec running real Git on this Mac; no external SSH deployment'
      : 'Actual native Git in isolated temporary repository',
  });
}
test('P0 tag helpers frozen and current real native validate stale tags and distinct push URL without side effects', async (t) => {
  await real(t, false);
});
test('P0 tag helpers frozen and current real SSH validate stale tags and distinct push URL without side effects', async (t) => {
  await real(t, true);
});

test('P0 tag helpers actual SDK stdio binds owning resources and refuses stale deletion and duplicate tag writes', async (t) => {
  const { spawnAgent } = require('@alune/agent-client/node'),
    f = createRepository();
  t.after(f.close);
  const { fetch, push } = setupRemotes(f),
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
    const prepare = async (kind, args) => {
      const intent = { resource, kind, args };
      return {
        ...intent,
        revision: await child.client.prepareRepositoryWrite(intent),
        operationId: randomUUID(),
      };
    };
    const write = async (kind, args) => child.client.writeRepository(await prepare(kind, args));
    const head = f.git('rev-parse', 'HEAD').trim(),
      index = hash(fs.readFileSync(path.join(f.repo, '.git/index'))),
      name = "SDK/版本'$()";
    const create = await prepare('createTag', [{ name, type: 'lightweight' }]);
    await child.client.writeRepository(create);
    await assert.rejects(
      child.client.writeRepository(create),
      (e) => e.kind === 'duplicate-request',
    );
    await write('pushTag', [{ remote: 'origin', name }]);
    const tags = await child.client.readRepository(resource, 'tags', { remote: 'origin' });
    assert.equal(tags.local.find((v) => v.name === name).objectHash, head);
    assert.deepEqual(tags.remote, [{ name, objectHash: head }]);
    assert.equal(f.git('ls-remote', '--tags', fetch), '');
    for (const foreign of [
      { ...resource, agentId: randomUUID() },
      { ...resource, resourceId: randomUUID() },
    ]) {
      await assert.rejects(
        child.client.readRepository(foreign, 'tags', {}),
        (e) => e.kind === 'not-found',
      );
      await assert.rejects(
        child.client.prepareRepositoryWrite({
          resource: foreign,
          kind: 'deleteTag',
          args: [{ name, objectHash: head, confirmed: true }],
        }),
        (e) => e.kind === 'not-found',
      );
    }
    await write('createTag', [{ name: 'other', type: 'annotated', message: 'second object' }]);
    const other = f.git('rev-parse', 'refs/tags/other').trim();
    f.git('update-ref', 'refs/tags/' + name, other);
    // Prepare after external change: revision is current, but stale tag confirmation still fails.
    const stale = await prepare('deleteTag', [{ name, objectHash: head, confirmed: true }]);
    await assert.rejects(child.client.writeRepository(stale), /标签已变化/);
    assert.equal(f.git('rev-parse', 'refs/tags/' + name).trim(), other);
    const current = (await child.client.readRepository(resource, 'tags', {})).local.find(
      (v) => v.name === name,
    );
    await assert.rejects(
      prepare('deleteTag', [{ ...current, confirmed: true }]),
      (e) => e.kind === 'invalid-params',
    );
    await write('deleteTag', [
      { name: current.name, objectHash: current.objectHash, confirmed: true },
    ]);
    assert(
      !(await child.client.readRepository(resource, 'tags', {})).local.some((v) => v.name === name),
    );
    // Local deletion does not silently remove the already pushed remote tag.
    assert.equal(
      (await child.client.readRepository(resource, 'tags', { remote: 'origin' })).remote[0]
        .objectHash,
      head,
    );
    for (const helper of [
      'gitTags.checked',
      'gitTags.ref',
      'gitTags.snapshot',
      'gitTags.remoteUrl',
    ])
      await assert.rejects(child.client.request(helper, {}), (e) => e.kind === 'unknown-method');
    await assert.rejects(
      child.client.request('repositories.read', {
        resource,
        kind: 'execute',
        params: { args: ['tag', '-d', 'other'] },
      }),
      (e) => e.kind === 'invalid-params',
    );
    assert.equal(f.git('rev-parse', 'HEAD').trim(), head);
    assert.equal(hash(fs.readFileSync(path.join(f.repo, '.git/index'))), index);
    assert.equal(fs.readFileSync(path.join(f.repo, 'tracked.txt'), 'utf8'), 'original\n');
    proof('tags-sdk-stdio', {
      resource,
      head,
      index,
      localAndPushTags: tags,
      staleObject: head,
      currentObject: other,
      staleDeletionRefused: true,
      duplicateCreateRefused: true,
      foreignOwnershipRefused: true,
      helperRPCsRefused: true,
      extraMutationFieldsRefused: true,
      isolatedGitConfiguration: true,
      headIndexContentUnchanged: true,
      sideEffects:
        'Only isolated fixture tag refs and local bare push remote; no user/project remote modified',
    });
  } finally {
    await child.close();
  }
});
