const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');
const { InteractiveRebase, LocalConnection } = require('../dist');

async function fixture(t, mode = 'local') {
  const f = createRepository();
  t.after(f.close);
  let repo = f.repo;
  if (mode === 'worktree') {
    repo = path.join(f.root, 'linked worktree');
    f.git('worktree', 'add', '-q', '-b', 'linked', repo);
    fs.writeFileSync(path.join(f.repo, 'tracked.txt'), 'keep main working change\n');
  }
  let connection = new LocalConnection();
  if (mode === 'ssh') {
    const server = await connectFixture(f);
    t.after(server.close);
    connection = server.connection;
  }
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  const commit = (name, content = name, message = name) => {
    fs.writeFileSync(path.join(repo, name), content);
    git('add', '--', name);
    git('commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  // A configured editor that fails proves no fallback editor is ever started.
  git('config', 'core.editor', 'false');
  git('config', 'sequence.editor', 'false');
  git('config', 'commit.gpgsign', 'false');
  return {
    ...f,
    mainRepo: f.repo,
    repo,
    git,
    commit,
    connection,
    rebase: new InteractiveRebase(connection),
    base: git('rev-parse', 'HEAD'),
  };
}
function request(preview, entries) {
  return { base: preview.base, token: preview.token, entries, acknowledgePublished: false };
}
const pick = (hash) => ({ hash, action: 'pick' });
const messages = (f) =>
  f
    .git('log', '--reverse', '--format=%B%x00', `${f.base}..HEAD`)
    .split('\0')
    .map((s) => s.trim())
    .filter(Boolean);

test('idle state does not require SFTP, but recovery markers still fail closed', async (t) => {
  const f = await fixture(t);
  const connection = new LocalConnection();
  connection.withSftp = async () => {
    throw new Error('SFTP unavailable');
  };
  const rebase = new InteractiveRebase(connection);
  assert.deepEqual(await rebase.state(f.repo), {
    active: false,
    managed: false,
    inProgress: false,
    conflicts: [],
  });
  fs.mkdirSync(path.join(f.git('rev-parse', '--absolute-git-dir'), 'alune-interactive-rebase'));
  await assert.rejects(rebase.state(f.repo), /SFTP unavailable/);
});

for (const mode of ['local', 'worktree', 'ssh']) {
  test(
    `${mode}: reorder, reword, consecutive squash/fixup and drop use real Git`,
    { timeout: 120_000 },
    async (t) => {
      const f = await fixture(t, mode);
      const a = f.commit('a');
      const b = f.commit('b');
      const c = f.commit('c');
      const d = f.commit('d');
      const e = f.commit('e');
      const preview = await f.rebase.preview(f.repo, f.base);
      assert.deepEqual(
        preview.commits.map((c) => c.hash),
        [a, b, c, d, e],
      );
      const result = await f.rebase.start(
        f.repo,
        request(preview, [
          { hash: b, action: 'reword', message: '改写 b\n\n详细说明' },
          { hash: a, action: 'squash', message: '合并 b + a' },
          { hash: c, action: 'squash', message: '合并 b + a + c\n\n保留正文 " $HOME `no-command`' },
          { hash: d, action: 'fixup' },
          { hash: e, action: 'drop' },
        ]),
      );
      assert.equal(result.error, undefined, result.output);
      assert.equal(result.state.active, false);
      assert.deepEqual(messages(f), ['合并 b + a + c\n\n保留正文 " $HOME `no-command`']);
      assert.equal(f.git('ls-tree', '--name-only', 'HEAD'), 'a\nb\nc\nd\ntracked.txt');
      assert.equal(f.git('status', '--porcelain'), '');
      const directory = f.git('rev-parse', '--absolute-git-dir');
      assert.equal(fs.existsSync(path.join(directory, 'alune-interactive-rebase')), false);
      if (mode === 'worktree') {
        assert.equal(
          execFileSync('git', ['-C', f.mainRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          f.base,
        );
        assert.equal(
          fs.readFileSync(path.join(f.mainRepo, 'tracked.txt'), 'utf8'),
          'keep main working change\n',
        );
      }
    },
  );

  test(
    `${mode}: conflict can be read, resolved and continued after constructing a new executor`,
    { timeout: 120_000 },
    async (t) => {
      const f = await fixture(t, mode);
      const a = f.commit('tracked.txt', 'one\n', 'one');
      const b = f.commit('tracked.txt', 'two\n', 'two');
      const preview = await f.rebase.preview(f.repo, f.base);
      const started = await f.rebase.start(
        f.repo,
        request(preview, [{ hash: b, action: 'reword', message: '重排 two' }, pick(a)]),
      );
      assert.equal(started.state.inProgress, true, started.output);
      assert.deepEqual(started.state.conflicts, ['tracked.txt']);
      const recovered = new InteractiveRebase(f.connection);
      assert.equal((await recovered.state(f.repo)).originalHead, preview.head);
      const conflict = await recovered.conflict(f.repo, 'tracked.txt');
      assert.equal(conflict.ours, 'original\n');
      assert.equal(conflict.theirs, 'two\n');
      assert.equal(conflict.editable, true);
      assert.match(conflict.content, /<<<<<<< /);
      await recovered.resolve(f.repo, {
        path: conflict.path,
        token: conflict.token,
        choice: 'content',
        content: 'two\n',
      });
      const next = await recovered.control(f.repo, 'continue');
      // The second, reordered patch conflicts as expected too.
      assert.equal(next.state.inProgress, true, next.output);
      const second = await recovered.conflict(f.repo, 'tracked.txt');
      await recovered.resolve(f.repo, { path: second.path, token: second.token, choice: 'theirs' });
      const finished = await recovered.control(f.repo, 'continue');
      assert.equal(finished.error, undefined, finished.output);
      assert.equal(finished.state.active, false);
      assert.deepEqual(messages(f), ['重排 two', 'one']);
      assert.equal(fs.readFileSync(path.join(f.repo, 'tracked.txt'), 'utf8'), 'one\n');
    },
  );

  test(
    `${mode}: abort restores the exact original HEAD, branch and files`,
    { timeout: 120_000 },
    async (t) => {
      const f = await fixture(t, mode);
      const a = f.commit('tracked.txt', 'one\n');
      const b = f.commit('tracked.txt', 'two\n');
      const before = f.git('symbolic-ref', 'HEAD');
      const preview = await f.rebase.preview(f.repo, f.base);
      await f.rebase.start(f.repo, request(preview, [pick(b), pick(a)]));
      const result = await f.rebase.control(f.repo, 'abort');
      assert.equal(result.error, undefined, result.output);
      assert.equal(f.git('rev-parse', 'HEAD'), b);
      assert.equal(f.git('symbolic-ref', 'HEAD'), before);
      assert.equal(fs.readFileSync(path.join(f.repo, 'tracked.txt'), 'utf8'), 'two\n');
      assert.equal(f.git('status', '--porcelain'), '');
    },
  );

  test(
    `${mode}: dropping every commit resets only the current branch to the base`,
    { timeout: 120_000 },
    async (t) => {
      const f = await fixture(t, mode);
      f.commit('a');
      f.commit('b');
      const preview = await f.rebase.preview(f.repo, f.base);
      const result = await f.rebase.start(
        f.repo,
        request(
          preview,
          preview.commits.map((c) => ({ hash: c.hash, action: 'drop' })),
        ),
      );
      assert.equal(result.error, undefined, result.output);
      assert.equal(f.git('rev-parse', 'HEAD'), f.base);
      assert.equal(f.git('status', '--porcelain'), '');
    },
  );
}

test('rejects invalid plans, stale HEAD/ref snapshots, dirty files, and unacknowledged published commits', async (t) => {
  const f = await fixture(t);
  const a = f.commit('a');
  const b = f.commit('b');
  const preview = await f.rebase.preview(f.repo, f.base);
  for (const entries of [
    [pick(a)],
    [pick(a), pick(a)],
    [{ hash: a, action: 'fixup' }, pick(b)],
    [{ hash: a, action: 'exec' }, pick(b)],
    [{ hash: a, action: 'reword', message: '' }, pick(b)],
  ]) {
    await assert.rejects(() => f.rebase.start(f.repo, request(preview, entries)));
    assert.equal(f.git('rev-parse', 'HEAD'), b);
  }
  fs.writeFileSync(path.join(f.repo, 'untracked'), 'keep');
  await assert.rejects(() => f.rebase.start(f.repo, request(preview, [pick(a), pick(b)])), /改动/);
  fs.unlinkSync(path.join(f.repo, 'untracked'));
  f.git('update-ref', 'refs/remotes/origin/main', a);
  await assert.rejects(
    () => f.rebase.start(f.repo, request(preview, [pick(a), pick(b)])),
    /已变化/,
  );
  const published = await f.rebase.preview(f.repo, f.base);
  assert.deepEqual(
    published.commits.map((c) => c.published),
    [true, false],
  );
  await assert.rejects(
    () => f.rebase.start(f.repo, request(published, [pick(a), pick(b)])),
    /强制推送/,
  );
  const result = await f.rebase.start(f.repo, {
    ...request(published, [{ hash: a, action: 'reword', message: 'published' }, pick(b)]),
    acknowledgePublished: true,
  });
  assert.equal(result.error, undefined, result.output);
  f.commit('c');
  await assert.rejects(
    () => f.rebase.start(f.repo, request(published, [pick(a), pick(b)])),
    /已变化/,
  );
});

test('skip continues the plan without applying the conflicting commit', async (t) => {
  const f = await fixture(t);
  const a = f.commit('tracked.txt', 'one\n', 'one');
  const b = f.commit('tracked.txt', 'two\n', 'two');
  const p = await f.rebase.preview(f.repo, f.base);
  await f.rebase.start(f.repo, request(p, [pick(b), pick(a)]));
  await assert.rejects(() => f.rebase.control(f.repo, 'continue'), /冲突/);
  const result = await f.rebase.control(f.repo, 'skip');
  assert.equal(result.error, undefined, result.output);
  assert.deepEqual(messages(f), ['one']);
});

test('rejects stale conflict content and rejects paths outside the conflict set', async (t) => {
  const f = await fixture(t);
  const a = f.commit('tracked.txt', 'one\n');
  const b = f.commit('tracked.txt', 'two\n');
  const p = await f.rebase.preview(f.repo, f.base);
  await f.rebase.start(f.repo, request(p, [pick(b), pick(a)]));
  const conflict = await f.rebase.conflict(f.repo, 'tracked.txt');
  fs.writeFileSync(path.join(f.repo, 'tracked.txt'), 'external edit');
  await assert.rejects(
    () => f.rebase.resolve(f.repo, { path: conflict.path, token: conflict.token, choice: 'ours' }),
    /已变化/,
  );
  await assert.rejects(() => f.rebase.conflict(f.repo, '../outside'));
  await f.rebase.control(f.repo, 'abort');
});

test('rejects merges, detached HEAD and unrelated bases', async (t) => {
  const f = await fixture(t);
  const branch = f.git('branch', '--show-current');
  const a = f.commit('a');
  f.git('checkout', '-qb', 'side', f.base);
  f.commit('b');
  f.git('checkout', '-q', branch);
  f.git('merge', '--no-ff', '-qm', 'merge', 'side');
  await assert.rejects(() => f.rebase.preview(f.repo, f.base), /合并提交/);
  f.git('checkout', '-q', '--detach', a);
  await assert.rejects(() => f.rebase.preview(f.repo, f.base));
  f.git('checkout', '-q', branch);
  await assert.rejects(() => f.rebase.preview(f.repo, '0'.repeat(40)), /祖先/);
});

test('matches an independently executed native interactive rebase in trees, messages and authors', async (t) => {
  const f = await fixture(t);
  const a = f.commit('a');
  const b = f.commit('b');
  const c = f.commit('c');
  const d = f.commit('d');
  const e = f.commit('e');
  const native = path.join(f.root, 'native');
  f.git('worktree', 'add', '-qb', 'native', native, e);
  const message = '# Combined message\n\nBody with "quotes" and $HOME';
  const p = await f.rebase.preview(f.repo, f.base);
  const result = await f.rebase.start(
    f.repo,
    request(p, [
      { hash: b, action: 'reword', message },
      { hash: a, action: 'squash', message },
      { hash: c, action: 'fixup' },
      { hash: d, action: 'drop' },
      pick(e),
    ]),
  );
  assert.equal(result.error, undefined, result.output);
  const todo = path.join(f.root, 'native-todo');
  const msg = path.join(f.root, 'native-message');
  fs.writeFileSync(todo, `reword ${b}\nsquash ${a}\nfixup ${c}\ndrop ${d}\npick ${e}\n`);
  fs.writeFileSync(msg, message + '\n');
  const quote = (s) => "'" + s.replace(/'/g, "'\"'\"'") + "'";
  execFileSync('git', ['-C', native, '-c', 'commit.cleanup=verbatim', 'rebase', '-i', f.base], {
    env: {
      ...process.env,
      GIT_SEQUENCE_EDITOR: `cp ${quote(todo)}`,
      GIT_EDITOR: `cp ${quote(msg)}`,
    },
    stdio: 'pipe',
  });
  const log = (repo) =>
    execFileSync(
      'git',
      ['-C', repo, 'log', '--reverse', '--format=%T%n%an%n%ae%n%B', `${f.base}..HEAD`],
      { encoding: 'utf8' },
    );
  assert.equal(log(f.repo), log(native));
});

test('does not adopt an external rebase after an external abort leaves the private session behind', async (t) => {
  const f = await fixture(t);
  const a = f.commit('tracked.txt', 'one\n');
  const b = f.commit('tracked.txt', 'two\n');
  const p = await f.rebase.preview(f.repo, f.base);
  await f.rebase.start(f.repo, request(p, [pick(b), pick(a)]));
  f.git('rebase', '--abort');
  f.git('checkout', '-qb', 'other', f.base);
  f.commit('tracked.txt', 'other\n');
  f.git('checkout', '-q', p.branch);
  assert.throws(() => f.git('rebase', 'other'));
  const state = await f.rebase.state(f.repo);
  assert.equal(state.inProgress, true);
  assert.equal(state.managed, false);
  await assert.rejects(() => f.rebase.control(f.repo, 'abort'), /Alune/);
  f.git('rebase', '--abort');
  assert.equal((await f.rebase.control(f.repo, 'abort')).state.active, false);
});

test('cleans interrupted preparation even if its metadata is incomplete', async (t) => {
  const f = await fixture(t);
  const directory = path.join(f.git('rev-parse', '--absolute-git-dir'), 'alune-interactive-rebase');
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'session.json'), '{');
  const state = await f.rebase.state(f.repo);
  assert.equal(state.managed, true);
  assert.equal(state.inProgress, false);
  assert.equal((await f.rebase.control(f.repo, 'abort')).state.active, false);
  assert.equal(f.git('rev-parse', 'HEAD'), f.base);
});

test('rejects an identically positioned branch switch and foreign session symlinks', async (t) => {
  const f = await fixture(t);
  const a = f.commit('a');
  const p = await f.rebase.preview(f.repo, f.base);
  f.git('checkout', '-qb', 'same-head');
  await assert.rejects(() => f.rebase.start(f.repo, request(p, [pick(a)])), /已变化/);
  if (process.platform === 'win32') return;
  const foreign = path.join(f.root, 'foreign');
  fs.mkdirSync(foreign);
  const sentinel = path.join(foreign, 'session.json');
  fs.writeFileSync(sentinel, 'keep');
  fs.symlinkSync(
    foreign,
    path.join(f.git('rev-parse', '--absolute-git-dir'), 'alune-interactive-rebase'),
  );
  await assert.rejects(() => f.rebase.control(f.repo, 'abort'), /普通目录/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
});
