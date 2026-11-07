const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { execFileSync } = require('node:child_process');
const { NativeRepositoryConnection } = require('../dist/adapters/git/native');
const { RepositoryReader } = require('../dist/modules/repositories/reads');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-git-directory-'));
  const repo = path.join(
    root,
    process.platform === 'win32' ? '中文 repo' : '中文 repo\nsecond line',
  );
  fs.mkdirSync(repo);
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trimEnd();
  git('init', '-qb', 'main');
  git('config', 'user.name', 'Directory fixture');
  git('config', 'user.email', 'directory@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'core.hooksPath', '.git/hooks');
  fs.writeFileSync(path.join(repo, 'file.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  const connection = new NativeRepositoryConnection(),
    calls = [],
    execute = connection.execGit.bind(connection);
  connection.execGit = (directory, args, ...rest) => {
    calls.push([...args]);
    return execute(directory, args, ...rest);
  };
  return {
    root,
    repo,
    git,
    connection,
    calls,
    reader: new RepositoryReader(connection),
    async close() {
      await connection.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
test('normal status resolves the real Git directory without rev-parse and preserves merge state and index bytes', async () => {
  const f = fixture();
  try {
    assert.equal(await f.connection.gitDirectory(f.repo), f.git('rev-parse', '--absolute-git-dir'));
    f.git('switch', '-qc', 'incoming');
    fs.writeFileSync(path.join(f.repo, 'file.txt'), 'incoming\n');
    f.git('commit', '-qam', 'incoming');
    const incoming = f.git('rev-parse', 'HEAD');
    f.git('switch', '-q', 'main');
    fs.writeFileSync(path.join(f.repo, 'file.txt'), 'current\n');
    f.git('commit', '-qam', 'current');
    assert.throws(() => f.git('merge', '--no-edit', 'incoming'));
    const index = fs.readFileSync(path.join(f.repo, '.git', 'index')),
      bytes = fs.readFileSync(path.join(f.repo, 'file.txt'));
    f.calls.length = 0;
    const status = await f.reader.status(f.repo);
    assert.equal(status.branch, 'main');
    assert.equal(status.operation.kind, 'merge');
    assert.equal(status.operation.commit, incoming);
    assert.ok(status.files.some((x) => x.path === 'file.txt' && x.conflicted));
    assert(!f.calls.some((args) => args.includes('--absolute-git-dir')));
    assert.deepEqual(fs.readFileSync(path.join(f.repo, '.git', 'index')), index);
    assert.deepEqual(fs.readFileSync(path.join(f.repo, 'file.txt')), bytes);
  } finally {
    await f.close();
  }
});
test('linked worktree gitfiles use actual Git resolution and retain linked ownership', async () => {
  const f = fixture();
  try {
    const linked = path.join(f.root, 'linked');
    f.git('worktree', 'add', '-qb', 'linked', linked);
    assert.equal(await f.connection.gitDirectory(linked), undefined);
    const status = await f.reader.status(linked);
    assert.equal(status.branch, 'linked');
    assert.equal(status.worktreeKind, 'linked');
    assert(f.calls.some((args) => args.includes('--absolute-git-dir')));
  } finally {
    await f.close();
  }
});
test('directory resolution is fresh per read, falls back for symlinks and rejects after close', async () => {
  const f = fixture();
  try {
    const original = path.join(f.repo, '.git'),
      moved = path.join(f.root, 'actual.git');
    assert.equal(await f.connection.gitDirectory(f.repo), f.git('rev-parse', '--absolute-git-dir'));
    fs.renameSync(original, moved);
    assert.equal(await f.connection.gitDirectory(f.repo), undefined);
    fs.symlinkSync(moved, original, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(await f.connection.gitDirectory(f.repo), undefined);
    const status = await f.reader.status(f.repo);
    assert.equal(status.branch, 'main');
    assert(f.calls.some((args) => args.includes('--absolute-git-dir')));
    await f.connection.close();
    await assert.rejects(f.connection.gitDirectory(f.repo), { name: 'AbortError' });
  } finally {
    await f.close();
  }
});
