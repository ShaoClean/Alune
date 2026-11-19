const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { spawnAgent } = require('@alune/agent-client/node');
const { GitReads } = require('../dist/modules/git/git-commands');
const { NativeRepositoryConnection } = require('../dist/adapters/git/native');
const { RepositoryReads } = require('../dist/runtime/reads');
const fixture = path.resolve(__dirname, 'settings-fixture.cjs');
const plain = (x) => JSON.parse(JSON.stringify(x));
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-repositories-rpc-'));
  const repo = path.join(root, '中文 repo');
  fs.mkdirSync(repo);
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: path.join(root, 'no-config'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'P3 Fixture');
  git('config', 'user.email', 'fixture@example.test');
  fs.writeFileSync(path.join(repo, 'file.txt'), 'first\nsecond\nthird\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored/\n');
  fs.writeFileSync(path.join(repo, 'image.png'), Buffer.from([137, 80, 78, 71, 0, 1, 2, 3]));
  git('add', '.');
  git('commit', '-m', 'initial');
  const first = git('rev-parse', 'HEAD');
  git('mv', 'file.txt', '重命名 file.txt');
  git('commit', '-m', 'rename');
  git('tag', 'v1');
  git('branch', 'feature');
  fs.writeFileSync(path.join(repo, '重命名 file.txt'), 'first\nchanged\nthird\n');
  git('add', '.');
  fs.appendFileSync(path.join(repo, '重命名 file.txt'), 'working\n');
  fs.writeFileSync(path.join(repo, 'literal [x] $().txt'), 'literal\r\n');
  fs.writeFileSync(path.join(repo, 'large.txt'), '中文🚀\n'.repeat(15000));
  fs.writeFileSync(path.join(repo, 'binary.dat'), Buffer.from([0, 1, 2, 255]));
  fs.writeFileSync(
    path.join(repo, 'utf16.txt'),
    Buffer.concat([Buffer.from([255, 254]), Buffer.from('中文\r\n', 'utf16le')]),
  );
  fs.mkdirSync(path.join(repo, 'ignored'));
  fs.writeFileSync(path.join(repo, 'ignored', 'hidden'), 'ignore');
  const index = path.join(repo, '.git', 'index');
  const digest = () => createHash('sha256').update(fs.readFileSync(index)).digest('hex');
  const children = [];
  const start = async () => {
    const child = spawnAgent(process.execPath, [fixture, path.join(root, 'state')]);
    children.push(child);
    await child.client.initialize();
    return child;
  };
  t.after(async () => {
    await Promise.all(children.map((c) => c.close()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, repo, git, first, digest, start };
}

test(
  'repository RPC reads real Git and native files, preserves index and returns bounded snapshots',
  { timeout: 120000 },
  async (t) => {
    const f = await setup(t),
      child = await f.start(),
      client = child.client;
    const init = await client.initialize();
    assert(init.capabilities.includes('repositories.read'));
    const repo = await client.registerRepository(f.repo);
    assert.equal((await client.registerRepository(path.join(f.repo, 'ignored'))).id, repo.id);
    assert.equal(repo.resource.agentId, init.agentId);
    assert.deepEqual(
      (await client.listRepositories()).map((r) => r.id),
      [repo.id],
    );
    const query = (kind, params = {}) => client.readRepository(repo.resource, kind, params);
    const before = f.digest();
    const old = new GitReads(new NativeRepositoryConnection());
    const status = await query('status');
    assert.deepEqual(status.files, (await old.status(f.repo)).files);
    assert.equal(status.worktreeKind, 'main');
    for (const [kind, params, expected] of [
      ['branches', {}, await old.branchList(f.repo)],
      ['remotes', {}, await old.remoteList(f.repo)],
      ['stashes', {}, await old.stashList(f.repo)],
      [
        'diff',
        { file: '重命名 file.txt', fullFile: true },
        await old.diff(f.repo, { file: '重命名 file.txt', fullFile: true }),
      ],
      ['commitFiles', { commit: f.first }, await old.commitFiles(f.repo, f.first)],
    ])
      assert.deepEqual(await query(kind, params), plain(expected), kind);
    const context = await query('context');
    assert.equal(context.author.name, 'P3 Fixture');
    assert.equal(
      context.path,
      process.platform === 'win32'
        ? fs.realpathSync.native(f.repo).split(path.sep).join('/')
        : fs.realpathSync.native(f.repo),
    );
    const log = await query('log', { count: 1 });
    assert.equal(log.commits[0].message, 'rename');
    assert.equal(log.hasMore, true);
    const next = await query('log', { count: 1, skip: log.nextSkip, revision: log.revision });
    assert.equal(next.commits[0].hash, f.first);
    const followed = await query('log', { file: '重命名 file.txt', follow: true });
    assert.equal(followed.commits.length, 2);
    assert.equal((await query('log', { search: 'initial' })).commits.length, 1);
    assert.equal((await query('tags')).local[0].name, 'v1');
    const tree = await query('tree', { path: '' });
    assert(!tree.entries.some((e) => e.name === '.git'));
    assert(tree.entries.find((e) => e.name === 'ignored').ignored);
    assert.equal((await query('file', { path: 'literal [x] $().txt' })).content, 'literal\r\n');
    assert.equal((await query('file', { path: 'utf16.txt' })).encoding, 'utf-16le');
    assert.equal((await query('file', { path: 'binary.dat' })).kind, 'binary');
    assert.equal((await query('file', { path: 'large.txt' })).content, '中文🚀\n'.repeat(15000));
    const receipt = await client.request('repositories.read', {
      resource: repo.resource,
      kind: 'file',
      params: { path: 'large.txt' },
    });
    assert(receipt.chunks > 1);
    const chunk = await client.request('repositories.chunk', {
      snapshotId: receipt.snapshotId,
      index: 0,
    });
    assert(Buffer.byteLength(JSON.stringify(chunk)) < 65536);
    await client.invalidateRepository(repo.resource);
    await assert.rejects(
      client.request('repositories.chunk', { snapshotId: receipt.snapshotId, index: 0 }),
      (e) => e.kind === 'not-found',
    );
    const diff = await query('editableDiff', {
      file: '重命名 file.txt',
      staged: true,
      fullFile: true,
    });
    assert(diff.revision);
    const { PartialReads } = require('../dist/modules/git/partial-changes');
    assert.equal(
      (
        await new PartialReads(new NativeRepositoryConnection()).preview(
          f.repo,
          '重命名 file.txt',
          true,
          true,
        )
      ).revision,
      diff.revision,
      'native aliases must produce the same actionable revision',
    );
    assert.match(diff.diff, /changed/);
    const image = await query('diffImage', { file: 'image.png', commit: f.first, side: 'after' });
    assert.equal(image.byteLength, 8);
    assert.equal((await query('blame', { path: '重命名 file.txt' })).kind, 'ready');
    assert.equal((await query('blameCommit', { hash: f.first })).hash, f.first);
    assert.equal(
      (
        await query('analytics', {
          endDay: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        })
      ).daily.reduce((a, b) => a + b, 0),
      2,
    );
    assert.equal((await query('signing')).enabled, false);
    assert.equal((await query('signatures', { hashes: [f.first] }))[0].status, 'unsigned');
    assert.deepEqual(await query('submodules'), []);
    assert.equal(typeof (await query('lfs')).installed, 'boolean');
    const uncached = await client.repositoryAnalytics([repo.resource]);
    assert.equal(uncached[0].data, undefined);
    const collected = await client.repositoryAnalytics([repo.resource], true);
    assert(collected[0].data);
    assert.equal(
      (await client.repositoryAnalytics([repo.resource]))[0].data.collectedAt,
      collected[0].data.collectedAt,
    );
    await client.invalidateRepository(repo.resource);
    assert.equal((await client.repositoryAnalytics([repo.resource]))[0].data, undefined);
    const snapshot = await query('snapshot');
    assert.equal(snapshot.indexDigest, before);
    assert.equal(snapshot.head, f.git('rev-parse', 'HEAD'));
    assert.equal(f.digest(), before, 'read-only queries must not refresh the index');
    await assert.rejects(query('file', { path: '../outside' }), (e) => e.kind === 'invalid-params');
    await assert.rejects(
      client.readRepository({ ...repo.resource, agentId: randomUUID() }, 'status', {}),
      (e) => e.kind === 'not-found',
    );
    await assert.rejects(
      client.request('repositories.read', {
        resource: repo.resource,
        kind: 'execute',
        params: { args: ['reset', '--hard'] },
      }),
      (e) => e.kind === 'invalid-params',
    );
    await assert.rejects(
      client.request('git.stage', { resource: repo.resource, files: ['.'] }),
      (e) => e.kind === 'unknown-method',
    );
    const linked = path.join(f.root, 'linked tree');
    f.git('worktree', 'add', linked, 'feature');
    const worktrees = await query('worktrees');
    assert.equal(worktrees.length, 2);
    const opened = await client.openRelatedRepository(
      repo.resource,
      worktrees.find((w) => !w.isCurrent).path,
      'worktree',
    );
    assert.notEqual(opened.id, repo.id);
    const other = await client.readRepository(opened.resource, 'snapshot', {});
    assert.equal(other.commonDirectory, snapshot.commonDirectory);
    assert.notEqual(other.gitDirectory, snapshot.gitDirectory);
    await client.pinRepository(repo.resource, true);
    await child.close();
    const restarted = await f.start();
    assert.equal((await restarted.client.listRepositories())[0].id, repo.id);
    assert.equal((await restarted.client.listRepositories())[0].pinned, true);
    assert.equal((await restarted.client.getRepository(repo.resource)).id, repo.id);
    await restarted.client.unregisterRepository(opened.resource);
    assert.equal((await restarted.client.listRepositories()).length, 1);
    assert(fs.existsSync(linked), 'unregister must retain the worktree files');
    await assert.rejects(
      restarted.client.readRepository(opened.resource, 'status', {}),
      (e) => e.kind === 'not-found',
    );
  },
);

test('coalesced status cancellation has separate owners; invalidation rejects stale work', async () => {
  const reads = new RepositoryReads();
  const a = new AbortController(),
    b = new AbortController();
  let calls = 0,
    finish;
  const run = (signal) => {
    calls++;
    return new Promise((resolve, reject) => {
      finish = resolve;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };
  const first = reads.status('repo', false, a.signal, run),
    second = reads.status('repo', true, b.signal, run);
  const cancelled = assert.rejects(first);
  await new Promise((r) => setImmediate(r));
  a.abort();
  await cancelled;
  assert.equal(calls, 1);
  finish('ok');
  assert.equal(await second, 'ok');
  const stale = reads.status('repo', false, b.signal, run);
  const rejected = assert.rejects(stale, (e) => {
    assert.equal(e.kind, 'conflict');
    assert.deepEqual(e.details, { code: 'READ_INVALIDATED', resourceId: 'repo' });
    assert.deepEqual(e.toRpcError().data.details, e.details);
    return true;
  });
  await new Promise((r) => setImmediate(r));
  reads.invalidate('repo');
  await rejected;
  await reads.close();
});

test('completed native reads invalidated before delivery identify the exact resource', async (t) => {
  const f = await setup(t);
  const head = f.git('rev-parse', 'HEAD');
  const { openStateKernel } = require('../dist/bootstrap/state-kernel');
  const { loadIdentity } = require('../dist/adapters/identity');
  const { RepositoryReader } = require('../dist/modules/repositories/reads');
  const dir = path.join(f.root, 'read-generation-state'),
    agentId = await loadIdentity(dir);
  const kernel = await openStateKernel(dir, agentId, undefined, { backend: 'file' });
  const context = {
    signal: new AbortController().signal,
    sessionId: randomUUID(),
    events: { notifyState() {} },
  };
  const original = RepositoryReader.prototype.query;
  let release, entered, read;
  const held = new Promise((resolve) => {
      release = resolve;
    }),
    started = new Promise((resolve) => {
      entered = resolve;
    });
  try {
    const repo = await kernel.handlers['repositories.register'].run({ path: f.repo }, context);
    RepositoryReader.prototype.query = async function (...args) {
      const value = await original.apply(this, args);
      if (args[1].kind === 'signatures') {
        entered();
        await held;
      }
      return value;
    };
    read = kernel.handlers['repositories.read'].run(
      { resource: repo.resource, kind: 'signatures', params: { hashes: [f.first] } },
      context,
    );
    await Promise.race([started, read]);
    const rejected = assert.rejects(read, (e) => {
      assert.equal(e.kind, 'conflict');
      assert.deepEqual(e.details, {
        code: 'READ_INVALIDATED',
        resourceId: repo.resource.resourceId,
      });
      return true;
    });
    await kernel.handlers['repositories.invalidate'].run({ resource: repo.resource }, context);
    release();
    await rejected;
    assert.equal(f.git('rev-parse', 'HEAD'), head);
  } finally {
    release();
    RepositoryReader.prototype.query = original;
    await read?.catch(() => {});
    await kernel.close();
  }
});

test(
  'offline repository reads do not unlock or repair missing unrelated credentials',
  { timeout: 60000 },
  async (t) => {
    const f = await setup(t),
      child = await f.start(),
      client = child.client;
    const repo = await client.registerRepository(f.repo);
    const settings = await client.getAiSettings();
    const provider = settings.providers.find((p) => p.id === 'openai');
    await client.saveAiProvider(
      'openai',
      {
        name: provider.name,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        enabled: true,
        models: provider.models,
        apiKey: 'fixture-key-to-lose',
      },
      settings.revision,
    );
    await child.close();
    const keys = path.join(f.root, 'state', 'keys');
    const key = fs.readdirSync(keys).find((name) => name.endsWith('.key'));
    assert(key);
    fs.renameSync(path.join(keys, key), path.join(keys, key + '.retained'));
    const restarted = await f.start();
    assert.equal(
      (await restarted.client.readRepository(repo.resource, 'status', {})).branch,
      'main',
    );
    assert.equal(
      (await restarted.client.readRepository(repo.resource, 'file', { path: 'utf16.txt' }))
        .encoding,
      'utf-16le',
    );
    assert.equal(fs.existsSync(path.join(keys, key)), false, 'must not replace the missing key');
    await assert.rejects(restarted.client.prepareCredentials());
  },
);

test(
  'metadata stays offline in promisor repositories while object reads retain proxy failure boundaries',
  { timeout: 30000 },
  async (t) => {
    const f = await setup(t);
    f.git('config', 'remote.origin.promisor', 'true');
    let snapshots = 0;
    const connection = new NativeRepositoryConnection(
      undefined,
      async () => {
        snapshots++;
        throw new Error('fixture proxy unavailable');
      },
      true,
    );
    t.after(() => connection.close());
    assert.equal(
      (await connection.execGit(f.repo, ['rev-parse', '--is-shallow-repository'])).exitCode,
      0,
    );
    assert.equal(
      (await connection.execGit(f.repo, ['symbolic-ref', '--quiet', 'HEAD'])).exitCode,
      0,
    );
    assert.equal((await connection.execGit(f.repo, ['ls-files', '--stage', '-z'])).exitCode, 0);
    assert.equal(snapshots, 0);
    for (const args of [
      ['log', '-1'],
      ['show', 'HEAD:重命名 file.txt'],
      ['diff'],
      ['status', '--porcelain'],
      ['for-each-ref', '--format=%(contents)'],
      ['config', '--blob=HEAD:config', '--get', 'user.name'],
    ])
      await assert.rejects(connection.execGit(f.repo, args), /fixture proxy unavailable/);
    assert.equal(snapshots, 6);
  },
);

test('analytics retains cached failure markers and invalidation cannot resurrect old data', async () => {
  const { RepositoryAnalyticsCache } = require('../dist/modules/repositories/analytics');
  const resource = { agentId: 'agent', resourceId: 'repo' },
    signal = new AbortController().signal;
  let fail = false,
    finish;
  const sample = {
    endDay: new Date().toISOString().slice(0, 10),
    daily: Array(180).fill(0),
    collectedAt: Date.now(),
    language: null,
    sampledFiles: 0,
    shallow: false,
    unborn: false,
    truncated: false,
  };
  const cache = new RepositoryAnalyticsCache(async () => {
    if (fail) throw new Error('offline');
    return sample;
  });
  await cache.batch([resource], true, false, signal);
  fail = true;
  const failed = await cache.batch([resource], true, true, signal);
  assert.equal(failed[0].error, 'offline');
  assert.deepEqual(failed[0].data, sample);
  assert.deepEqual(await cache.batch([resource], false, false, signal), failed);
  cache.invalidate('repo');
  assert.deepEqual(await cache.batch([resource], false, false, signal), [{ id: 'repo', resource }]);
  await cache.close();
  const delayed = new RepositoryAnalyticsCache(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = delayed.batch([resource], true, true, signal);
  await new Promise((resolve) => setImmediate(resolve));
  delayed.invalidate('repo');
  finish(sample);
  await pending;
  assert.deepEqual(await delayed.batch([resource], false, false, signal), [
    { id: 'repo', resource },
  ]);
  await delayed.close();
});

test(
  'disabled proxy hint is read per command and never retained after configuration changes',
  { timeout: 30000 },
  async (t) => {
    const f = await setup(t);
    f.git('config', 'remote.origin.promisor', 'true');
    let enabled = false,
      snapshots = 0;
    const connection = new NativeRepositoryConnection(
      undefined,
      () => {
        snapshots++;
        throw new Error('fixture proxy unavailable');
      },
      true,
      () => enabled,
    );
    t.after(() => connection.close());
    assert.equal((await connection.execGit(f.repo, ['log', '-1'])).exitCode, 0);
    assert.equal(snapshots, 0);
    enabled = true;
    await assert.rejects(connection.execGit(f.repo, ['log', '-1']), /fixture proxy unavailable/);
    assert.equal(snapshots, 1);
  },
);

test(
  'diff revisions cannot turn a read into Git output-file writes',
  { timeout: 30000 },
  async (t) => {
    const f = await setup(t),
      child = await f.start(),
      repo = await child.client.registerRepository(f.repo);
    const target = path.join(f.root, 'must-not-be-created');
    const option = '--output=' + target;
    const connection = new NativeRepositoryConnection();
    t.after(() => connection.close());
    const reads = new GitReads(connection);
    for (const params of [{ commit: option }, { commit: 'HEAD', parentCommit: option }]) {
      await assert.rejects(reads.diff(f.repo, params), /无效的提交引用/);
      await assert.rejects(
        child.client.request('repositories.read', {
          resource: repo.resource,
          kind: 'diff',
          params,
        }),
        (e) => e.kind === 'invalid-params',
      );
    }
    const { DiffImages } = require('../dist/modules/git/diff-images');
    await assert.rejects(
      new DiffImages(connection).read(f.repo, { file: 'image.png', side: 'after', commit: option }),
      /无效的提交引用/,
    );
    await assert.rejects(
      child.client.request('repositories.read', {
        resource: repo.resource,
        kind: 'diffImage',
        params: { file: 'image.png', side: 'after', commit: option },
      }),
      (e) => e.kind === 'invalid-params',
    );
    assert.equal(fs.existsSync(target), false);
  },
);
