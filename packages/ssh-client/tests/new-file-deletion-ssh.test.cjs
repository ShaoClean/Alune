const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');
const { NewFileDeletion } = require('../dist/new-file-deletion');

test(
  'real SSH/SFTP removes only selected files, preserves parents, and reports permission failures',
  { timeout: 60000 },
  async (t) => {
    const fixture = createRepository({ initial: false });
    t.after(fixture.close);
    const ssh = await connectFixture(fixture);
    t.after(ssh.close);
    const deletion = new NewFileDeletion(ssh.connection);
    for (const stage of ['untracked', 'staged', 'mixed']) {
      const name = `目录/中文 $ '\" [*] ${stage}.txt`;
      fixture.write(name, 'index contents\n');
      if (stage !== 'untracked') fixture.git('add', '--', name);
      if (stage === 'mixed') fixture.write(name, 'working contents\n');
      const preview = await deletion.preview(fixture.repo, name);
      assert.equal(preview.staged, stage !== 'untracked');
      await deletion.delete(fixture.repo, name, preview.token);
      assert.equal(fs.existsSync(path.join(fixture.repo, name)), false);
      assert.ok(fs.existsSync(path.join(fixture.repo, '目录')));
      assert.equal(fixture.git('ls-files', '-z', '--', name), '');
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
