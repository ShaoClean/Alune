const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GitWorktrees, worktreePathKey } = require('../dist/worktrees');
const { parseWorktrees } = require('../dist/worktrees');
const { GitCommands } = require('../dist/git-commands');
const { createWorktreeRepository } = require('./helpers/worktree-repository.cjs');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');

test('SFTP drive paths become native Git paths without rewriting POSIX or UNC paths', async () => {
  for (const [input, expected] of [
    ['/C:/工作 区', 'C:/工作 区'],
    ['/repo/back\\slash', '/repo/back\\slash'],
    ['\\\\server\\share\\repo', '\\\\server\\share\\repo'],
  ]) {
    const reader = new GitWorktrees({
      withSftp: (run) => run({ realpath: (_, callback) => callback(null, input) }),
    });
    assert.equal(await reader.canonicalPath('fixture'), expected);
  }
});

test('NUL records preserve literal paths, optional reasons, bare and detached states', () => {
  const literal = "/repos/中文\n '$()\t";
  const records = parseWorktrees(
    'worktree ' +
      literal +
      '\0HEAD abc\0branch refs/heads/feature/a\0locked\0\0' +
      'worktree /gone\0HEAD def\0detached\0prunable missing\0\0' +
      'worktree /bare\0bare\0\0',
  );
  assert.equal(records[0].path, literal);
  assert.equal(records[0].branch, 'feature/a');
  assert.equal(records[0].locked, true);
  assert.equal(records[1].detached, true);
  assert.equal(records[1].prunableReason, 'missing');
  assert.equal(records[2].bare, true);
  assert.throws(() => parseWorktrees('worktree /truncated\0'), /不完整/);
  assert.equal(worktreePathKey('/C:/work/repo/'), worktreePathKey('c:\\work\\repo'));
  assert.notEqual(worktreePathKey('/repo\\name'), worktreePathKey('/repo/name'));
});

test('real SSH discovers siblings and isolates staged, unstaged, untracked diffs and writes', async (t) => {
  const fixture = createWorktreeRepository();
  const remote = await connectFixture(fixture);
  t.after(async () => {
    await remote.close();
    fixture.close();
  });
  const worktrees = new GitWorktrees(remote.connection);
  const git = new GitCommands(remote.connection);
  const list = await worktrees.list(fixture.feature);
  assert.equal(list.length, 4);
  assert.equal(list.find((item) => item.isCurrent).branch, 'feature/worktrees');
  assert.equal(list.find((item) => item.detached).path, fs.realpathSync(fixture.detached));
  assert.equal(list.find((item) => item.prunable).path.endsWith('/missing-worktree'), true);
  fixture.git('worktree', 'lock', '--reason', 'keep this directory', fixture.feature);
  const locked = (await worktrees.list(fixture.repo)).find((item) => item.locked);
  assert.equal(locked.lockedReason, 'keep this directory');
  assert.equal(
    await worktrees.resolve(fixture.repo, locked.path),
    fs.realpathSync(fixture.feature),
  );
  for (const [directory, marker] of [
    [fixture.repo, 'main'],
    [fixture.feature, 'feature'],
    [fixture.detached, 'detached'],
  ]) {
    const state = await git.status(directory);
    assert.deepEqual(
      state.files.map((file) => [file.path, file.staged]).sort(),
      [
        [marker + '-new.txt', false],
        ['tracked.txt', false],
        ['tracked.txt', true],
      ].sort(),
    );
    assert.equal(
      state.branch,
      marker === 'main' ? 'main' : marker === 'feature' ? 'feature/worktrees' : '',
    );
    assert.match(
      await git.diff(directory, { file: 'tracked.txt', staged: true }),
      new RegExp('\\+' + marker + ' staged'),
    );
    assert.match(
      await git.diff(directory, { file: 'tracked.txt' }),
      new RegExp('\\+' + marker + ' unstaged'),
    );
    assert.match(
      await git.diff(directory, { file: marker + '-new.txt' }),
      new RegExp('\\+' + marker + ' untracked'),
    );
  }
  const before = fixture.runAt(fixture.repo, 'status', '--porcelain=v2', '-z');
  const detachedBefore = fixture.runAt(fixture.detached, 'status', '--porcelain=v2', '-z');
  await git.stage(fixture.feature, ['feature-new.txt']);
  assert.equal((await git.commit(fixture.feature, 'feat: worktree-only commit')).exitCode, 0);
  assert.equal(fixture.runAt(fixture.repo, 'status', '--porcelain=v2', '-z'), before);
  assert.equal(fixture.runAt(fixture.detached, 'status', '--porcelain=v2', '-z'), detachedBefore);
  if (process.getuid?.() !== 0) {
    fs.chmodSync(fixture.feature, 0);
    try {
      await assert.rejects(worktrees.resolve(fixture.repo, locked.path), /权限|denied|Permission/);
    } finally {
      fs.chmodSync(fixture.feature, 0o755);
    }
  }
  await assert.rejects(worktrees.resolve(fixture.repo, list.find((item) => item.prunable).path));
  await assert.rejects(worktrees.resolve(fixture.repo, '/unlisted'), /不在/);
});

test('removed/replaced directories never fall back to a containing or unrelated repository', async (t) => {
  const fixture = createWorktreeRepository();
  t.after(() => fixture.close());
  const reader = new GitWorktrees(fixture.connection);
  const selected = (await reader.list(fixture.repo)).find((item) => item.detached).path;
  fs.unlinkSync(path.join(fixture.detached, '.git'));
  fixture.runAt(fixture.detached, 'init', '-q');
  await assert.rejects(reader.resolve(fixture.repo, selected), /不属于/);
  const nested = path.join(fixture.repo, 'nested-worktree');
  fixture.git('worktree', 'add', '-qb', 'nested', nested);
  const nestedPath = (await reader.list(fixture.repo)).find(
    (item) => item.branch === 'nested',
  ).path;
  fs.unlinkSync(path.join(nested, '.git'));
  await assert.rejects(reader.resolve(fixture.repo, nestedPath), /失效/);
});

test('a sole worktree is current, subdirectories/aliases resolve, and read failures remain failures', async (t) => {
  const fixture = createRepository();
  t.after(() => fixture.close());
  const alias = path.join(fixture.root, 'alias');
  fs.symlinkSync(fixture.repo, alias);
  fs.mkdirSync(path.join(fixture.repo, 'sub'));
  const reader = new GitWorktrees(fixture.connection);
  for (const directory of [fixture.repo, alias, path.join(fixture.repo, 'sub')]) {
    const list = await reader.list(directory);
    assert.equal(list.length, 1);
    assert.equal(list[0].isCurrent, true);
  }
  const failing = new GitWorktrees({
    execCommand: async () => ({ exitCode: 128, stderr: 'permission denied' }),
  });
  await assert.rejects(failing.list('/repo'), /permission denied/);
  const controller = new AbortController();
  controller.abort(new Error('deadline'));
  await assert.rejects(reader.list(fixture.repo, controller.signal), /deadline/);
});
