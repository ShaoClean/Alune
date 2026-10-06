const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');
const { ConflictResolution, GitCommands, LocalConnection } = require('../dist');
const { conflictBlocks } = require('@alune/shared');

// LocalConnection inherits this process's Git configuration.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const FILE = '目录/冲突 文件.txt';

// main and feature both edit FILE; feature also deletes gone.txt while main edits it.
function diverged(f) {
  f.write(FILE, 'top\nshared\nbottom\n');
  f.write('gone.txt', 'keep\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'base');
  f.git('branch', '-q', 'feature');
  f.write(FILE, 'top\nours\nbottom\n');
  f.write('gone.txt', 'edited on main\n');
  f.git('commit', '-qam', 'main edit');
  f.git('checkout', '-q', 'feature');
  f.write(FILE, 'top\ntheirs\nbottom\n');
  f.git('rm', '-q', 'gone.txt');
  f.git('commit', '-qam', 'feature edit');
  f.write('second.txt', 'feature second\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'feature second');
  f.git('checkout', '-q', 'master');
}

function failing(f, ...args) {
  assert.throws(() => f.git(...args));
}

// "exec" drives Git through shell command strings and SFTP calls like SSH, without a socket.
for (const transport of ['local', 'exec', 'ssh']) {
  const setup = async (t) => {
    const f = createRepository();
    t.after(f.close);
    f.git('checkout', '-qB', 'master');
    const remote = transport === 'ssh' ? await connectFixture(f) : null;
    if (remote) t.after(remote.close);
    const connection =
      remote?.connection ||
      (transport === 'exec'
        ? {
            execCommand: f.connection.execCommand,
            withSftp: (run) => new LocalConnection().withSftp(run),
          }
        : new LocalConnection());
    return { f, conflicts: new ConflictResolution(connection), git: new GitCommands(connection) };
  };

  test(
    `${transport}: merge conflicts report kinds, resolve per block and continue`,
    { skip: transport === 'ssh' && process.platform === 'win32' },
    async (t) => {
      const { f, conflicts, git } = await setup(t);
      diverged(f);
      f.git('config', 'merge.conflictStyle', 'diff3');
      assert.equal(await conflicts.state(f.repo), undefined);
      failing(f, 'merge', '--no-edit', 'feature');

      const state = await conflicts.state(f.repo);
      assert.equal(state.kind, 'merge');
      assert.equal(state.branch, 'feature');
      assert.equal(state.commit, f.git('rev-parse', 'feature').trim());
      assert.equal(state.subject, 'feature second');

      const status = await git.status(f.repo);
      const kinds = Object.fromEntries(
        status.files.filter((file) => file.conflicted).map((file) => [file.path, file.conflict]),
      );
      assert.deepEqual(kinds, { [FILE]: 'both-modified', 'gone.txt': 'deleted-by-them' });

      const content = fs.readFileSync(path.join(f.repo, FILE), 'utf8');
      const [block] = conflictBlocks(content);
      assert.equal(block.base, 'shared\n');
      await assert.rejects(
        conflicts.continue(f.repo),
        (error) => error.statusCode === 409 && /未解决的冲突/.test(error.message),
      );
      await assert.rejects(
        conflicts.resolveBlock(f.repo, FILE, 0, 'both', 'stale'),
        (error) => error.statusCode === 409,
      );
      await conflicts.resolveBlock(f.repo, FILE, 0, 'both', block.raw);
      assert.equal(fs.readFileSync(path.join(f.repo, FILE), 'utf8'), 'top\nours\ntheirs\nbottom\n');
      // Still unmerged until it is marked resolved.
      assert.equal((await conflicts.unmerged(f.repo, [FILE])).length, 3);
      await git.stage(f.repo, [FILE]);

      await conflicts.resolveFile(f.repo, 'gone.txt', 'incoming');
      assert.equal(fs.existsSync(path.join(f.repo, 'gone.txt')), false);
      assert.deepEqual(await conflicts.unmerged(f.repo), []);

      assert.deepEqual(await conflicts.continue(f.repo), { success: true, conflicts: false });
      assert.equal(await conflicts.state(f.repo), undefined);
      assert.equal(f.git('log', '-1', '--format=%P').trim().split(' ').length, 2);
      assert.match(f.git('log', '-1', '--format=%s'), /^Merge branch 'feature'/);
    },
  );

  test(
    `${transport}: rebase reports progress, stops again on the next conflict, skips and aborts`,
    { skip: transport === 'ssh' && process.platform === 'win32' },
    async (t) => {
      const { f, conflicts } = await setup(t);
      diverged(f);
      f.write('second.txt', 'main second\n');
      f.git('add', '.');
      f.git('commit', '-qm', 'main second');
      const original = f.git('rev-parse', 'feature').trim();
      f.git('checkout', '-q', 'feature');
      failing(f, 'rebase', 'master');

      let state = await conflicts.state(f.repo);
      assert.equal(state.kind, 'rebase');
      assert.equal(state.branch, 'feature');
      assert.equal(state.onto, f.git('rev-parse', 'master').trim());
      assert.equal(state.step, 1);
      assert.equal(state.total, 2);
      assert.equal(state.subject, 'feature edit');

      // Whole-file choice: the current side (master) for both conflicted paths.
      await conflicts.resolveFile(f.repo, FILE, 'current');
      await conflicts.resolveFile(f.repo, 'gone.txt', 'current');
      assert.equal(fs.readFileSync(path.join(f.repo, 'gone.txt'), 'utf8'), 'edited on main\n');
      const next = await conflicts.continue(f.repo);
      assert.equal(next.conflicts, true);
      state = await conflicts.state(f.repo);
      assert.equal(state.step, 2);
      assert.equal(state.subject, 'feature second');

      assert.deepEqual(await conflicts.skip(f.repo), { success: true, conflicts: false });
      assert.equal(await conflicts.state(f.repo), undefined);
      assert.equal(f.git('rev-parse', 'HEAD').trim(), f.git('rev-parse', 'master').trim());

      f.git('reset', '-q', '--hard', original);
      failing(f, 'rebase', 'master');
      await conflicts.abort(f.repo);
      assert.equal(await conflicts.state(f.repo), undefined);
      assert.equal(f.git('rev-parse', 'HEAD').trim(), original);
      assert.equal(f.git('status', '--porcelain'), '');
    },
  );

  test(
    `${transport}: cherry-pick and revert conflicts continue or abort like the CLI`,
    { skip: transport === 'ssh' && process.platform === 'win32' },
    async (t) => {
      const { f, conflicts, git } = await setup(t);
      diverged(f);
      const head = f.git('rev-parse', 'HEAD').trim();
      failing(f, 'cherry-pick', 'feature~1');
      let state = await conflicts.state(f.repo);
      assert.equal(state.kind, 'cherry-pick');
      assert.equal(state.subject, 'feature edit');
      await assert.rejects(conflicts.skip(f.repo), /只有变基/);
      await conflicts.abort(f.repo);
      assert.equal(f.git('rev-parse', 'HEAD').trim(), head);
      assert.equal(f.git('status', '--porcelain'), '');

      failing(f, 'cherry-pick', 'feature~1');
      await conflicts.resolveFile(f.repo, FILE, 'incoming');
      // Deleting the file by hand and marking it resolved stages the deletion.
      fs.rmSync(path.join(f.repo, 'gone.txt'));
      await git.stage(f.repo, ['gone.txt']);
      assert.equal((await conflicts.continue(f.repo)).conflicts, false);
      assert.equal(f.git('log', '-1', '--format=%s').trim(), 'feature edit');
      assert.equal(f.git('ls-files', 'gone.txt'), '');

      f.write(FILE, 'top\nlater\nbottom\n');
      f.git('commit', '-qam', 'later');
      failing(f, 'revert', '--no-edit', 'HEAD~1');
      state = await conflicts.state(f.repo);
      assert.equal(state.kind, 'revert');
      assert.equal(state.subject, 'feature edit');
      await conflicts.abort(f.repo);
      assert.equal(await conflicts.state(f.repo), undefined);
      assert.equal(f.git('log', '-1', '--format=%s').trim(), 'later');
    },
  );

  test(
    `${transport}: linked worktrees and stash conflicts`,
    { skip: transport === 'ssh' && process.platform === 'win32' },
    async (t) => {
      const { f, conflicts, git } = await setup(t);
      diverged(f);
      const linked = path.join(f.root, 'linked 工作树');
      f.git('worktree', 'add', '-q', linked, 'feature');
      assert.throws(() => f.git('-C', linked, 'merge', '--no-edit', 'master'));
      assert.equal((await conflicts.state(linked)).kind, 'merge');
      assert.equal(await conflicts.state(f.repo), undefined);
      await conflicts.abort(linked);
      assert.equal(await conflicts.state(linked), undefined);

      f.write(FILE, 'top\nstashed\nbottom\n');
      f.git('stash', 'push', '-q');
      f.write(FILE, 'top\ncommitted\nbottom\n');
      f.git('commit', '-qam', 'committed');
      failing(f, 'stash', 'apply');
      // A stash apply leaves conflicts but nothing to continue or abort.
      assert.equal(await conflicts.state(f.repo), undefined);
      const status = await git.status(f.repo);
      assert.equal(status.files.find((file) => file.path === FILE).conflict, 'both-modified');
      await assert.rejects(conflicts.abort(f.repo), (error) => error.statusCode === 409);
    },
  );
}

test('local: per-block resolution keeps CRLF, BOM and refuses symlinked parents', async (t) => {
  const f = createRepository();
  t.after(f.close);
  const conflicts = new ConflictResolution(new LocalConnection());
  const raw = '<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> feature\r\n';
  f.write(
    'crlf.txt',
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`a\r\n${raw}z\r\n`)]),
  );
  await conflicts.resolveBlock(f.repo, 'crlf.txt', 0, 'incoming', raw);
  assert.deepEqual(
    fs.readFileSync(path.join(f.repo, 'crlf.txt')),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\r\ntheirs\r\nz\r\n')]),
  );
  fs.mkdirSync(path.join(f.root, 'outside'));
  fs.writeFileSync(path.join(f.root, 'outside', 'x.txt'), raw);
  fs.symlinkSync(path.join(f.root, 'outside'), path.join(f.repo, 'link'));
  await assert.rejects(conflicts.resolveBlock(f.repo, 'link/x.txt', 0, 'current', raw));
  assert.equal(fs.readFileSync(path.join(f.root, 'outside', 'x.txt'), 'utf8'), raw);
  await assert.rejects(conflicts.resolveBlock(f.repo, '../x.txt', 0, 'current', raw));
});
