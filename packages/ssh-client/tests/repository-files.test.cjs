const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SSHConnection } = require('../dist/connection-manager');
const {
  RepositoryFiles,
  RepositoryFileError,
  decodeTextPreview,
} = require('../dist/repository-files');
const {
  DIFF_IMAGE_MAX_BYTES,
  REPOSITORY_TEXT_PREVIEW_MAX_BYTES,
  REPOSITORY_TREE_MAX_ENTRIES,
} = require('../../shared/dist/index');
const { startSSHServer } = require('./helpers/ssh-server.cjs');

let remote, connection, files, root;

const redPixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const run = (repo, ...args) =>
  execFileSync('git', ['-C', repo, ...args], {
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });

const write = (repo, file, content) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), content);
};

const repo = () => {
  const dir = fs.mkdtempSync(path.join(root, "repo '$() 空格-"));
  run(dir, 'init', '-q', '-b', 'main');
  return dir;
};

const rejectsWith = (promise, status, pattern) =>
  assert.rejects(promise, (error) => {
    assert.ok(error instanceof RepositoryFileError, error);
    assert.equal(error.statusCode, status);
    assert.match(error.message, pattern);
    return true;
  });

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-files-'));
  remote = await startSSHServer();
  connection = new SSHConnection(remote.options);
  await connection.connect();
  files = new RepositoryFiles(connection);
});

after(async () => {
  connection?.disconnect();
  await remote?.close();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test('directories list lazily with folders first, natural order, links and nested repositories', async () => {
  const dir = repo();
  write(dir, 'file10.txt', 'ten');
  write(dir, 'file2.txt', 'two');
  write(dir, "引号 '$(x)'.md", '# title');
  write(dir, 'src/deep/a.ts', 'export {}');
  write(dir, 'Zeta/.keep', '');
  fs.mkdirSync(path.join(dir, 'vendor/lib'), { recursive: true });
  run(path.join(dir, 'vendor/lib'), 'init', '-q');
  fs.mkdirSync(path.join(dir, 'modules/child'), { recursive: true });
  // A submodule checkout stores its .git as a gitlink file.
  fs.writeFileSync(path.join(dir, 'modules/child/.git'), 'gitdir: ../../.git/modules/child\n');
  fs.symlinkSync('src/deep', path.join(dir, 'link-dir'));
  fs.symlinkSync('/etc/passwd', path.join(dir, 'outside'));

  const listing = await files.list(dir, '');
  assert.equal(listing.path, '');
  assert.equal(listing.truncated, false);
  assert.deepEqual(
    listing.entries.map((entry) => [entry.name, entry.kind]),
    [
      ['modules', 'directory'],
      ['src', 'directory'],
      ['vendor', 'directory'],
      ['Zeta', 'directory'],
      ['file2.txt', 'file'],
      ['file10.txt', 'file'],
      ['link-dir', 'symlink'],
      ['outside', 'symlink'],
      ["引号 '$(x)'.md", 'file'],
    ],
  );
  assert.equal(listing.total, listing.entries.length);
  assert.equal(listing.entries.find((entry) => entry.name === 'file10.txt').size, 3);
  assert.equal(listing.entries.find((entry) => entry.name === 'link-dir').target, 'src/deep');
  assert.equal(listing.entries.find((entry) => entry.name === 'outside').target, '/etc/passwd');

  const nested = await files.list(dir, 'vendor');
  assert.deepEqual(nested.entries, [{ name: 'lib', path: 'vendor/lib', kind: 'submodule' }]);
  const modules = await files.list(dir, 'modules');
  assert.equal(modules.entries[0].kind, 'submodule');
  const deep = await files.list(dir, 'src/deep');
  assert.deepEqual(deep.entries, [{ name: 'a.ts', path: 'src/deep/a.ts', kind: 'file', size: 9 }]);
  assert.deepEqual(
    (await files.list(dir, 'Zeta')).entries.map((entry) => entry.name),
    ['.keep'],
  );
});

test('paths outside the worktree, into .git or through links are refused', async () => {
  const dir = repo();
  write(dir, 'src/a.txt', 'a');
  fs.symlinkSync('src', path.join(dir, 'alias'));
  fs.symlinkSync(root, path.join(dir, 'escape'));
  for (const bad of ['/etc', '../x', 'src/../..', 'src//a.txt', '.git', 'src/.GIT/config', './src'])
    await rejectsWith(files.list(dir, bad), 400, /相对路径/);
  await rejectsWith(files.read(dir, ''), 400, /相对路径/);
  await rejectsWith(files.read(dir, '.git/config'), 400, /\.git/);
  await rejectsWith(files.list(dir, 'alias'), 400, /符号链接/);
  await rejectsWith(files.list(dir, 'escape'), 400, /符号链接/);
  await rejectsWith(files.read(dir, 'alias/a.txt'), 400, /符号链接/);
  await rejectsWith(
    files.read(dir, 'escape/' + path.basename(dir) + '/src/a.txt'),
    400,
    /符号链接/,
  );
  await rejectsWith(files.list(dir, 'src/a.txt'), 400, /不是目录/);
  await rejectsWith(files.read(dir, 'src'), 400, /是目录/);
  await rejectsWith(files.list(dir, 'missing'), 404, /不存在/);
  await rejectsWith(files.read(dir, 'src/missing.txt'), 404, /不存在/);
  assert.deepEqual(await files.read(dir, 'alias'), {
    path: 'alias',
    kind: 'symlink',
    target: 'src',
  });
});

test('previews text, images, binaries, encodings and size limits explicitly', async () => {
  const dir = repo();
  write(dir, 'readme.md', '# 标题\nline 2\n');
  write(dir, 'empty.txt', '');
  write(dir, 'bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('带 BOM')]));
  write(
    dir,
    'wide.txt',
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('宽字符', 'utf16le')]),
  );
  const big = Buffer.from('宽字符', 'utf16le').swap16();
  write(dir, 'big-endian.txt', Buffer.concat([Buffer.from([0xfe, 0xff]), big]));
  write(dir, 'gbk.txt', Buffer.from([0xc4, 0xe3, 0xba, 0xc3]));
  write(dir, 'data.bin', Buffer.from([1, 2, 0, 3]));
  write(dir, 'pixel.PNG', redPixel);
  write(dir, 'large.log', Buffer.alloc(REPOSITORY_TEXT_PREVIEW_MAX_BYTES + 1, 0x61));
  write(dir, 'limit.log', Buffer.alloc(REPOSITORY_TEXT_PREVIEW_MAX_BYTES, 0x61));
  write(dir, 'huge.webp', Buffer.alloc(DIFF_IMAGE_MAX_BYTES + 1));
  execFileSync('mkfifo', [path.join(dir, 'pipe')]);

  assert.deepEqual(await files.read(dir, 'readme.md'), {
    path: 'readme.md',
    kind: 'text',
    size: Buffer.byteLength('# 标题\nline 2\n'),
    encoding: 'utf-8',
    content: '# 标题\nline 2\n',
  });
  assert.equal((await files.read(dir, 'empty.txt')).content, '');
  assert.equal((await files.read(dir, 'bom.txt')).content, '带 BOM');
  assert.deepEqual(
    [(await files.read(dir, 'wide.txt')).encoding, (await files.read(dir, 'wide.txt')).content],
    ['utf-16le', '宽字符'],
  );
  assert.equal((await files.read(dir, 'big-endian.txt')).content, '宽字符');
  assert.deepEqual(await files.read(dir, 'gbk.txt'), {
    path: 'gbk.txt',
    kind: 'unsupported-encoding',
    size: 4,
  });
  assert.deepEqual(await files.read(dir, 'data.bin'), {
    path: 'data.bin',
    kind: 'binary',
    size: 4,
  });
  const image = await files.read(dir, 'pixel.PNG');
  assert.equal(image.kind, 'image');
  assert.equal(image.mediaType, 'image/png');
  assert.deepEqual(Buffer.from(image.content, 'base64'), redPixel);
  assert.deepEqual(await files.read(dir, 'large.log'), {
    path: 'large.log',
    kind: 'too-large',
    size: REPOSITORY_TEXT_PREVIEW_MAX_BYTES + 1,
    limit: REPOSITORY_TEXT_PREVIEW_MAX_BYTES,
  });
  assert.equal(
    (await files.read(dir, 'limit.log')).content.length,
    REPOSITORY_TEXT_PREVIEW_MAX_BYTES,
  );
  assert.equal((await files.read(dir, 'huge.webp')).limit, DIFF_IMAGE_MAX_BYTES);
  assert.deepEqual(await files.read(dir, 'pipe'), { path: 'pipe', kind: 'other' });
  assert.deepEqual(
    (await files.list(dir, '')).entries.find((entry) => entry.name === 'pipe').kind,
    'other',
  );
});

test('permission failures are reported without breaking sibling reads', async (t) => {
  if (process.getuid?.() === 0) return t.skip('root ignores file permissions');
  const dir = repo();
  write(dir, 'locked/secret.txt', 'x');
  write(dir, 'private.txt', 'x');
  write(dir, 'open.txt', 'fine');
  fs.chmodSync(path.join(dir, 'locked'), 0);
  fs.chmodSync(path.join(dir, 'private.txt'), 0);
  try {
    await rejectsWith(files.list(dir, 'locked'), 403, /权限/);
    await rejectsWith(files.read(dir, 'private.txt'), 403, /权限/);
    assert.equal((await files.read(dir, 'open.txt')).content, 'fine');
  } finally {
    fs.chmodSync(path.join(dir, 'locked'), 0o755);
    fs.chmodSync(path.join(dir, 'private.txt'), 0o644);
  }
});

test('very large directories are truncated with the real total', async () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, 'many'));
  const count = REPOSITORY_TREE_MAX_ENTRIES + 3;
  for (let index = 0; index < count; index++)
    fs.writeFileSync(path.join(dir, 'many', `f${index}`), '');
  const listing = await files.list(dir, 'many');
  assert.equal(listing.entries.length, REPOSITORY_TREE_MAX_ENTRIES);
  assert.equal(listing.total, count);
  assert.equal(listing.truncated, true);
  assert.deepEqual(
    listing.entries.slice(0, 3).map((entry) => entry.name),
    ['f0', 'f1', 'f2'],
  );
});

test('text decoding sniffs binaries like Git and keeps UTF-16 apart from NUL bytes', () => {
  assert.equal(decodeTextPreview(Buffer.from([0x61, 0])), 'binary');
  assert.equal(decodeTextPreview(Buffer.from([0xff, 0xfe, 0x61, 0])).content, 'a');
  assert.equal(decodeTextPreview(Buffer.from([0xfe, 0xff, 0, 0x61, 0])), 'unsupported-encoding');
  assert.equal(decodeTextPreview(Buffer.from([0xe4, 0xb8])), 'unsupported-encoding');
  assert.equal(
    decodeTextPreview(Buffer.concat([Buffer.alloc(8000, 0x61), Buffer.from([0])])).encoding,
    'utf-8',
  );
});
