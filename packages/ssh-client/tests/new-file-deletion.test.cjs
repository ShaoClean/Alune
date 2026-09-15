const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRepository } = require('./helpers/local-repository.cjs');
const { NewFileDeletion } = require('../dist/new-file-deletion');
const { GitCommands } = require('../dist/git-commands');

function fixture(t, options) {
  const repo = createRepository(options);
  t.after(repo.close);
  return { ...repo, deletion: new NewFileDeletion(repo.connection) };
}
const exists = (repo, name) => fs.existsSync(path.join(repo, name));

for (const initial of [true, false])
  for (const stage of ['untracked', 'staged', 'mixed', 'intent']) {
    test(`deletes only the selected ${stage} file (${initial ? 'existing' : 'unborn'} HEAD)`, async (t) => {
      const f = fixture(t, { initial });
      const name = '子目录/中文 \' " $(touch sentinel) `touch sentinel` [*]? :文件\t\n.txt';
      f.write(name, 'index version\n');
      f.write('other.txt', 'keep staged\n');
      f.git('add', '--', 'other.txt');
      if (stage === 'intent') f.git('add', '-N', '--', name);
      else if (stage !== 'untracked') f.git('add', '--', name);
      if (stage === 'mixed') f.write(name, 'working tree version\n');
      const before = f.git('ls-files', '--stage', '-z');
      const preview = await f.deletion.preview(f.repo, name);
      assert.equal(preview.path, name);
      assert.equal(preview.staged, ['staged', 'mixed'].includes(stage));
      assert.equal(preview.hasUnstagedChanges, stage !== 'staged');
      // Preparing/cancelling confirmation performs no disk or index writes.
      assert.equal(f.git('ls-files', '--stage', '-z'), before);
      assert.ok(exists(f.repo, name));
      const status = await new GitCommands(f.connection).status(f.repo);
      const rows = status.files.filter((file) => file.path === name);
      assert.equal(rows.length, stage === 'mixed' ? 2 : 1);
      assert.equal(status.branch.includes('branch.head'), false);
      assert.deepEqual(await f.deletion.delete(f.repo, name, preview.token), { success: true });
      assert.equal(exists(f.repo, name), false);
      assert.equal(f.git('ls-files', '--stage', '-z', '--', name), '');
      assert.ok(fs.statSync(path.join(f.repo, '子目录')).isDirectory());
      assert.equal(f.git('show', ':other.txt'), 'keep staged\n');
      assert.equal(
        (await new GitCommands(f.connection).status(f.repo)).files.some(
          (file) => file.path === name,
        ),
        false,
      );
      assert.equal(exists(f.repo, 'sentinel'), false);
      if (initial)
        assert.equal(fs.readFileSync(path.join(f.repo, 'tracked.txt'), 'utf8'), 'original\n');
    });
  }

test('treats Git pathspec magic, leading dashes and backslashes literally', async (t) => {
  const f = fixture(t);
  for (const name of [':(glob)*', '-rf', 'a\\b', ' spaced ']) {
    f.write(name);
    f.write('keep.txt');
    f.git('--literal-pathspecs', 'add', '--', name);
    const preview = await f.deletion.preview(f.repo, name);
    await f.deletion.delete(f.repo, name, preview.token);
    assert.equal(exists(f.repo, name), false);
    assert.ok(exists(f.repo, 'keep.txt'));
  }
});

test('rejects directories, submodules, tracked files, traversal and symlinked parents', async (t) => {
  const f = fixture(t);
  f.write('dir/keep.txt');
  fs.symlinkSync('dir', path.join(f.repo, 'link'));
  f.write('tracked.txt', 'modified\n');
  f.git('add', '--', 'tracked.txt');
  f.git(
    'update-index',
    '--add',
    '--cacheinfo',
    `160000,${f.git('rev-parse', 'HEAD').trim()},submodule`,
  );
  for (const name of [
    '',
    '.',
    '..',
    '../outside',
    '/tmp/outside',
    'dir/../tracked.txt',
    '.git/config',
    'dir',
    'dir/',
    'link/keep.txt',
    'tracked.txt',
    'submodule',
    'bad\0path',
  ]) {
    await assert.rejects(f.deletion.preview(f.repo, name));
  }
  assert.ok(exists(f.repo, 'dir/keep.txt'));
  assert.equal(fs.readFileSync(path.join(f.repo, 'tracked.txt'), 'utf8'), 'modified\n');
});

test('unlinks a symlink without touching its outside target or empty parent directory', async (t) => {
  const f = fixture(t);
  const outside = path.join(f.root, 'outside.txt');
  fs.writeFileSync(outside, 'keep');
  fs.mkdirSync(path.join(f.repo, 'dir'));
  fs.symlinkSync(outside, path.join(f.repo, 'dir/link'));
  f.git('add', '--', 'dir/link');
  const preview = await f.deletion.preview(f.repo, 'dir/link');
  await f.deletion.delete(f.repo, 'dir/link', preview.token);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');
  assert.ok(exists(f.repo, 'dir'));
});

for (const change of ['content', 'index', 'committed', 'removed', 'directory', 'parent-symlink']) {
  test(`rejects confirmation after external ${change} change`, async (t) => {
    const f = fixture(t);
    const name = 'dir/new.txt';
    f.write(name, 'first\n');
    f.git('add', '--', name);
    const preview = await f.deletion.preview(f.repo, name);
    if (change === 'content') f.write(name, 'later\n');
    if (change === 'index') {
      f.write(name, 'later\n');
      f.git('add', '--', name);
    }
    if (change === 'committed') f.git('commit', '-qm', 'external commit');
    if (change === 'removed') fs.unlinkSync(path.join(f.repo, name));
    if (change === 'directory') {
      fs.unlinkSync(path.join(f.repo, name));
      fs.mkdirSync(path.join(f.repo, name));
    }
    if (change === 'parent-symlink') {
      fs.renameSync(path.join(f.repo, 'dir'), path.join(f.root, 'moved'));
      fs.symlinkSync(path.join(f.root, 'moved'), path.join(f.repo, 'dir'));
    }
    const index = f.git('ls-files', '--stage', '-z');
    await assert.rejects(f.deletion.delete(f.repo, name, preview.token));
    assert.equal(f.git('ls-files', '--stage', '-z'), index);
  });
}

test('cleans staged additions already missing from disk after a fresh confirmation', async (t) => {
  const f = fixture(t, { initial: false });
  f.write('gone/file.txt');
  f.git('add', '--', 'gone/file.txt');
  fs.rmSync(path.join(f.repo, 'gone'), { recursive: true });
  const preview = await f.deletion.preview(f.repo, 'gone/file.txt');
  assert.equal(preview.diskPresent, false);
  await f.deletion.delete(f.repo, 'gone/file.txt', preview.token);
  assert.equal(f.git('ls-files', '--stage', '-z'), '');
});

test('reports partial completion on permission failure and permits a fresh retry', async (t) => {
  const f = fixture(t);
  f.write('new.txt');
  f.git('add', '--', 'new.txt');
  const preview = await f.deletion.preview(f.repo, 'new.txt');
  f.connection.withSftp = (operation) =>
    operation({
      ...fs,
      unlink(_path, done) {
        done(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));
      },
    });
  await assert.rejects(
    f.deletion.delete(f.repo, 'new.txt', preview.token),
    /Permission denied.*磁盘文件：仍存在；暂存记录：已清理/,
  );
  assert.ok(exists(f.repo, 'new.txt'));
  assert.equal(f.git('ls-files', '--stage', '-z', '--', 'new.txt'), '');
  f.connection.withSftp = (operation) => operation(fs);
  const retry = await f.deletion.preview(f.repo, 'new.txt');
  await f.deletion.delete(f.repo, 'new.txt', retry.token);
  assert.equal(exists(f.repo, 'new.txt'), false);
});

test('index lock failure leaves file and staged content intact', async (t) => {
  const f = fixture(t);
  f.write('new.txt');
  f.git('add', '--', 'new.txt');
  const preview = await f.deletion.preview(f.repo, 'new.txt');
  fs.writeFileSync(path.join(f.repo, '.git/index.lock'), '');
  await assert.rejects(
    f.deletion.delete(f.repo, 'new.txt', preview.token),
    /磁盘文件：仍存在；暂存记录：仍存在/,
  );
  assert.ok(exists(f.repo, 'new.txt'));
  assert.equal(f.git('show', ':new.txt'), 'new file\n');
});

test('a lost acknowledgement after clearing the index reports an unknown result', async (t) => {
  const f = fixture(t);
  f.write('new.txt');
  f.git('add', '--', 'new.txt');
  const preview = await f.deletion.preview(f.repo, 'new.txt');
  const original = f.connection.execCommand;
  let disconnected = false;
  f.connection.execCommand = async (...args) => {
    if (disconnected) throw new Error('SSH disconnected');
    const result = await original(...args);
    if (args[0].includes("'rm' '--cached'")) {
      disconnected = true;
      throw new Error('SSH disconnected');
    }
    return result;
  };
  f.connection.withSftp = (operation) =>
    disconnected ? Promise.reject(new Error('SSH disconnected')) : operation(fs);
  await assert.rejects(
    f.deletion.delete(f.repo, 'new.txt', preview.token),
    /SSH disconnected.*磁盘文件：无法确认.*暂存记录：无法确认/,
  );
  assert.ok(exists(f.repo, 'new.txt'));
  assert.equal(f.git('ls-files', '--stage', '-z', '--', 'new.txt'), '');
});

test('untracked directory contents and both sides of tracked mixed edits remain visible', async (t) => {
  const f = fixture(t);
  f.write('dir/one.txt');
  f.write('dir/two.txt');
  f.write('tracked.txt', 'staged\n');
  f.git('add', '--', 'tracked.txt');
  f.write('tracked.txt', 'working\n');
  const status = await new GitCommands(f.connection).status(f.repo);
  assert.ok(status.files.some((file) => file.path === 'dir/one.txt'));
  assert.ok(status.files.some((file) => file.path === 'dir/two.txt'));
  assert.equal(status.files.filter((file) => file.path === 'tracked.txt').length, 2);
});

test('deletes force-added ignored files even when they disappear from status after unstage', async (t) => {
  const f = fixture(t);
  f.write('.gitignore', 'ignored.txt\n');
  f.write('ignored.txt');
  f.git('add', '-f', '--', 'ignored.txt');
  const preview = await f.deletion.preview(f.repo, 'ignored.txt');
  await f.deletion.delete(f.repo, 'ignored.txt', preview.token);
  assert.equal(exists(f.repo, 'ignored.txt'), false);
  assert.ok(exists(f.repo, '.gitignore'));
});

test('rejects renamed tracked files and preserves both the old and new paths in status', async (t) => {
  const f = fixture(t);
  const name = 'renamed 中文.txt';
  f.git('mv', 'tracked.txt', name);
  const status = await new GitCommands(f.connection).status(f.repo);
  assert.deepEqual(status.files, [
    { path: name, oldPath: 'tracked.txt', status: 'renamed', staged: true },
  ]);
  await assert.rejects(f.deletion.preview(f.repo, name), /不再是新增文件/);
  assert.ok(exists(f.repo, name));
});

test('preserves a file restaged by another writer after index cleanup', async (t) => {
  const f = fixture(t);
  f.write('new.txt');
  f.git('add', '--', 'new.txt');
  const preview = await f.deletion.preview(f.repo, 'new.txt');
  const original = f.connection.execCommand;
  f.connection.execCommand = async (...args) => {
    const result = await original(...args);
    if (args[0].includes("'rm' '--cached'")) {
      f.write('new.txt', 'concurrent staged contents\n');
      f.git('add', '--', 'new.txt');
    }
    return result;
  };
  await assert.rejects(
    f.deletion.delete(f.repo, 'new.txt', preview.token),
    /重新暂存或提交.*磁盘文件：仍存在；暂存记录：仍存在/,
  );
  assert.equal(f.git('show', ':new.txt'), 'concurrent staged contents\n');
  assert.equal(
    fs.readFileSync(path.join(f.repo, 'new.txt'), 'utf8'),
    'concurrent staged contents\n',
  );
});

test('does not report success or remove a file recreated after unlink', async (t) => {
  const f = fixture(t);
  f.write('new.txt');
  const preview = await f.deletion.preview(f.repo, 'new.txt');
  f.connection.withSftp = (operation) =>
    operation({
      ...fs,
      unlink(filename, done) {
        fs.unlink(filename, (error) => {
          if (!error) f.write('new.txt', 'recreated\n');
          done(error);
        });
      },
    });
  await assert.rejects(
    f.deletion.delete(f.repo, 'new.txt', preview.token),
    /无法确认删除结果.*磁盘文件：仍存在；暂存记录：已清理/,
  );
  assert.equal(fs.readFileSync(path.join(f.repo, 'new.txt'), 'utf8'), 'recreated\n');
});
