const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');
const { WorkspaceFileActions, validateWorkspaceName, LocalConnection } = require('../dist');

for (const remote of [false, true]) {
  test(
    `workspace file actions preserve index and target only the requested file (${remote ? 'SSH/SFTP' : 'local'})`,
    { timeout: 60000 },
    async (t) => {
      const f = createRepository();
      t.after(f.close);
      const ssh = remote ? await connectFixture(f) : null;
      if (ssh) t.after(ssh.close);
      const connection = ssh?.connection || new LocalConnection();
      const actions = new WorkspaceFileActions(connection);
      for (const state of ['untracked', 'modified', 'staged', 'mixed', 'intent']) {
        const name = `目录/中文 ' $ [*] ${state}.txt`;
        f.write(name, 'original');
        if (state === 'modified') {
          f.git('add', '--', name);
          f.git('commit', '-qm', 'track');
        }
        if (['staged', 'mixed'].includes(state)) f.git('add', '--', name);
        if (state === 'intent') f.git('add', '-N', '--', name);
        if (['modified', 'mixed'].includes(state)) f.write(name, 'worktree version');
        const before = f.git('ls-files', '--stage', '-z');
        const preview = await actions.preview(f.repo, name);
        assert.equal(preview.canModify, true);
        assert.equal(preview.absolutePath, path.join(fs.realpathSync(f.repo), name));
        assert.equal(preview.staged, ['staged', 'mixed'].includes(state));
        assert.equal(f.git('ls-files', '--stage', '-z'), before, 'preview/cancel preserves index');
        assert.ok(fs.existsSync(path.join(f.repo, name)), 'preview/cancel preserves disk');
        const newName = `renamed ${state}.txt`;
        const result = await actions.mutate(f.repo, name, preview.token, 'rename', newName);
        assert.equal(result.newPath, `目录/${newName}`);
        assert.equal(fs.existsSync(path.join(f.repo, name)), false);
        assert.equal(f.git('ls-files', '--stage', '-z'), before);
        const next = await actions.preview(f.repo, result.newPath);
        await actions.mutate(f.repo, result.newPath, next.token, 'delete');
        assert.equal(fs.existsSync(path.join(f.repo, result.newPath)), false);
        assert.equal(f.git('ls-files', '--stage', '-z'), before);
        assert.equal((await actions.preview(f.repo, result.newPath)).canModify, false);
      }
      f.write('case.txt');
      const preview = await actions.preview(f.repo, 'case.txt');
      await actions.mutate(f.repo, 'case.txt', preview.token, 'rename', 'CASE.txt');
      const listing = fs.readdirSync(f.repo);
      assert.ok(listing.includes('CASE.txt'));
      assert.ok(!listing.includes('case.txt'));
      // Confirm deleting a staged-and-modified file keeps the original staged blob.
      f.write('tracked.txt', 'staged');
      f.git('add', 'tracked.txt');
      f.write('tracked.txt', 'unstaged');
      const p = await actions.preview(f.repo, 'tracked.txt');
      await actions.mutate(f.repo, 'tracked.txt', p.token, 'delete');
      assert.equal(f.git('show', ':tracked.txt'), 'staged');
    },
  );
}

test('rejects stale confirmations, overwrite, unsafe boundaries and invalid names', async (t) => {
  const f = createRepository();
  t.after(f.close);
  const actions = new WorkspaceFileActions(new LocalConnection());
  let p = await actions.preview(f.repo, 'tracked.txt');
  f.write('tracked.txt', 'concurrent modification');
  await assert.rejects(actions.mutate(f.repo, 'tracked.txt', p.token, 'delete'), /变化/);
  p = await actions.preview(f.repo, 'tracked.txt');
  f.git('add', 'tracked.txt');
  await assert.rejects(actions.mutate(f.repo, 'tracked.txt', p.token, 'rename', 'next'), /变化/);
  p = await actions.preview(f.repo, 'tracked.txt');
  f.write('existing', 'keep');
  await assert.rejects(
    actions.mutate(f.repo, 'tracked.txt', p.token, 'rename', 'existing'),
    /已存在/,
  );
  assert.equal(fs.readFileSync(path.join(f.repo, 'existing'), 'utf8'), 'keep');
  for (const name of ['', ' ', '..', '.git', '../outside', 'sub/file', 'bad\0name'])
    await assert.rejects(actions.mutate(f.repo, 'tracked.txt', p.token, 'rename', name));
  for (const name of ['NUL', 'CON.txt', 'foo.', 'foo ', 'a:b', 'a\\b', 'a?', 'a\n'])
    assert.throws(() => validateWorkspaceName('C:/repo', name));
  validateWorkspaceName('/repo', '合法 : ? \\ name');
  for (const name of ['../outside', '/outside', '.git/config', 'a/../tracked.txt'])
    await assert.rejects(actions.preview(f.repo, name));
  fs.writeFileSync(path.join(f.root, 'outside'), 'keep');
  fs.symlinkSync(f.root, path.join(f.repo, 'link'));
  await assert.rejects(actions.preview(f.repo, 'link/outside'), /符号链接/);
  f.write('nested/.git', 'gitdir: elsewhere');
  f.write('nested/file', 'keep');
  await assert.rejects(actions.preview(f.repo, 'nested/file'), /嵌套仓库/);
  fs.symlinkSync(path.join(f.root, 'outside'), path.join(f.repo, 'symbolic'));
  p = await actions.preview(f.repo, 'symbolic');
  await actions.mutate(f.repo, 'symbolic', p.token, 'delete');
  assert.equal(fs.readFileSync(path.join(f.root, 'outside'), 'utf8'), 'keep');
  assert.equal((await actions.preview(f.repo, 'nested')).canModify, false);
});

test('uses the selected Worktree root and refuses races creating the destination', async (t) => {
  const f = createRepository();
  t.after(f.close);
  const worktree = path.join(f.root, 'other worktree');
  f.git('worktree', 'add', '-qb', 'feature', worktree);
  const local = new LocalConnection();
  const actions = new WorkspaceFileActions(local);
  const p = await actions.preview(worktree, 'tracked.txt');
  assert.equal(p.absolutePath, path.join(fs.realpathSync(worktree), 'tracked.txt'));
  await actions.mutate(worktree, 'tracked.txt', p.token, 'delete');
  assert.ok(fs.existsSync(path.join(f.repo, 'tracked.txt')));
  const race = new WorkspaceFileActions({
    execGit: local.execGit.bind(local),
    execCommand: local.execCommand.bind(local),
    withSftp: (op) =>
      local.withSftp((sftp) =>
        op({
          ...sftp,
          rename(source, dest, cb) {
            fs.writeFileSync(dest, 'concurrent');
            sftp.rename(source, dest, cb);
          },
        }),
      ),
  });
  const next = await race.preview(f.repo, 'tracked.txt');
  await assert.rejects(race.mutate(f.repo, 'tracked.txt', next.token, 'rename', 'new.txt'));
  assert.equal(fs.readFileSync(path.join(f.repo, 'new.txt'), 'utf8'), 'concurrent');
  assert.ok(fs.existsSync(path.join(f.repo, 'tracked.txt')));
});

test('reports permission failures and lost connection without success', async (t) => {
  const f = createRepository();
  t.after(f.close);
  const local = new LocalConnection();
  for (const action of ['delete', 'rename']) {
    const actions = new WorkspaceFileActions({
      execGit: local.execGit.bind(local),
      execCommand: local.execCommand.bind(local),
      withSftp: (op) =>
        local.withSftp((sftp) =>
          op({
            ...sftp,
            unlink: (_p, cb) => cb(Object.assign(new Error('denied'), { code: 'EACCES' })),
            rename: (_p, _d, cb) => cb(new Error('SSH disconnected')),
          }),
        ),
    });
    const p = await actions.preview(f.repo, 'tracked.txt');
    await assert.rejects(
      actions.mutate(f.repo, 'tracked.txt', p.token, action, 'next'),
      /权限|disconnected/,
    );
    assert.ok(fs.existsSync(path.join(f.repo, 'tracked.txt')));
  }
});

test('rejects files inside uninitialized gitlinks and edits with unchanged size/mtime', async (t) => {
  const f = createRepository();
  t.after(f.close);
  const actions = new WorkspaceFileActions(new LocalConnection());
  f.git(
    'update-index',
    '--add',
    '--cacheinfo',
    `160000,${f.git('rev-parse', 'HEAD').trim()},module`,
  );
  f.write('module/file', 'keep');
  await assert.rejects(actions.preview(f.repo, 'module/file'), /子模块/);
  const stat = fs.statSync(path.join(f.repo, 'tracked.txt'));
  const preview = await actions.preview(f.repo, 'tracked.txt');
  f.write('tracked.txt', 'modified\n');
  fs.utimesSync(path.join(f.repo, 'tracked.txt'), stat.atime, stat.mtime);
  await assert.rejects(actions.mutate(f.repo, 'tracked.txt', preview.token, 'delete'), /变化/);
});

test('does not report success when the connection fails after unlink', async (t) => {
  const f = createRepository();
  t.after(f.close);
  const local = new LocalConnection();
  let removed = false;
  const actions = new WorkspaceFileActions({
    execGit: local.execGit.bind(local),
    execCommand: local.execCommand.bind(local),
    withSftp: (op) =>
      local.withSftp((sftp) =>
        op({
          ...sftp,
          unlink(file, cb) {
            sftp.unlink(file, (error) => {
              removed = !error;
              cb(error);
            });
          },
          lstat(file, cb) {
            if (removed) cb(new Error('SSH disconnected after unlink'));
            else sftp.lstat(file, cb);
          },
        }),
      ),
  });
  const preview = await actions.preview(f.repo, 'tracked.txt');
  const before = f.git('ls-files', '--stage', '-z');
  await assert.rejects(
    actions.mutate(f.repo, 'tracked.txt', preview.token, 'delete'),
    /disconnected after unlink/,
  );
  assert.equal(fs.existsSync(path.join(f.repo, 'tracked.txt')), false);
  assert.equal(f.git('ls-files', '--stage', '-z'), before);
});

test('reports all possible paths when case-only rename loses its completion acknowledgement', async (t) => {
  const f = createRepository();
  t.after(f.close);
  f.write('case.txt', 'preserve contents');
  const local = new LocalConnection();
  let lostAcknowledgement = false;
  const actions = new WorkspaceFileActions({
    execGit: local.execGit.bind(local),
    execCommand: local.execCommand.bind(local),
    withSftp: (op) =>
      local.withSftp((sftp) =>
        op({
          ...sftp,
          // Model case-insensitive lookup on every CI host, including Linux.
          lstat(file, cb) {
            if (!lostAcknowledgement && path.basename(file) === 'CASE.txt')
              return sftp.lstat(path.join(path.dirname(file), 'case.txt'), cb);
            sftp.lstat(file, cb);
          },
          rename(source, destination, cb) {
            sftp.rename(source, destination, (error) => {
              if (!error && path.basename(destination) === 'CASE.txt') {
                lostAcknowledgement = true;
                return cb(new Error('SSH disconnected after rename'));
              }
              cb(error);
            });
          },
        }),
      ),
  });
  const preview = await actions.preview(f.repo, 'case.txt');
  await assert.rejects(
    actions.mutate(f.repo, 'case.txt', preview.token, 'rename', 'CASE.txt'),
    (error) => {
      assert.match(error.message, /无法确认恢复结果/);
      assert.match(error.message, /原路径 .*case\.txt/);
      assert.match(error.message, /新路径 .*CASE\.txt/);
      assert.match(error.message, /临时路径 .*\.alune-rename-/);
      assert.doesNotMatch(error.message, /文件保留在/);
      return true;
    },
  );
  assert.equal(fs.readFileSync(path.join(f.repo, 'CASE.txt'), 'utf8'), 'preserve contents');
  assert.ok(!fs.readdirSync(f.repo).some((name) => name.startsWith('.alune-rename-')));
});
