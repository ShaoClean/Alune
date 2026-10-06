const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  LocalConnection,
  SSHConnection,
  GitSubmodules,
  GitLfs,
  DiffImages,
  RepositoryFiles,
  GitCommands,
  runGit,
} = require('../dist');
const { parseLfsPointer } = require('../../shared/dist');
const { startSSHServer } = require('./helpers/ssh-server.cjs');
let root, remote, ssh;
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_ALLOW_PROTOCOL: 'file',
};
const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    .toString()
    .trimEnd();
const write = (dir, file, data) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), data);
};
const repo = () => {
  const dir = fs.mkdtempSync(path.join(root, "仓库 ' [x]-"));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Fixture');
  git(dir, 'config', 'user.email', 'fixture@example.invalid');
  return dir;
};
const commit = (dir, label) => {
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', label);
  return git(dir, 'rev-parse', 'HEAD');
};
const noLfs = (connection) => ({
  withSftp: connection.withSftp.bind(connection),
  execCommand: connection.execCommand.bind(connection),
  execGit: (dir, args, signal, options) =>
    args.includes('lfs')
      ? Promise.resolve({ exitCode: 1, stdout: '', stderr: "git: 'lfs' is not a git command" })
      : runGit(connection, dir, args, signal, options),
});
before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-submodules-lfs-'));
  process.env.GIT_ALLOW_PROTOCOL = 'file';
  remote = await startSSHServer();
  ssh = new SSHConnection(remote.options);
  await ssh.connect();
});
after(async () => {
  ssh?.disconnect();
  await remote?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('strict LFS pointer parsing does not reinterpret ordinary text', () => {
  const oid = 'a'.repeat(64);
  assert.deepEqual(
    parseLfsPointer(`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 12\n`),
    { oid, size: 12 },
  );
  assert.equal(
    parseLfsPointer(
      `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 9007199254740992\n`,
    ),
    null,
  );
  assert.equal(parseLfsPointer(`hello\noid sha256:${oid}\nsize 12\n`), null);
});

for (const source of ['local', 'ssh']) {
  test(`${source}: nested submodule initialization, state, summaries, sync and open validation`, async () => {
    const connection = source === 'local' ? new LocalConnection() : ssh;
    const leaf = repo();
    write(leaf, 'hello.txt', 'first');
    commit(leaf, 'nested content');
    const child = repo();
    git(child, 'submodule', 'add', leaf, 'nested space');
    commit(child, 'add nested');
    const parent = repo();
    git(parent, 'submodule', 'add', child, '子 模块');
    commit(parent, 'add module');
    const clone = path.join(root, `clone-${source}`);
    git(root, 'clone', '-q', parent, clone);
    const modules = new GitSubmodules(connection);
    let items = await modules.list(clone);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'uninitialized');
    assert.match(git(clone, 'submodule', 'status'), new RegExp('^-' + items[0].recordedCommit));
    await assert.rejects(modules.resolve(clone, '子 模块'), /初始化/);
    await modules.update(clone, 'update');
    items = await modules.list(clone);
    assert.deepEqual(
      items.map((item) => item.path),
      ['子 模块', '子 模块/nested space'],
    );
    assert.ok(items.every((item) => item.status === 'current' && !item.dirty));
    assert.equal(
      await modules.resolve(clone, '子 模块/nested space'),
      fs.realpathSync(path.join(clone, '子 模块/nested space')),
    );
    await assert.rejects(modules.resolve(clone, '../escape'), /路径/);
    const checked = path.join(clone, '子 模块');
    git(checked, 'config', 'user.name', 'Fixture');
    git(checked, 'config', 'user.email', 'fixture@example.invalid');
    write(checked, 'new.txt', 'new commit');
    const changed = commit(checked, 'submodule summary');
    items = await modules.list(clone);
    assert.equal(items[0].status, 'changed');
    assert.equal(items[0].currentCommit, changed);
    assert.match(
      await new GitCommands(connection).diff(clone, { file: '子 模块' }),
      /submodule summary/,
    );
    write(checked, 'new.txt', 'dirty');
    assert.equal((await modules.list(clone))[0].dirty, true);
    await assert.rejects(modules.update(clone, 'update'), /overwritten|Aborting|Unable/i);
    assert.equal(fs.readFileSync(path.join(checked, 'new.txt'), 'utf8'), 'dirty');
    git(clone, 'config', '-f', '.gitmodules', 'submodule.子 模块.url', leaf);
    await modules.update(clone, 'sync');
    assert.equal(git(clone, 'config', 'submodule.子 模块.url'), leaf);
  });

  test(`${source}: absent git-lfs, cached images, OID verification and historical versions`, async () => {
    const connection = noLfs(source === 'local' ? new LocalConnection() : ssh);
    const dir = repo();
    write(
      dir,
      '.gitattributes',
      '*.png filter=lfs diff=lfs merge=lfs -text\n*.bin filter=lfs -text\n',
    );
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const oid = createHash('sha256').update(bytes).digest('hex');
    const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${bytes.length}\n`;
    write(dir, 'image.png', pointer);
    write(dir, 'asset.bin', pointer);
    const first = commit(dir, 'LFS pointers');
    const lfs = await new GitLfs(connection).status(dir);
    assert.equal(lfs.used, true);
    assert.equal(lfs.installed, false);
    assert.match(lfs.message, /未安装/);
    const files = new RepositoryFiles(connection);
    assert.equal((await files.read(dir, 'image.png')).kind, 'lfs');
    assert.equal((await files.read(dir, 'asset.bin')).size, bytes.length);
    await assert.rejects(
      new DiffImages(connection).read(dir, { file: 'image.png', side: 'after', commit: first }),
      /尚未下载/,
    );
    const object = `.git/lfs/objects/${oid.slice(0, 2)}/${oid.slice(2, 4)}/${oid}`;
    write(dir, object, bytes);
    assert.deepEqual(Buffer.from((await files.read(dir, 'image.png')).content, 'base64'), bytes);
    const images = new DiffImages(connection);
    assert.deepEqual(
      Buffer.from(
        (await images.read(dir, { file: 'image.png', side: 'after', commit: first })).content,
        'base64',
      ),
      bytes,
    );
    write(dir, 'image.png', Buffer.from('new binary\0'));
    assert.deepEqual(
      Buffer.from(
        (await images.read(dir, { file: 'image.png', side: 'before' })).content,
        'base64',
      ),
      bytes,
    );
    write(dir, object, Buffer.alloc(bytes.length));
    await assert.rejects(
      images.read(dir, { file: 'image.png', side: 'after', commit: first }),
      /校验失败/,
    );
    write(dir, 'image.png', pointer);
    assert.match((await files.read(dir, 'image.png')).message, /校验失败/);
    write(dir, 'ordinary.txt', 'unaffected');
    assert.equal((await files.read(dir, 'ordinary.txt')).content, 'unaffected');
  });

  test(`${source}: missing required LFS filter leaves status and ordinary file diffs usable`, async () => {
    const connection = source === 'local' ? new LocalConnection() : ssh;
    const dir = repo();
    write(dir, '.gitattributes', '*.png filter=lfs -text\n');
    write(
      dir,
      'image.png',
      `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 1\n`,
    );
    write(dir, 'ordinary.txt', 'before\n');
    commit(dir, 'initial');
    git(dir, 'config', 'filter.lfs.process', '/alune-not-installed/git-lfs filter-process');
    git(dir, 'config', 'filter.lfs.required', 'true');
    write(dir, 'ordinary.txt', 'after\n');
    write(dir, 'image.png', 'image changed');
    const status = await new GitCommands(connection).status(dir);
    assert.ok(status.files.some((file) => file.path === 'ordinary.txt'));
    const diff = await new GitCommands(connection).diff(dir, { file: 'ordinary.txt' });
    assert.match(diff, /\+after/);
    const stage = await runGit(connection, dir, ['add', '--', 'image.png']);
    assert.notEqual(stage.exitCode, 0, 'missing LFS must never silently stage raw image bytes');
  });

  test(
    `${source}: actual git-lfs commit, push, clone, pull and image preview`,
    {
      skip:
        spawnSync('git', ['lfs', 'version'], { env }).status !== 0
          ? 'git-lfs is not installed'
          : false,
    },
    async () => {
      const connection = source === 'local' ? new LocalConnection() : ssh;
      const dir = repo();
      git(dir, 'lfs', 'install', '--local');
      git(dir, 'lfs', 'track', '*.png', '*.bin');
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      );
      write(dir, 'actual.png', png);
      write(dir, 'asset.bin', Buffer.from([0, 1, 2, 3]));
      commit(dir, 'real LFS content');
      assert.ok(parseLfsPointer(git(dir, 'show', 'HEAD:actual.png')));
      const bare = path.join(root, `remote-${source}.git`);
      git(root, 'init', '--bare', '-q', bare);
      git(dir, 'remote', 'add', 'origin', bare);
      let progress = '';
      const pushed = await runGit(connection, dir, ['push', '-u', 'origin', 'main'], undefined, {
        environment: { GIT_LFS_FORCE_PROGRESS: '1' },
        onStdout: (data) => {
          progress += data;
        },
        onStderr: (data) => {
          progress += data;
        },
      });
      assert.match(progress, /Uploading LFS objects/);
      assert.equal(pushed.exitCode, 0, pushed.stderr);
      const clone = path.join(root, `lfs-clone-${source}`);
      execFileSync('git', ['clone', '-q', '-b', 'main', bare, clone], {
        env: { ...env, GIT_LFS_SKIP_SMUDGE: '1' },
      });
      git(clone, 'lfs', 'install', '--local');
      assert.equal((await new RepositoryFiles(connection).read(clone, 'actual.png')).kind, 'lfs');
      const pull = await runGit(connection, clone, ['lfs', 'pull']);
      assert.equal(pull.exitCode, 0, pull.stderr);
      assert.deepEqual(fs.readFileSync(path.join(clone, 'actual.png')), png);
      assert.equal((await new GitLfs(connection).status(clone)).installed, true);
      const image = await new DiffImages(connection).read(clone, {
        file: 'actual.png',
        commit: 'HEAD',
        side: 'after',
      });
      assert.deepEqual(Buffer.from(image.content, 'base64'), png);
    },
  );
}
