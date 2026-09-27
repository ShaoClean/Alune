const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GitCommands } = require('../dist');
const { createRepository } = require('./helpers/local-repository.cjs');

test('remote discovery reads real Git config from a quoted path and keeps fetch/push destinations separate', async () => {
  const fixture = createRepository();
  try {
    fixture.git('remote', 'add', 'origin', 'git@github.com:team/repo.git');
    fixture.git(
      'remote',
      'set-url',
      '--push',
      'origin',
      'ssh://git@gitlab.com:2222/group/sub/repo.git',
    );
    fixture.git('remote', 'add', 'upstream', 'https://git.example.com/team/repo.git');
    const before = fixture.git('status', '--porcelain');
    assert.deepEqual(await new GitCommands(fixture.connection).remoteList(fixture.repo), [
      {
        name: 'origin',
        fetchUrl: 'git@github.com:team/repo.git',
        pushUrl: 'ssh://git@gitlab.com:2222/group/sub/repo.git',
      },
      {
        name: 'upstream',
        fetchUrl: 'https://git.example.com/team/repo.git',
        pushUrl: 'https://git.example.com/team/repo.git',
      },
    ]);
    assert.equal(fixture.git('status', '--porcelain'), before);
  } finally {
    fixture.close();
  }
});

test('remote discovery forwards command cancellation, output limits and Windows literal paths', async () => {
  const controller = new AbortController();
  let seen;
  const git = new GitCommands({
    execCommand: async (...args) => {
      seen = args;
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  });
  assert.deepEqual(await git.remoteList('C:\\work %TEMP%\\repo', controller.signal), []);
  assert.match(seen[0], /^powershell -NoProfile -NonInteractive -EncodedCommand /);
  assert.equal(seen[1], undefined);
  assert.equal(seen[2], controller.signal);
  assert.deepEqual(seen[3], { maxOutputBytes: 1024 * 1024 });
});

test('local remote discovery uses native Git with cancellation and bounded output', async () => {
  const controller = new AbortController();
  let seen;
  const git = new GitCommands({
    execGit: async (...args) => {
      seen = args;
      return {
        stdout: 'origin\thttps://github.com/team/repo.git (fetch)\n',
        stderr: '',
        exitCode: 0,
      };
    },
    execCommand: async () => assert.fail('Local Git must use native arguments'),
  });
  assert.deepEqual(await git.remoteList('C:\\work %TEMP%\\repo', controller.signal), [
    {
      name: 'origin',
      fetchUrl: 'https://github.com/team/repo.git',
      pushUrl: '',
    },
  ]);
  assert.deepEqual(seen, [
    'C:\\work %TEMP%\\repo',
    ['remote', '-v'],
    controller.signal,
    { maxOutputBytes: 1024 * 1024 },
  ]);
  const reason = new Error('cancelled remote discovery');
  controller.abort(reason);
  await assert.rejects(git.remoteList('C:\\work %TEMP%\\repo', controller.signal), reason);
});
