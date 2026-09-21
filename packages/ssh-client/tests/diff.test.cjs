const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SSHConnection } = require('../dist/connection-manager');
const { GitCommands, DIFF_PREVIEW_MAX_BYTES } = require('../dist/git-commands');
const { startSSHServer } = require('./helpers/ssh-server.cjs');
let remote, connection, git, root;
const run = (repo, ...args) =>
  execFileSync('git', ['-C', repo, ...args], {
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
const write = (repo, file, content) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), content);
};
const repo = (initialCommit = true) => {
  const dir = fs.mkdtempSync(path.join(root, "repo '$() 空格-"));
  run(dir, 'init', '-q', '-b', 'main');
  run(dir, 'config', 'user.email', 'fixture@example.invalid');
  run(dir, 'config', 'user.name', 'Fixture');
  if (initialCommit) {
    write(dir, 'base.txt', 'original\n');
    run(dir, 'add', 'base.txt');
    run(dir, 'commit', '-qm', 'initial');
  }
  return dir;
};
const indexBytes = (dir) =>
  fs.existsSync(path.join(dir, '.git/index'))
    ? fs.readFileSync(path.join(dir, '.git/index'))
    : null;
const readOnlyDiff = async (dir, options) => {
  const before = indexBytes(dir);
  const target = options.file && path.join(dir, options.file);
  const content =
    target && fs.existsSync(target) && fs.lstatSync(target).isFile()
      ? fs.readFileSync(target)
      : null;
  const status = run(dir, '--no-optional-locks', 'status', '--porcelain=v2', '-z');
  const patch = await git.diff(dir, options);
  if (content)
    assert.deepEqual(fs.readFileSync(target), content, 'preview must preserve file bytes');
  assert.deepEqual(indexBytes(dir), before, 'preview must leave the index byte-for-byte intact');
  assert.deepEqual(run(dir, '--no-optional-locks', 'status', '--porcelain=v2', '-z'), status);
  return patch;
};

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-diff-'));
  remote = await startSSHServer();
  connection = new SSHConnection(remote.options);
  await connection.connect();
  git = new GitCommands(connection);
});
after(async () => {
  connection?.disconnect();
  await remote?.close();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

for (const initialCommit of [true, false]) {
  test(`untracked → staged → edited → unstaged preserves both comparisons (HEAD=${initialCommit})`, async () => {
    const dir = repo(initialCommit);
    const file = "子目录/中文 空格 '$HOME `echo injected` $(echo injected) [*].txt";
    write(dir, file, 'first\n++ header-like text\n最后一行');
    const untracked = await git.status(dir);
    assert.equal(untracked.branch, 'main');
    assert.deepEqual(untracked.files, [{ path: file, status: 'untracked', staged: false }]);
    assert.match(
      await readOnlyDiff(dir, { file }),
      /--- \/dev\/null[\s\S]*\+first\n\+\+\+ header-like text\n\+最后一行/,
    );
    await git.stage(dir, [file]);
    write(dir, file, 'second\n');
    assert.deepEqual((await git.status(dir)).files, [
      { path: file, status: 'added', staged: true },
      { path: file, status: 'modified', staged: false },
    ]);
    const staged = await readOnlyDiff(dir, { file, staged: true });
    assert.match(staged, /\+first/);
    assert.doesNotMatch(staged, /\+second/);
    const unstaged = await readOnlyDiff(dir, { file, staged: false });
    assert.match(unstaged, /-first/);
    assert.match(unstaged, /\+second/);
    await git.unstage(dir, [file]);
    assert.deepEqual((await git.status(dir)).files, [
      { path: file, status: 'untracked', staged: false },
    ]);
    assert.match(await readOnlyDiff(dir, { file }), /\+second/);
    assert.equal(fs.readFileSync(path.join(dir, file), 'utf8'), 'second\n');
  });
}

test('empty, binary, oversized, invalid UTF-8, vanished and unreadable files have distinct results', async () => {
  const dir = repo();
  write(dir, 'empty', '');
  write(dir, 'binary', Buffer.from([0, 1, 2, 3]));
  write(dir, 'large', 'x'.repeat(DIFF_PREVIEW_MAX_BYTES + 1));
  write(dir, 'latin1', Buffer.from([0xe9, 0x0a]));
  write(dir, 'unreadable', 'secret');
  fs.chmodSync(path.join(dir, 'unreadable'), 0);
  assert.match(await readOnlyDiff(dir, { file: 'empty' }), /new file mode/);
  assert.match(await readOnlyDiff(dir, { file: 'binary' }), /Binary files/);
  await assert.rejects(git.diff(dir, { file: 'large' }), /1 MiB/);
  await assert.rejects(git.diff(dir, { file: 'latin1' }), /UTF-8/);
  await assert.rejects(git.diff(dir, { file: 'gone' }), /文件已不存在/);
  if (process.getuid?.() !== 0)
    await assert.rejects(git.diff(dir, { file: 'unreadable' }), /读取权限/);
  fs.chmodSync(path.join(dir, 'unreadable'), 0o600);
  await git.stage(dir, ['empty', 'binary', 'large']);
  // Worktree replacements must not affect the staged preview or its size check.
  write(dir, 'empty', 'x'.repeat(DIFF_PREVIEW_MAX_BYTES + 1));
  write(dir, 'binary', 'plain text now');
  write(dir, 'large', 'small now');
  assert.match(await readOnlyDiff(dir, { file: 'empty', staged: true }), /new file mode/);
  assert.match(await readOnlyDiff(dir, { file: 'binary', staged: true }), /Binary files/);
  await assert.rejects(git.diff(dir, { file: 'large', staged: true }), /1 MiB/);
});

test('patch output is bounded even when a file itself is within the size limit', async () => {
  const dir = repo();
  write(dir, 'many-lines', '\n'.repeat(DIFF_PREVIEW_MAX_BYTES / 2 + 1));
  await assert.rejects(git.diff(dir, { file: 'many-lines' }), /1 MiB/);
  write(dir, 'many-lines', '\n'.repeat(10_000));
  await assert.rejects(git.diff(dir, { file: 'many-lines' }), /10,000 行/);
  assert.equal(connection.connected, true);
  assert.equal((await git.status(dir)).files[0].path, 'many-lines');
});

test('a file disappearing after preflight is an error even when no-index exits with code 1', async () => {
  const dir = repo();
  write(dir, 'vanishing', 'content\n');
  const execute = connection.execCommand;
  connection.execCommand = async function (command, ...args) {
    if (command.includes('--no-index')) fs.unlinkSync(path.join(dir, 'vanishing'));
    return execute.call(this, command, ...args);
  };
  try {
    await assert.rejects(git.diff(dir, { file: 'vanishing' }), /无法读取差异/);
  } finally {
    connection.execCommand = execute;
  }
});

test('SFTP preflight distinguishes a vanished file from a directory and preserves dangling links', async () => {
  const dir = repo();
  const execute = connection.execCommand;
  for (const replacement of ['missing', 'directory']) {
    write(dir, 'changing', 'content\n');
    connection.execCommand = async function (command, ...args) {
      const result = await execute.call(this, command, ...args);
      if (command.includes('--others')) {
        fs.unlinkSync(path.join(dir, 'changing'));
        if (replacement === 'directory') fs.mkdirSync(path.join(dir, 'changing'));
      }
      return result;
    };
    try {
      await assert.rejects(
        git.diff(dir, { file: 'changing' }),
        replacement === 'missing' ? /文件已不存在/ : /普通文件或符号链接/,
      );
    } finally {
      connection.execCommand = execute;
    }
  }
  fs.symlinkSync('missing-target', path.join(dir, 'dangling'));
  assert.match(await readOnlyDiff(dir, { file: 'dangling' }), /\+missing-target/);
});

test('literal paths cannot match neighbours, escape the repository, or invoke shell expansion', async () => {
  const dir = repo();
  for (const file of [
    '-option',
    'literal[*]',
    'literalX',
    ':magic',
    'line\nbreak\tname',
    'back\\slash',
  ])
    write(dir, file, `unique ${JSON.stringify(file)}\n`);
  for (const file of (await git.status(dir)).files.map((item) => item.path)) {
    assert.match(await readOnlyDiff(dir, { file }), /\+unique/);
    await git.stage(dir, [file]);
    await git.unstage(dir, [file]);
  }
  assert.doesNotMatch(await readOnlyDiff(dir, { file: 'literal[*]' }), /literalX/);
  for (const file of [
    '../outside',
    '/etc/passwd',
    '.git/config',
    'a/../../outside',
    'base.txt\0suffix',
  ])
    await assert.rejects(git.diff(dir, { file }), /相对文件路径/);
  write(dir, 'nested/child', 'one');
  await assert.rejects(git.diff(dir, { file: 'nested' }), /文件已不存在/);
  fs.symlinkSync('/etc/passwd', path.join(dir, 'link'));
  const link = await readOnlyDiff(dir, { file: 'link' });
  assert.match(link, /\+\/etc\/passwd/);
  assert.doesNotMatch(link, /root:/);
});

test('modified, deleted, renamed and initial/history diffs retain Git semantics', async () => {
  const dir = repo();
  const initial = run(dir, 'rev-parse', 'HEAD').toString().trim();
  assert.match(await readOnlyDiff(dir, { commit: initial, file: 'base.txt' }), /\+original/);
  write(dir, 'base.txt', 'updated\n');
  assert.match(await readOnlyDiff(dir, { file: 'base.txt' }), /-original\n\+updated/);
  await git.stage(dir, ['base.txt']);
  fs.unlinkSync(path.join(dir, 'base.txt'));
  assert.deepEqual(
    (await git.status(dir)).files.map(({ status, staged }) => ({ status, staged })),
    [
      { status: 'modified', staged: true },
      { status: 'deleted', staged: false },
    ],
  );
  assert.match(await readOnlyDiff(dir, { file: 'base.txt', staged: true }), /\+updated/);
  assert.match(await readOnlyDiff(dir, { file: 'base.txt' }), /deleted file mode/);
  run(dir, 'reset', '--hard', '-q', 'HEAD');
  run(dir, 'mv', 'base.txt', '中文 renamed.txt');
  write(dir, '中文 renamed.txt', 'edited after rename\n');
  const files = (await git.status(dir)).files;
  assert.deepEqual(files, [
    { path: '中文 renamed.txt', oldPath: 'base.txt', status: 'renamed', staged: true },
    { path: '中文 renamed.txt', status: 'modified', staged: false },
  ]);
  run(dir, 'commit', '-qm', 'rename');
  const commit = run(dir, 'rev-parse', 'HEAD').toString().trim();
  assert.match(await readOnlyDiff(dir, { commit, parentCommit: initial }), /rename from base.txt/);
  // Repository diff config must not execute external preview helpers.
  run(dir, 'config', 'diff.external', 'false');
  assert.match(await readOnlyDiff(dir, { file: '中文 renamed.txt' }), /\+edited after rename/);
});
