const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');
const { GitBlame, LocalConnection } = require('../dist');
const { parentLine } = require('../dist/git-blame');

for (const source of process.platform === 'win32' ? ['local'] : ['local', 'ssh']) {
  test(`${source}: blame matches Git, follows renames, maps parent lines, and supports worktrees`, async () => {
    const fixture = createRepository();
    const ssh = source === 'ssh' ? await connectFixture(fixture) : null;
    const blame = new GitBlame(ssh?.connection ?? new LocalConnection());
    const { repo, write } = fixture;
    const git = (...args) => fixture.git(...args).trim();
    const file = '中文 " file.txt';
    try {
      write(file, 'alpha\nbeta\ngamma\ndelta\n');
      git('add', '--', file);
      git('commit', '-qm', 'first author\n\nFull commit body.');
      const first = git('rev-parse', 'HEAD');
      const renamed = '重命名 file.txt';
      git('mv', file, renamed);
      write(renamed, 'alpha\nBETA\ngamma\ndelta\n');
      git(
        '-c',
        'user.name=Second author',
        '-c',
        'user.email=second@example.invalid',
        'commit',
        '-qam',
        'rename and edit',
      );
      const second = git('rev-parse', 'HEAD');
      write(renamed, 'alpha\nBETA\ngamma\ndelta\nworking\n');
      const data = await blame.read(repo, { path: renamed });
      assert.equal(data.kind, 'ready');
      assert.deepEqual(
        data.lines.map((line) => line.hash),
        [first, second, first, first, '0'.repeat(40)],
      );
      const cli = git('blame', '--line-porcelain', '--', renamed)
        .split('\n')
        .filter((row) => /^[a-f0-9]{40} \d+ \d+/.test(row))
        .map((row) => row.split(' ')[0]);
      assert.deepEqual(
        data.lines.map((line) => line.hash),
        cli,
      );
      assert.equal(data.commits[second].author, 'Second author');
      assert.equal(data.lines[1].previous.path, file);
      const previous = await blame.read(repo, { path: renamed, previousLine: 2 });
      assert.equal(previous.revision, first);
      assert.equal(previous.path, file);
      assert.equal(previous.content, 'alpha\nbeta\ngamma\ndelta\n');
      assert.equal(previous.focusLine, 2);
      assert.match(previous.notice, /新增或改写/);
      const workingParent = await blame.read(repo, { path: renamed, previousLine: 5 });
      assert.equal(workingParent.revision, second);
      assert.equal(workingParent.focusLine, 4);
      assert.equal((await blame.commit(repo, first)).body, 'first author\n\nFull commit body.');
      const worktree = path.join(fixture.root, 'linked worktree');
      git('worktree', 'add', '--detach', worktree, second);
      const linked = await blame.read(worktree, { path: renamed });
      assert.deepEqual(
        linked.lines.map((line) => line.hash),
        [first, second, first, first],
      );
    } finally {
      await ssh?.close();
      fixture.close();
    }
  });

  test(`${source}: whitespace and ignore-revs file take effect, including ignored line markers`, async () => {
    const fixture = createRepository();
    const ssh = source === 'ssh' ? await connectFixture(fixture) : null;
    const blame = new GitBlame(ssh?.connection ?? new LocalConnection());
    const { repo, write } = fixture;
    const git = (...args) => fixture.git(...args).trim();
    try {
      write('code.txt', 'one\ntwo\nthree\n');
      git('add', '.');
      git('commit', '-qm', 'original');
      const first = git('rev-parse', 'HEAD');
      write('code.txt', '  one\ntwo\nthree\n');
      git('commit', '-qam', 'format');
      const format = git('rev-parse', 'HEAD');
      assert.equal((await blame.read(repo, { path: 'code.txt' })).lines[0].hash, format);
      assert.equal(
        (await blame.read(repo, { path: 'code.txt', ignoreWhitespace: true })).lines[0].hash,
        first,
      );
      write('.git-blame-ignore-revs', `# formatter\n${format}\n`);
      const ignored = await blame.read(repo, { path: 'code.txt' });
      assert.equal(ignored.ignoreRevsApplied, true);
      assert.equal(ignored.lines[0].hash, first);
      assert.equal(
        (await blame.read(repo, { path: 'code.txt', useIgnoreRevs: false })).lines[0].hash,
        format,
      );
      write('.git-blame-ignore-revs', 'not-a-hash\n');
      await assert.rejects(blame.read(repo, { path: 'code.txt' }), /追溯信息/);
      assert.equal(
        (await blame.read(repo, { path: 'code.txt', useIgnoreRevs: false })).kind,
        'ready',
      );
    } finally {
      await ssh?.close();
      fixture.close();
    }
  });
}

test('new, staged, unborn, empty, binary, encoded and large files have explicit states', async () => {
  const fixture = createRepository({ initial: false });
  const { repo, write, git } = fixture;
  const blame = new GitBlame(new LocalConnection());
  try {
    write('new.txt', 'unborn\n');
    assert.equal((await blame.read(repo, { path: 'new.txt' })).lines[0].uncommitted, true);
    git('add', '.');
    git('commit', '-qm', 'first');
    write('fresh.txt', 'new\n');
    assert.match((await blame.read(repo, { path: 'fresh.txt' })).notice, /新文件/);
    git('add', '.');
    assert.equal((await blame.read(repo, { path: 'fresh.txt' })).lines[0].uncommitted, true);
    write('binary.dat', Buffer.from([0, 1, 2]));
    write('empty.txt', '');
    write('large.txt', 'x'.repeat(256 * 1024 + 1));
    write('many.txt', 'x\n'.repeat(5001));
    write('utf16.txt', Buffer.from([255, 254, 97, 0]));
    for (const file of ['binary.dat', 'empty.txt', 'large.txt', 'many.txt', 'utf16.txt'])
      assert.equal((await blame.read(repo, { path: file })).kind, 'unavailable', file);
    for (const file of ['../outside', '.git/config', '/etc/passwd'])
      await assert.rejects(blame.read(repo, { path: file }));
    await assert.rejects(blame.read(repo, { path: 'new.txt', revision: '--help' }));
    await assert.rejects(blame.read(repo, { path: 'new.txt', previousLine: 0 }));
    if (process.platform !== 'win32') {
      fs.symlinkSync('/etc/passwd', path.join(repo, 'link.txt'));
      assert.equal((await blame.read(repo, { path: 'link.txt' })).kind, 'unavailable');
    }
  } finally {
    fixture.close();
  }
});

test('parent line mapping handles insertions, deletions, replacements and unchanged offsets', () => {
  assert.deepEqual(parentLine('@@ -1,0 +2,2 @@\n', 4), { line: 2, exact: true });
  assert.deepEqual(parentLine('@@ -2,2 +1,0 @@\n', 2), { line: 4, exact: true });
  assert.deepEqual(parentLine('@@ -2,2 +2,3 @@\n', 3), { line: 3, exact: false });
  assert.deepEqual(parentLine('', 17), { line: 17, exact: true });
});

test('CRLF, no final newline and literal control characters keep Git line/path correspondence', async () => {
  const fixture = createRepository();
  const blame = new GitBlame(new LocalConnection());
  const name = process.platform === 'win32' ? 'line endings.txt' : '中文\t"\\ file.txt';
  try {
    for (const contents of ['one\r\ntwo\r\n', 'one\ntwo', 'one\n\n']) {
      fixture.write(name, contents);
      fixture.git('add', '.');
      fixture.git('commit', '-qm', 'line endings');
      const data = await blame.read(fixture.repo, { path: name });
      assert.equal(data.kind, 'ready');
      assert.equal(data.content, contents);
      assert.equal(data.lines.length, 2);
      assert.equal(data.lines[0].path, name);
    }
  } finally {
    fixture.close();
  }
});

test('cancellation reaches the running blame process', async () => {
  const fixture = createRepository();
  const local = new LocalConnection();
  let aborted = false;
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const transport = {
    withSftp: local.withSftp.bind(local),
    execCommand: local.execCommand.bind(local),
    execGit(repo, args, signal, options) {
      if (!args.includes('blame')) return local.execGit(repo, args, signal, options);
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(signal.reason);
        });
        started();
      });
    },
  };
  const controller = new AbortController();
  try {
    const pending = new GitBlame(transport).read(
      fixture.repo,
      { path: 'tracked.txt' },
      controller.signal,
    );
    const rejected = assert.rejects(pending, /cancelled/);
    await ready;
    controller.abort(new Error('cancelled'));
    await rejected;
    assert.equal(aborted, true);
  } finally {
    fixture.close();
  }
});

test('previous navigation rejects a changed displayed snapshot', async () => {
  const fixture = createRepository();
  const blame = new GitBlame(new LocalConnection());
  try {
    fixture.write('tracked.txt', 'working\n');
    const displayed = await blame.read(fixture.repo, { path: 'tracked.txt' });
    fixture.write('tracked.txt', 'inserted\nworking\n');
    await assert.rejects(
      blame.read(fixture.repo, {
        path: 'tracked.txt',
        previousLine: 1,
        expectedVersion: displayed.version,
      }),
      /追溯已变化/,
    );
  } finally {
    fixture.close();
  }
});
