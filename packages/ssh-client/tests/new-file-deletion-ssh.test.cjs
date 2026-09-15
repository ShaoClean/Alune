const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');
const { NewFileDeletion } = require('../dist/new-file-deletion');
const { GitCommands } = require('../dist/git-commands');

test(
  'real SSH/SFTP previews and deletes new files, preserves parents, and reports permission failures',
  { timeout: 60000 },
  async (t) => {
    const fixture = createRepository({ initial: false });
    t.after(fixture.close);
    const ssh = await connectFixture(fixture);
    t.after(ssh.close);
    const deletion = new NewFileDeletion(ssh.connection);
    const git = new GitCommands(ssh.connection);
    for (const stage of ['untracked', 'staged', 'mixed']) {
      const name = `目录/中文 $ '\" [*] ${stage}.txt`;
      fixture.write(name, 'index contents\n');
      if (stage !== 'untracked') fixture.git('add', '--', name);
      if (stage === 'mixed') fixture.write(name, 'working contents\n');
      const preview = await deletion.preview(fixture.repo, name);
      assert.equal(preview.staged, stage !== 'untracked');
      const indexPath = path.join(fixture.repo, '.git/index');
      const indexBefore = fs.existsSync(indexPath) ? fs.readFileSync(indexPath) : null;
      const rows = (await git.status(fixture.repo)).files.filter((file) => file.path === name);
      assert.equal(rows.length, stage === 'mixed' ? 2 : 1);
      for (const row of rows) {
        const diff = await git.diff(fixture.repo, { file: name, staged: row.staged });
        if (stage === 'mixed' && !row.staged) {
          assert.match(diff, /-index contents\n\+working contents/);
        } else {
          assert.match(diff, /\+index contents/);
          assert.doesNotMatch(diff, /\+working contents/);
        }
      }
      assert.deepEqual(fs.existsSync(indexPath) ? fs.readFileSync(indexPath) : null, indexBefore);
      // Reading either comparison must keep the existing deletion confirmation valid.
      await deletion.delete(fixture.repo, name, preview.token);
      assert.equal(fs.existsSync(path.join(fixture.repo, name)), false);
      assert.ok(fs.existsSync(path.join(fixture.repo, '目录')));
      assert.equal(fixture.git('ls-files', '-z', '--', name), '');
      assert.equal(
        (await git.status(fixture.repo)).files.some((file) => file.path === name),
        false,
      );
    }
    fixture.write('readonly/new.txt');
    fixture.git('add', '--', 'readonly/new.txt');
    const preview = await deletion.preview(fixture.repo, 'readonly/new.txt');
    const parent = path.join(fixture.repo, 'readonly');
    fs.chmodSync(parent, 0o555);
    try {
      await assert.rejects(
        deletion.delete(fixture.repo, 'readonly/new.txt', preview.token),
        /磁盘文件：仍存在；暂存记录：已清理/,
      );
      assert.ok(fs.existsSync(path.join(parent, 'new.txt')));
    } finally {
      fs.chmodSync(parent, 0o755);
    }
    const retry = await deletion.preview(fixture.repo, 'readonly/new.txt');
    await deletion.delete(fixture.repo, 'readonly/new.txt', retry.token);
    assert.equal(fixture.git('ls-files', '-z'), '');
  },
);
