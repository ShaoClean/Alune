const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { collectRepositoryAnalytics, primaryLanguage, LocalConnection } = require('../dist');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');

function commit(fixture, date) {
  execFileSync('git', ['-C', fixture.repo, 'commit', '--allow-empty', '-qm', date], {
    env: { ...process.env, GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: date },
  });
}
for (const transport of ['local', 'ssh']) {
  test(
    `${transport}: real Git timestamps, UTC boundaries, empty HEAD, languages and detached HEAD`,
    { skip: transport === 'ssh' && process.platform === 'win32' },
    async (t) => {
      const fixture = createRepository({ initial: false });
      const ssh = transport === 'ssh' ? await connectFixture(fixture) : null;
      const connection = ssh?.connection || new LocalConnection();
      t.after(async () => {
        await ssh?.close();
        fixture.close();
      });
      const empty = await collectRepositoryAnalytics(connection, fixture.repo, '2026-10-01');
      assert.equal(empty.unborn, true);
      assert.equal(
        empty.daily.reduce((a, b) => a + b, 0),
        0,
      );
      assert.equal(empty.language, null);
      fixture.write('src/app.ts', 'export const a = 1');
      fixture.write('src/app.test.ts', 'export {}');
      fixture.write('src/styles.css', 'body {}');
      fixture.write('vendor/lib.py', 'pass');
      fixture.write('dist/bundle.js', '');
      fixture.write('types/a.d.ts', '');
      fixture.git('add', '.');
      commit(fixture, '2026-09-23T23:59:59Z');
      commit(fixture, '2026-09-24T00:00:00Z');
      commit(fixture, '2026-09-30T23:59:59Z');
      commit(fixture, '2026-10-01T00:00:00Z');
      // A newer commit with an older timestamp must not hide its parents from traversal.
      commit(fixture, '2020-01-01T00:00:00Z');
      const result = await collectRepositoryAnalytics(connection, fixture.repo, '2026-10-01');
      assert.equal(result.daily.length, 180);
      assert.equal(
        result.daily.slice(-7).reduce((a, b) => a + b, 0),
        2,
      );
      assert.equal(
        result.daily.slice(-14, -7).reduce((a, b) => a + b, 0),
        1,
      );
      assert.equal(result.language, 'TypeScript');
      assert.equal(result.shallow, false);
      assert.equal(result.truncated, false);
      fixture.git('checkout', '--detach', '-q');
      const detached = await collectRepositoryAnalytics(connection, fixture.repo, '2026-10-01');
      assert.deepEqual(detached.daily, result.daily);
      fixture.git('worktree', 'add', '--detach', path.join(fixture.root, 'worktree'));
      const worktree = await collectRepositoryAnalytics(
        connection,
        path.join(fixture.root, 'worktree'),
        '2026-10-01',
      );
      assert.deepEqual(worktree.daily, result.daily);
      execFileSync('git', [
        'clone',
        '-q',
        '--no-local',
        '--depth=1',
        fixture.repo,
        path.join(fixture.root, 'shallow'),
      ]);
      const shallow = await collectRepositoryAnalytics(
        connection,
        path.join(fixture.root, 'shallow'),
        '2026-10-01',
      );
      assert.equal(shallow.shallow, true);
    },
  );
}
test('language excludes generated/vendor paths, deduplicates index conflict stages and resolves ties', () => {
  assert.equal(
    primaryLanguage(['x.ts', 'x.ts', 'y.py', 'z.py', 'vendor/a.ts', 'build/a.ts', 'a.d.ts']),
    'Python',
  );
  assert.equal(primaryLanguage(['x.ts', 'x.py']), 'Python');
  assert.equal(primaryLanguage(['README.md', 'lock.json']), null);
});
test('missing repository, invalid day and aborted reads are errors, not empty histories', async (t) => {
  const fixture = createRepository();
  t.after(fixture.close);
  await assert.rejects(
    collectRepositoryAnalytics(new LocalConnection(), fixture.root, '2026-10-01'),
  );
  await assert.rejects(
    collectRepositoryAnalytics(new LocalConnection(), fixture.repo, '2026-02-30'),
  );
  await assert.rejects(
    collectRepositoryAnalytics(
      new LocalConnection(),
      fixture.repo,
      '2026-10-01',
      AbortSignal.abort(),
    ),
  );
});
test('language failure retains activity and bounded logs explicitly mark truncation', async () => {
  const connection = {
    execGit: async (_path, args) => {
      if (args[0] === 'ls-files') throw new Error('output limit');
      return {
        exitCode: 0,
        stderr: '',
        stdout: args.includes('--is-shallow-repository')
          ? 'false\n'
          : args[0] === 'log'
            ? '1790760000\n'.repeat(100001)
            : 'abc\n',
      };
    },
  };
  const result = await collectRepositoryAnalytics(connection, '/repo', '2026-10-01');
  assert.equal(result.truncated, true);
  assert.match(result.languageError, /output limit/);
  assert.equal(
    result.daily.reduce((a, b) => a + b, 0),
    100000,
  );
});
