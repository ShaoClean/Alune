const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');
const { DiscardChanges, LocalConnection } = require('../dist');

function fixture(t, options) {
  const f = createRepository(options);
  f.git('config', 'core.autocrlf', 'false');
  f.git('config', 'core.safecrlf', 'false');
  t.after(f.close);
  const connection = new LocalConnection();
  return {
    ...f,
    shellConnection: f.connection,
    connection,
    discard: new DiscardChanges(connection),
  };
}
const read = (f, name) => fs.readFileSync(path.join(f.repo, name), 'utf8');
const exists = (f, name) => fs.existsSync(path.join(f.repo, name));
const index = (f) => f.git('ls-files', '--stage', '-z');
const perform = async (f, scope = 'all') => {
  const preview = await f.discard.preview(f.repo);
  return f.discard.discard(f.repo, preview.token, scope);
};

for (const initial of [true, false]) {
  for (const scope of ['tracked', 'all']) {
    test(`${scope}: preserves the index and staged new files with ${initial ? 'existing' : 'unborn'} HEAD`, async (t) => {
      const f = fixture(t, { initial });
      for (const name of ['tracked.txt', 'new-staged.txt', 'deleted.txt', 'only-staged.txt']) {
        f.write(name, 'index contents\n');
        f.git('add', '--', name);
      }
      f.write('.gitignore', 'ignored/\n');
      f.git('add', '--', '.gitignore');
      f.write('ignored/keep.txt', 'ignored\n');
      f.write('tracked.txt', 'working contents\n');
      f.write('new-staged.txt', 'working contents\n');
      fs.unlinkSync(path.join(f.repo, 'deleted.txt'));
      f.write('loose.txt');
      f.write('dir/loose.txt');
      const before = index(f);
      const indexBytes = fs.readFileSync(path.join(f.repo, '.git/index'));
      const preview = await f.discard.preview(f.repo);
      assert.equal(preview.tracked, 3);
      assert.equal(preview.untracked, 2);
      // Preparing or cancelling the dialog must not even refresh the index file.
      assert.deepEqual(fs.readFileSync(path.join(f.repo, '.git/index')), indexBytes);
      assert.equal(read(f, 'tracked.txt'), 'working contents\n');
      assert.equal(exists(f, 'deleted.txt'), false);
      assert.deepEqual(await f.discard.discard(f.repo, preview.token, scope), {
        success: true,
        restored: 3,
        deleted: scope === 'all' ? 2 : 0,
        remaining: 0,
        unknown: 0,
      });
      assert.equal(index(f), before);
      for (const name of ['tracked.txt', 'new-staged.txt', 'deleted.txt', 'only-staged.txt']) {
        assert.equal(read(f, name), 'index contents\n');
      }
      assert.equal(read(f, 'ignored/keep.txt'), 'ignored\n');
      assert.equal(exists(f, 'loose.txt'), scope === 'tracked');
      assert.equal(exists(f, 'dir/loose.txt'), scope === 'tracked');
      assert.equal(exists(f, 'dir'), true);
    });
  }
}

test('restores tracked deletions and staged renames without changing staged deletion entries', async (t) => {
  const f = fixture(t);
  f.write('gone.txt');
  f.write('staged-deletion.txt');
  f.git('add', '.');
  f.git('commit', '-qm', 'more files');
  fs.unlinkSync(path.join(f.repo, 'gone.txt'));
  f.git('mv', 'tracked.txt', 'renamed.txt');
  f.write('renamed.txt', 'unstaged edit\n');
  f.git('rm', '--', 'staged-deletion.txt');
  const before = index(f);
  const result = await perform(f);
  assert.equal(result.success, true);
  assert.equal(result.restored, 2);
  assert.equal(read(f, 'renamed.txt'), 'original\n');
  assert.equal(read(f, 'gone.txt'), 'new file\n');
  assert.equal(exists(f, 'staged-deletion.txt'), false);
  assert.equal(index(f), before);
});

test(
  'literal paths cannot expand to other files or execute shell code',
  { skip: process.platform === 'win32' },
  async (t) => {
    const f = fixture(t);
    const names = [
      ':(glob)*',
      '-rf',
      'dir/中文 \' " $(touch sentinel) `touch sentinel` [*]?\t\n.txt',
      'a\\b',
      ' spaced ',
    ];
    for (const name of names) {
      f.write(name, 'index version\n');
      f.git('--literal-pathspecs', 'add', '--', name);
      f.write(name, 'working version\n');
    }
    f.write('untracked\n" [*].txt');
    const before = index(f);
    const result = await perform(f);
    assert.equal(result.success, true);
    assert.equal(result.restored, names.length);
    assert.equal(result.deleted, 1);
    for (const name of names) assert.equal(read(f, name), 'index version\n');
    assert.equal(exists(f, 'sentinel'), false);
    assert.equal(read(f, 'tracked.txt'), 'original\n');
    assert.equal(index(f), before);
  },
);

test('touches only the current worktree and keeps the other worktree index intact', async (t) => {
  const f = fixture(t);
  const other = path.join(f.root, 'other');
  f.git('worktree', 'add', '-q', '-b', 'other', other);
  fs.writeFileSync(path.join(other, 'tracked.txt'), 'other working contents\n');
  fs.writeFileSync(path.join(other, 'loose.txt'), 'keep other\n');
  f.write('tracked.txt', 'main edit\n');
  f.write('loose.txt');
  assert.equal((await perform(f)).success, true);
  assert.equal(
    fs.readFileSync(path.join(other, 'tracked.txt'), 'utf8'),
    'other working contents\n',
  );
  assert.equal(fs.readFileSync(path.join(other, 'loose.txt'), 'utf8'), 'keep other\n');
  const preview = await f.discard.preview(other);
  assert.equal(preview.tracked, 1);
  assert.equal(preview.untracked, 1);
  assert.equal((await f.discard.discard(other, preview.token, 'tracked')).success, true);
  assert.equal(fs.readFileSync(path.join(other, 'tracked.txt'), 'utf8'), 'original\n');
  assert.equal(fs.readFileSync(path.join(other, 'loose.txt'), 'utf8'), 'keep other\n');
});

for (const change of ['content', 'untracked-content', 'index', 'branch', 'new-path']) {
  test(`rejects stale confirmation after ${change} changes, without any writes`, async (t) => {
    const f = fixture(t);
    f.write('tracked.txt', 'first edit\n');
    f.write('loose.txt', 'first edit\n');
    const preview = await f.discard.preview(f.repo);
    if (change === 'content' || change === 'untracked-content') {
      const name = change === 'content' ? 'tracked.txt' : 'loose.txt';
      const previous = fs.statSync(path.join(f.repo, name));
      f.write(name, 'other edit\n'); // Same status, same size, same mtime.
      fs.utimesSync(path.join(f.repo, name), previous.atime, previous.mtime);
    }
    if (change === 'index') f.git('add', '--', 'loose.txt');
    if (change === 'branch') f.git('checkout', '-qb', 'other');
    if (change === 'new-path') f.write('another.txt');
    const before = index(f);
    const contents = read(f, 'tracked.txt');
    await assert.rejects(f.discard.discard(f.repo, preview.token, 'all'), /已变化/);
    assert.equal(read(f, 'tracked.txt'), contents);
    assert.equal(index(f), before);
    assert.equal(exists(f, 'loose.txt'), true);
  });
}

test('blocks conflicts and intent-to-add before discarding', async (t) => {
  for (const kind of ['conflict', 'intent']) {
    await t.test(kind, async (t) => {
      const f = fixture(t);
      if (kind === 'conflict') {
        f.git('checkout', '-qb', 'topic');
        f.write('tracked.txt', 'topic\n');
        f.git('commit', '-qam', 'topic');
        f.git('checkout', '-q', '-');
        f.write('tracked.txt', 'base\n');
        f.git('commit', '-qam', 'base');
        assert.throws(() => f.git('merge', 'topic'));
      } else {
        f.write('intent.txt');
        f.git('add', '-N', '--', 'intent.txt');
      }
      const before = index(f);
      await assert.rejects(f.discard.preview(f.repo), /冲突|子模块|嵌套仓库|意向添加|目录/);
      assert.equal(index(f), before);
    });
  }
});

test(
  'protects symlink targets, refuses symlink parents and skips newly nested repositories',
  { skip: process.platform === 'win32' },
  async (t) => {
    const f = fixture(t);
    const outside = path.join(f.root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'outside\n');
    fs.symlinkSync(path.join(outside, 'keep.txt'), path.join(f.repo, 'link'));
    assert.equal((await perform(f)).deleted, 1);
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'outside\n');
    f.write('dir/keep.txt');
    f.git('add', '--', 'dir/keep.txt');
    f.write('dir/keep.txt', 'changed\n');
    const preview = await f.discard.preview(f.repo);
    fs.rmSync(path.join(f.repo, 'dir'), { recursive: true });
    fs.symlinkSync(outside, path.join(f.repo, 'dir'));
    await assert.rejects(f.discard.discard(f.repo, preview.token, 'all'), /符号链接/);
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'outside\n');
    fs.unlinkSync(path.join(f.repo, 'dir'));
    f.git('init', '-q', 'dir');
    f.write('dir/keep.txt', 'nested edit\n');
    const nested = await f.discard.preview(f.repo);
    assert.equal(nested.skipped[0].path, 'dir');
    assert.equal((await f.discard.discard(f.repo, nested.token, 'all')).success, true);
    assert.equal(read(f, 'dir/keep.txt'), 'nested edit\n');
  },
);

test('returns actual partial results and preserves the index after a permission failure', async (t) => {
  const f = fixture(t);
  f.write('tracked.txt', 'edit\n');
  f.write('a-new.txt');
  f.write('b-new.txt');
  const before = index(f);
  const original = f.connection.withSftp.bind(f.connection);
  f.connection.withSftp = (operation) =>
    original((sftp) =>
      operation({
        ...sftp,
        unlink(filename, done) {
          if (filename.endsWith('b-new.txt'))
            done(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));
          else sftp.unlink(filename, done);
        },
      }),
    );
  const result = await perform(f);
  assert.deepEqual(
    { ...result, error: undefined },
    {
      success: false,
      restored: 1,
      deleted: 1,
      remaining: 1,
      unknown: 0,
      error: undefined,
    },
  );
  assert.match(result.error, /Permission denied/);
  assert.equal(index(f), before);
  assert.equal(read(f, 'tracked.txt'), 'original\n');
  assert.equal(exists(f, 'b-new.txt'), true);
  f.connection.withSftp = original;
  assert.equal((await perform(f)).success, true);
});

test('stops when another writer changes a remaining file during the batch', async (t) => {
  const f = fixture(t);
  f.write('tracked.txt', 'edit\n');
  f.write('loose.txt', 'confirmed\n');
  const exec = f.connection.execGit.bind(f.connection);
  f.connection.execGit = async (...args) => {
    const result = await exec(...args);
    if (args[1].includes('restore')) f.write('loose.txt', 'concurrent edit\n');
    return result;
  };
  const result = await perform(f);
  assert.equal(result.success, false);
  assert.equal(result.restored, 1);
  assert.equal(result.remaining, 1);
  assert.match(result.error, /已变化/);
  assert.equal(read(f, 'loose.txt'), 'concurrent edit\n');
});

test('does not report success when a deleted file is recreated', async (t) => {
  const f = fixture(t);
  f.write('loose.txt');
  const original = f.connection.withSftp.bind(f.connection);
  f.connection.withSftp = (operation) =>
    original((sftp) =>
      operation({
        ...sftp,
        unlink(filename, done) {
          sftp.unlink(filename, (error) => {
            if (!error) f.write('loose.txt', 'recreated\n');
            done(error);
          });
        },
      }),
    );
  const result = await perform(f);
  assert.equal(result.success, false);
  assert.equal(result.deleted, 0);
  assert.equal(result.remaining, 1);
  assert.equal(read(f, 'loose.txt'), 'recreated\n');
});

test('never deletes a file that becomes ignored after restoring .gitignore', async (t) => {
  const f = fixture(t);
  f.write('.gitignore', 'loose.txt\n');
  f.git('add', '--', '.gitignore');
  f.write('.gitignore', '');
  f.write('loose.txt');
  const result = await perform(f);
  assert.equal(result.success, false);
  assert.equal(result.restored, 1);
  assert.equal(result.deleted, 0);
  assert.equal(exists(f, 'loose.txt'), true);
});

test('clean repositories and invalid requests never perform writes', async (t) => {
  const f = fixture(t);
  const before = index(f);
  const preview = await f.discard.preview(f.repo);
  assert.equal(preview.tracked + preview.untracked, 0);
  assert.equal((await f.discard.discard(f.repo, preview.token, 'all')).success, true);
  for (const [token, scope] of [
    [null, 'all'],
    ['bad', 'all'],
    [preview.token, true],
    [preview.token, undefined],
  ]) {
    await assert.rejects(f.discard.discard(f.repo, token, scope), /确认放弃范围/);
  }
  f.write('dir/loose.txt');
  await assert.rejects(f.discard.preview(path.join(f.repo, 'dir')), /根目录/);
  assert.equal(index(f), before);
});

test(
  'real SSH/SFTP uses the same scopes, preserves staged files and reports a lost connection',
  { skip: process.platform === 'win32', timeout: 60000 },
  async (t) => {
    const f = fixture(t, { initial: false });
    const ssh = await connectFixture({ ...f, connection: f.shellConnection }, { maxSessions: 2 });
    t.after(ssh.close);
    f.discard = new DiscardChanges(ssh.connection);
    f.write('staged.txt', 'index version\n');
    f.git('add', '--', 'staged.txt');
    f.write('staged.txt', 'working version\n');
    f.write('中文 \' " $ [*]\n.txt');
    f.write('.gitignore', 'ignored/\n');
    f.git('add', '--', '.gitignore');
    f.write('ignored/keep.txt');
    const before = index(f);
    assert.equal((await perform(f, 'tracked')).restored, 1);
    assert.equal(read(f, 'staged.txt'), 'index version\n');
    assert.equal((await perform(f, 'all')).deleted, 1);
    assert.equal(index(f), before);
    assert.equal(exists(f, 'ignored/keep.txt'), true);
    f.write('staged.txt', 'another edit\n');
    f.write('loose.txt');
    const preview = await f.discard.preview(f.repo);
    const exec = ssh.connection.execCommand.bind(ssh.connection);
    ssh.connection.execCommand = async (...args) => {
      const result = await exec(...args);
      if (args[0].includes("'restore'")) {
        ssh.connection.disconnect();
        throw new Error('SSH disconnected after restore');
      }
      return result;
    };
    const result = await f.discard.discard(f.repo, preview.token, 'all');
    assert.equal(result.success, false);
    assert.equal(result.unknown, 2);
    assert.match(result.error, /SSH disconnected.*无法核验/);
    assert.equal(read(f, 'staged.txt'), 'index version\n');
    assert.equal(exists(f, 'loose.txt'), true);
    assert.equal(index(f), before);
    assert.equal(ssh.sessions.rejected, 0);
  },
);
