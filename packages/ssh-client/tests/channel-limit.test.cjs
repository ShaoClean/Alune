const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');
const { GitCommands, runGit } = require('../dist');

for (const maxSessions of [10, 1]) {
  test(
    `staging and concurrent refreshes succeed with MaxSessions=${maxSessions}`,
    { timeout: 30000 },
    async (t) => {
      const fixture = createRepository();
      t.after(fixture.close);
      const ssh = await connectFixture(fixture, { maxSessions });
      t.after(ssh.close);
      const git = new GitCommands(ssh.connection);
      fixture.write('tracked.txt', 'staged contents\n');
      await git.stage(fixture.repo, ['tracked.txt']);

      // Repository context, status, Diff, and other visible repositories share a connection.
      const requests = [
        runGit(ssh.connection, fixture.repo, ['config', '--get', 'user.name']),
        runGit(ssh.connection, fixture.repo, ['config', '--get', 'user.email']),
        runGit(ssh.connection, fixture.repo, ['rev-parse', '--is-shallow-repository']),
        git.status(fixture.repo),
        git.remoteList(fixture.repo),
        git.diff(fixture.repo, { file: 'tracked.txt', staged: true }),
        ...Array.from({ length: 12 }, () => git.status(fixture.repo)),
      ];
      const results = await Promise.allSettled(requests);
      assert.deepEqual(
        results
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason.message),
        [],
      );
      assert.equal(results[0].value.stdout.trim(), 'Deletion test');
      assert.equal(results[1].value.stdout.trim(), 'fixture@example.invalid');
      assert.equal(results[2].value.stdout.trim(), 'false');
      assert.ok(results[3].value.files.some((file) => file.path === 'tracked.txt' && file.staged));
      assert.match(results[5].value, /\+staged contents/);
      assert.ok(ssh.sessions.peak <= Math.min(4, maxSessions));
      if (maxSessions === 10) assert.equal(ssh.sessions.rejected, 0);
    },
  );
}

test(
  'file reads and failed SFTP operations release sessions before later refreshes',
  { timeout: 30000 },
  async (t) => {
    const fixture = createRepository();
    t.after(fixture.close);
    const ssh = await connectFixture(fixture, { maxSessions: 4 });
    t.after(ssh.close);
    const filename = path.join(fixture.repo, 'tracked.txt');
    for (let i = 0; i < 8; i++) {
      assert.equal(await ssh.connection.readFile(filename), 'original\n');
      assert.ok((await ssh.connection.readDir(fixture.repo)).length > 0);
      assert.equal((await ssh.connection.stat(filename)).size, 9);
      await ssh.connection.writeFile(filename, 'original\n');
      await assert.rejects(ssh.connection.readDir(path.join(fixture.repo, 'missing')));
      await assert.rejects(
        ssh.connection.withSftp(() => {
          throw new Error('operation failed');
        }),
        /operation failed/,
      );
    }
    const results = await Promise.all(
      Array.from({ length: 8 }, () => new GitCommands(ssh.connection).status(fixture.repo)),
    );
    assert.ok(results.every((status) => status.files.length === 0));
    await delay(50);
    assert.equal(ssh.sessions.active, 0);
  },
);
