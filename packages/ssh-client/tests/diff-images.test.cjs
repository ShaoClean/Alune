const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SSHConnection } = require('../dist/connection-manager');
const { DiffImages, DiffImageAbsentError } = require('../dist/diff-images');
const { DIFF_IMAGE_MAX_BYTES } = require('../../shared/dist/index');
const { startSSHServer } = require('./helpers/ssh-server.cjs');

let remote, connection, images, root;

// Real 1x1 PNGs, so the bytes returned by a preview can be compared exactly.
const redPixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const bluePixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
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
  run(dir, 'config', 'user.email', 'fixture@example.invalid');
  run(dir, 'config', 'user.name', 'Fixture');
  return dir;
};

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-git-image-'));
  remote = await startSSHServer();
  connection = new SSHConnection(remote.options);
  await connection.connect();
  images = new DiffImages(connection);
});

after(async () => {
  connection?.disconnect();
  await remote?.close();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test('commit previews return both sides of a modified image and report added/deleted sides', async () => {
  const dir = repo();
  const file = '资源/图 标 [1].png';
  write(dir, file, redPixel);
  run(dir, 'add', '--', file);
  run(dir, 'commit', '-qm', 'add image');
  const first = run(dir, 'rev-parse', 'HEAD').toString().trim();
  write(dir, file, bluePixel);
  run(dir, 'add', '--', file);
  run(dir, 'commit', '-qm', 'change image');
  const second = run(dir, 'rev-parse', 'HEAD').toString().trim();

  const after = await images.read(dir, { file, side: 'after', commit: second });
  assert.equal(after.mediaType, 'image/png');
  assert.equal(after.byteLength, bluePixel.length);
  assert.deepEqual(Buffer.from(after.content, 'base64'), bluePixel);
  const before = await images.read(dir, { file, side: 'before', commit: second });
  assert.deepEqual(Buffer.from(before.content, 'base64'), redPixel);
  assert.deepEqual(
    Buffer.from(
      (await images.read(dir, { file, side: 'before', commit: second, parentCommit: first }))
        .content,
      'base64',
    ),
    redPixel,
  );

  // The first commit has no parent version of the file.
  await assert.rejects(
    images.read(dir, { file, side: 'before', commit: first }),
    (error) => error instanceof DiffImageAbsentError,
  );
  run(dir, 'rm', '-q', '--', file);
  run(dir, 'commit', '-qm', 'delete image');
  const third = run(dir, 'rev-parse', 'HEAD').toString().trim();
  await assert.rejects(
    images.read(dir, { file, side: 'after', commit: third }),
    (error) => error instanceof DiffImageAbsentError,
  );
  assert.deepEqual(
    Buffer.from((await images.read(dir, { file, side: 'before', commit: third })).content, 'base64'),
    bluePixel,
  );
});

test('worktree and index previews stay on their own side without touching the repository', async () => {
  const dir = repo();
  write(dir, 'logo.png', redPixel);
  run(dir, 'add', 'logo.png');
  run(dir, 'commit', '-qm', 'initial');
  write(dir, 'logo.png', bluePixel);
  run(dir, 'add', 'logo.png');
  const worktreeOnly = Buffer.concat([bluePixel, Buffer.from([0])]);
  write(dir, 'logo.png', worktreeOnly);
  const index = fs.readFileSync(path.join(dir, '.git/index'));

  // Staged: HEAD → index. Unstaged: index → worktree.
  assert.deepEqual(
    Buffer.from((await images.read(dir, { file: 'logo.png', side: 'before', staged: true })).content, 'base64'),
    redPixel,
  );
  assert.deepEqual(
    Buffer.from((await images.read(dir, { file: 'logo.png', side: 'after', staged: true })).content, 'base64'),
    bluePixel,
  );
  assert.deepEqual(
    Buffer.from((await images.read(dir, { file: 'logo.png', side: 'before' })).content, 'base64'),
    bluePixel,
  );
  assert.deepEqual(
    Buffer.from((await images.read(dir, { file: 'logo.png', side: 'after' })).content, 'base64'),
    worktreeOnly,
  );
  assert.deepEqual(fs.readFileSync(path.join(dir, '.git/index')), index);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'logo.png')), worktreeOnly);
});

test('unsupported types, oversized files, directories, missing paths and traversal are rejected', async () => {
  const dir = repo();
  write(dir, 'notes.txt', 'text\n');
  write(dir, 'huge.png', Buffer.alloc(DIFF_IMAGE_MAX_BYTES + 1));
  write(dir, 'folder.png/child', 'not an image');
  await assert.rejects(images.read(dir, { file: 'notes.txt', side: 'after' }), /不支持图片预览/);
  await assert.rejects(images.read(dir, { file: 'huge.png', side: 'after' }), /超出预览限制/);
  await assert.rejects(images.read(dir, { file: 'folder.png', side: 'after' }), /普通文件/);
  await assert.rejects(images.read(dir, { file: 'gone.png', side: 'after' }), DiffImageAbsentError);
  await assert.rejects(images.read(dir, { file: 'a.png', side: 'sideways' }), /变更前或变更后/);
  for (const file of ['../outside.png', '/etc/icon.png', '.git/config.png', 'a/../../x.png'])
    await assert.rejects(images.read(dir, { file, side: 'after' }), /相对文件路径/);

  // A staged blob above the limit is rejected before any payload is transferred.
  run(dir, 'add', 'huge.png');
  await assert.rejects(
    images.read(dir, { file: 'huge.png', side: 'after', staged: true }),
    /超出预览限制/,
  );
  assert.equal(connection.connected, true);
});

test('Windows repositories reject backslash and stream paths before connecting', async () => {
  const offline = new DiffImages({
    execCommand() {
      throw new Error('must not connect');
    },
  });
  for (const file of ['..\\outside.png', 'dir\\icon.png', 'icon.png:stream'])
    await assert.rejects(offline.read('D:\\workspace\\app', { file, side: 'after' }), /Windows 仓库|相对文件路径/);
});
