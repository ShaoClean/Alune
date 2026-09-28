const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');
const {
  GitCommands,
  LocalConnection,
  DiscardChanges,
  NewFileDeletion,
  ignoreDirectory,
  assertFileChanges,
} = require('../dist');
const { changeActions } = require('@alune/shared');

function nested(f, name) {
  f.git('init', '-q', name);
  f.git('-C', name, 'config', 'user.name', 'Fixture');
  f.git('-C', name, 'config', 'user.email', 'fixture@example.invalid');
  f.write(name + '/keep.txt', 'original\n');
  f.git('-C', name, 'add', '.');
  f.git('-C', name, 'commit', '-qm', 'nested');
}

for (const transport of ['local', 'ssh']) {
  test(
    `${transport}: classify, stage, discard and locally ignore directory entries without traversing them`,
    { skip: transport === 'ssh' && process.platform === 'win32' },
    async (t) => {
      const f = createRepository();
      t.after(f.close);
      const remote = transport === 'ssh' ? await connectFixture(f) : null;
      if (remote) t.after(remote.close);
      const connection = remote?.connection || new LocalConnection();
      const commands = new GitCommands(connection);
      nested(f, 'nested repo');
      f.git('worktree', 'add', '-qb', 'demo', '.claude/worktrees/demo');
      f.write('normal folder/new.txt');
      f.write('tracked.txt', 'modified\n');
      const { files } = await commands.status(f.repo);
      const tree = files.find((file) => file.path === '.claude/worktrees/demo/');
      const repo = files.find((file) => file.path === 'nested repo/');
      assert.equal(tree.kind, 'worktree');
      assert.equal(repo.kind, 'repository');
      assert.equal(
        fs.realpathSync(tree.repositoryPath),
        fs.realpathSync(path.join(f.repo, tree.path)),
      );
      assert.equal(changeActions(tree).stage, false);
      assert.equal(changeActions(repo).delete, false);
      assert.equal(changeActions(repo).open, true);
      assert.equal(
        changeActions(files.find((file) => file.path === 'normal folder/new.txt')).stage,
        true,
      );
      const index = f.git('ls-files', '--stage', '-z');
      for (const forbidden of [
        'nested repo',
        'nested repo/keep.txt',
        '.claude/worktrees/demo',
        'normal folder',
      ]) {
        await assert.rejects(
          commands.stage(f.repo, ['tracked.txt', forbidden]),
          /目录|嵌套仓库|路径/,
        );
        assert.equal(f.git('ls-files', '--stage', '-z'), index);
      }
      await assert.rejects(new NewFileDeletion(connection).preview(f.repo, 'nested repo/'), /目录/);
      const discard = new DiscardChanges(connection);
      const preview = await discard.preview(f.repo);
      assert.equal(preview.tracked, 1);
      assert.equal(preview.untracked, 1);
      assert.equal(preview.skipped.length, 2);
      assert.equal((await discard.discard(f.repo, preview.token, 'all')).success, true);
      assert.equal(fs.readFileSync(path.join(f.repo, 'tracked.txt'), 'utf8'), 'original\n');
      assert.equal(fs.existsSync(path.join(f.repo, 'normal folder/new.txt')), false);
      assert.equal(
        fs.readFileSync(path.join(f.repo, 'nested repo/keep.txt'), 'utf8'),
        'original\n',
      );
      assert.equal(fs.existsSync(path.join(f.repo, tree.path, '.git')), true);
      assert.equal(f.git('ls-files', '--stage', '-z'), index);
      const rule = await ignoreDirectory(connection, f.repo, tree.path);
      assert.equal(rule.pattern, '/.claude/worktrees/demo/');
      assert.equal(
        (await commands.status(f.repo)).files.some((file) => file.path === tree.path),
        false,
      );
      assert.equal(fs.existsSync(path.join(f.repo, '.gitignore')), false);
      await ignoreDirectory(connection, f.repo, repo.path);
      assert.equal((await commands.status(f.repo)).files.length, 0);
      assert.ok(
        fs.readFileSync(path.join(f.repo, '.git/info/exclude'), 'utf8').includes('/nested\\ repo/'),
      );
      f.write('normal.txt');
      await commands.stage(f.repo, ['normal.txt']);
      assert.equal((await commands.status(f.repo)).files[0].staged, true);
    },
  );
}

test('tracked submodules retain pointer previews/staging and are excluded from file discard/deletion', async (t) => {
  const f = createRepository();
  t.after(f.close);
  const connection = new LocalConnection();
  const commands = new GitCommands(connection);
  nested(f, 'module');
  f.git('add', 'module');
  f.git('commit', '-qm', 'gitlink');
  f.write('module/keep.txt', 'changed\n');
  let file = (await commands.status(f.repo)).files.find((file) => file.path === 'module');
  assert.equal(file.kind, 'submodule');
  assert.equal(file.submodule.trackedChanges, true);
  assert.equal(changeActions(file).stage, false);
  f.git('-C', 'module', 'commit', '-qam', 'pointer change');
  f.write('module/untracked.txt');
  file = (await commands.status(f.repo)).files.find((file) => file.path === 'module');
  assert.equal(file.submodule.commitChanged, true);
  assert.equal(changeActions(file).stage, true);
  assert.match(await commands.diff(f.repo, { file: 'module' }), /Subproject commit/);
  await commands.stage(f.repo, ['module']);
  assert.match(await commands.diff(f.repo, { file: 'module', staged: true }), /Subproject commit/);
  await assert.rejects(assertFileChanges(connection, f.repo, ['module']), /子模块/);
  f.write('tracked.txt', 'modified\n');
  const discard = new DiscardChanges(connection);
  const preview = await discard.preview(f.repo);
  assert.equal(preview.skipped[0].path, 'module');
  assert.equal((await discard.discard(f.repo, preview.token, 'all')).success, true);
  assert.equal(fs.existsSync(path.join(f.repo, 'module/untracked.txt')), true);
  await commands.unstage(f.repo, ['module']);
  assert.equal(
    (await commands.status(f.repo)).files.some((file) => file.staged),
    false,
  );
});

test('directory replacements and their children are skipped together while other files remain actionable', async (t) => {
  const f = createRepository();
  t.after(f.close);
  fs.unlinkSync(path.join(f.repo, 'tracked.txt'));
  f.write('tracked.txt/keep.txt');
  f.write('loose.txt');
  const connection = new LocalConnection();
  assert.equal(
    (await new GitCommands(connection).status(f.repo)).files.find(
      (file) => file.path === 'tracked.txt',
    ).kind,
    'directory',
  );
  const discard = new DiscardChanges(connection);
  const preview = await discard.preview(f.repo);
  assert.equal(preview.tracked, 0);
  assert.equal(preview.untracked, 1);
  assert.equal(preview.skipped[0].path, 'tracked.txt');
  assert.equal((await discard.discard(f.repo, preview.token, 'all')).success, true);
  assert.equal(fs.existsSync(path.join(f.repo, 'tracked.txt/keep.txt')), true);
});

test('ignore rules escape metacharacters, use the common Git directory, and reject unrelated paths', async (t) => {
  const f = createRepository();
  t.after(f.close);
  const connection = new LocalConnection();
  f.git('worktree', 'add', '-qb', 'other', '../other');
  const name = 'nested [x] ! # space';
  nested(f, name);
  f.git('worktree', 'move', '../other', 'other');
  await ignoreDirectory(connection, f.repo, name + '/');
  assert.equal(
    (await new GitCommands(connection).status(f.repo)).files.some((file) =>
      file.path.startsWith(name),
    ),
    false,
  );
  for (const invalid of ['tracked.txt', '../other/', '.git/', 'normal/', 'bad\nname/'])
    await assert.rejects(ignoreDirectory(connection, f.repo, invalid));
  nested(
    {
      ...f,
      git: (...args) => f.git('-C', 'other', ...args),
      write: (p, content) => f.write('other/' + p, content),
    },
    'nested',
  );
  await ignoreDirectory(connection, path.join(f.repo, 'other'), 'nested/');
  assert.ok(fs.readFileSync(path.join(f.repo, '.git/info/exclude'), 'utf8').includes('/nested/'));
});

test('directory-to-file replacements stage without deleting working contents; file checkout remains guarded', async (t) => {
  const f = createRepository();
  t.after(f.close);
  f.write('dir/child', 'old\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'directory');
  fs.rmSync(path.join(f.repo, 'dir'), { recursive: true });
  f.write('dir', 'replacement\n');
  const connection = new LocalConnection();
  await assert.rejects(assertFileChanges(connection, f.repo, ['dir/child']), /文件/);
  await new GitCommands(connection).stage(f.repo, ['dir', 'dir/child']);
  assert.equal(fs.readFileSync(path.join(f.repo, 'dir'), 'utf8'), 'replacement\n');
  assert.equal(f.git('ls-files', '--', 'dir').trim(), 'dir');
});

test(
  'local ignore refuses a symlinked exclude file without touching its target',
  { skip: process.platform === 'win32' },
  async (t) => {
    const f = createRepository();
    t.after(f.close);
    nested(f, 'nested');
    const outside = path.join(f.root, 'outside.txt');
    fs.writeFileSync(outside, 'keep\n');
    fs.unlinkSync(path.join(f.repo, '.git/info/exclude'));
    fs.symlinkSync(outside, path.join(f.repo, '.git/info/exclude'));
    await assert.rejects(ignoreDirectory(new LocalConnection(), f.repo, 'nested/'), /普通文件/);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'keep\n');
  },
);
