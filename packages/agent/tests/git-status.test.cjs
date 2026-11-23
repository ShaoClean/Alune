const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GitCommands } = require('../dist/modules/git/git-commands-writes');
const { NativeRepositoryConnection } = require('../dist/adapters/git/native');
const { createRepository } = require('./helpers/local-repository.cjs');

test('native status preserves Unicode paths and supports foreground index refresh', async (t) => {
  const fixture = createRepository();
  const connection = new NativeRepositoryConnection();
  t.after(async () => { await connection.close(); fixture.close(); });
  fixture.write('目录/中文.txt', 'content\n');
  const git = new GitCommands(connection);
  for (const foreground of [false, true]) {
    const result = await git.status(fixture.repo, undefined, foreground);
    assert.ok(result.files.some(file => file.path === '目录/中文.txt'));
  }
});

test('only foreground status permits Git to refresh index metadata', async () => {
  const calls = [];
  const git = new GitCommands({
    execGit: async (_directory, args, _signal, options) => {
      calls.push({ args, options });
      return { stdout: '# branch.head main\0', stderr: '', exitCode: 0 };
    },
  });
  await git.status('/repo');
  await git.status('/repo', undefined, true);
  assert.ok(calls[0].args.includes('--no-optional-locks'));
  assert.ok(!calls[1].args.includes('--no-optional-locks'));
});
