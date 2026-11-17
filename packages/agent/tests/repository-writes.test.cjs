const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { spawnAgent } = require('@alune/agent-client/node');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-write-')),
    repo = path.join(root, '中文 work');
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(root, 'global'),
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_TERMINAL_PROMPT: '0',
  };
  fs.mkdirSync(repo);
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  const file = (p, body) => fs.writeFileSync(path.join(repo, p), body);
  git('init', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  file('a.txt', 'base\n');
  git('add', '.');
  git('commit', '-m', 'base');
  let child, client;
  const start = async () => {
    child = spawnAgent(
      process.execPath,
      [path.join(__dirname, 'settings-fixture.cjs'), path.join(root, 'agent')],
      { env },
    );
    client = child.client;
    await client.initialize();
  };
  t.after(async () => {
    await child?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await start();
  const { resource } = await client.registerRepository(repo);
  const prepare = async (kind, args = [], r = resource) => {
    const intent = { resource: r, kind, args };
    return {
      ...intent,
      revision: await client.prepareRepositoryWrite(intent),
      operationId: randomUUID(),
    };
  };
  const write = async (kind, args = [], r) => client.writeRepository(await prepare(kind, args, r));
  const read = (kind, params = {}) => client.readRepository(resource, kind, params);
  return {
    root,
    repo,
    git,
    file,
    resource,
    prepare,
    write,
    read,
    get client() {
      return client;
    },
    async restart() {
      await child.close();
      await start();
    },
  };
}
const rejectsKind = (promise, kind) => assert.rejects(promise, (e) => e.kind === kind);

test('Agent checks file bytes, index and shared refs and never replays a committed operation after restart', async (t) => {
  const f = await fixture(t);
  const name = '文 [x] $.txt';
  f.file(name, 'A\r\n');
  const stale = await f.prepare('stage', [[name]]);
  f.file(name, 'B\r\n');
  await rejectsKind(f.client.writeRepository(stale), 'conflict');
  assert.equal(f.git('diff', '--cached', '--name-only'), '');
  await f.write('stage', [[name]]);
  assert.equal(f.git('show', ':' + name), 'B');
  await f.write('unstage', [[name]]);
  await f.write('stage', [[name]]);
  const commit = await f.prepare('commit', ['title', 'body']);
  await f.client.writeRepository(commit);
  const oid = f.git('rev-parse', 'HEAD');
  assert.equal(f.git('log', '-1', '--format=%B'), 'title\n\nbody');
  await f.restart();
  const receipt = await f.client.getTask({ taskId: commit.operationId });
  assert.equal(receipt.task.state, 'succeeded');
  await rejectsKind(f.client.writeRepository(commit), 'duplicate-request');
  assert.equal(f.git('rev-parse', 'HEAD'), oid);
  const next = await f.prepare('createBranch', ['branch-two']);
  f.git('branch', 'outside');
  await rejectsKind(f.client.writeRepository(next), 'conflict');
  const indexChange = await f.prepare('saveAuthor', ['somebody', 'me@example.invalid']);
  f.file('a.txt', 'changed\n');
  f.git('add', 'a.txt');
  await rejectsKind(f.client.writeRepository(indexChange), 'conflict');
  await f.write('commit', ['amended', null, oid]);
  assert.equal(f.git('rev-list', '--count', 'HEAD'), '2');
  await rejectsKind(
    f.client.request('repositories.prepareWrite', {
      resource: f.resource,
      kind: 'execute',
      args: ['status'],
    }),
    'invalid-params',
  );
});

test('file operations protect staged bytes, stale previews, literal paths, and confirmation scope', async (t) => {
  const f = await fixture(t);
  const name = 'literal [a].txt';
  await f.write('writeFile', [name, 'one\r\n', '']);
  assert.equal(fs.readFileSync(path.join(f.repo, name), 'utf8'), 'one\r\n');
  const original = await f.read('previewWorkspaceFile', { path: name });
  await f.write('writeFile', [name, 'two\r\n', original.token]);
  const staleDelete = await f.prepare('mutateWorkspaceFile', [name, original.token, 'delete']);
  await assert.rejects(
    f.client.writeRepository(staleDelete),
    (error) => error.kind === 'conflict' && error.outcome === 'not-started',
  );
  const { task } = await f.client.getTask({ taskId: staleDelete.operationId });
  assert.equal(task.state, 'failed');
  assert.equal(task.outcome, 'not-started');
  assert.equal(fs.readFileSync(path.join(f.repo, name), 'utf8'), 'two\r\n');
  await f.write('stage', [[name]]);
  const preview = await f.read('previewWorkspaceFile', { path: name });
  await f.write('mutateWorkspaceFile', [name, preview.token, 'rename', 'renamed.txt']);
  assert.equal(f.git('show', ':' + name), 'two');
  const deletion = await f.read('previewNewFileDeletion', { path: 'renamed.txt' });
  f.file('renamed.txt', 'outside edit');
  await assert.rejects(f.write('deleteNewFile', ['renamed.txt', deletion.token]));
  await f.write('deleteNewFile', [
    'renamed.txt',
    (await f.read('previewNewFileDeletion', { path: 'renamed.txt' })).token,
  ]);
  assert(!fs.existsSync(path.join(f.repo, 'renamed.txt')));
  f.file('a.txt', 'modified\n');
  f.file('untracked', 'stay');
  const discard = await f.read('previewDiscardChanges');
  await f.write('discardChanges', [discard.token, 'tracked']);
  assert.equal(f.git('show', ':' + name), 'two');
  assert(fs.existsSync(path.join(f.repo, 'untracked')));
  await assert.rejects(f.write('writeFile', ['../escape', 'forbidden', '']));
  assert(!fs.existsSync(path.join(f.root, 'escape')));
  f.file('a.txt', 'part 1\npart 2\n');
  const diff = await f.read('editableDiff', { file: 'a.txt', staged: false });
  await f.write('partialDiff', [
    { file: 'a.txt', action: 'stage', revision: diff.revision, selection: { hunks: [0] } },
  ]);
  assert.equal(f.git('show', ':a.txt'), 'part 1\npart 2');
});

test('Agent drives refs, stash, remote pushes, linked worktree catalog and conflict recovery with real Git', async (t) => {
  const f = await fixture(t),
    base = f.git('rev-parse', 'HEAD');
  const bare = path.join(f.root, 'origin.git');
  f.git('init', '--bare', bare);
  await f.write('addRemote', ['origin', bare]);
  await f.write('push', ['origin', 'main', false, true]);
  assert.equal(f.git('--git-dir=' + bare, 'rev-parse', 'main'), base);
  await f.write('createTag', [{ name: 'fixture', type: 'lightweight' }]);
  await f.write('pushTag', [{ remote: 'origin', name: 'fixture' }]);
  assert.equal(f.git('--git-dir=' + bare, 'rev-parse', 'refs/tags/fixture'), base);
  await f.write('deleteTag', [
    {
      name: 'fixture',
      objectHash: base,
      confirmed: true,
      remote: 'origin',
      remoteObjectHash: base,
    },
  ]);
  await f.write('fetch', ['origin']);
  await f.write('pull', ['origin', 'main']);
  await f.write('createBranch', ['topic', true]);
  f.file('a.txt', 'topic\n');
  f.git('add', '.');
  f.git('commit', '-m', 'topic');
  await f.write('renameBranch', ['topic', 'other']);
  await f.write('switchBranch', ['main']);
  f.file('a.txt', 'main\n');
  f.git('add', '.');
  f.git('commit', '-m', 'main');
  await assert.rejects(f.write('merge', ['other']));
  assert.equal((await f.read('status')).operation.kind, 'merge');
  await f.write('abortOperation');
  assert.equal(f.git('status', '--porcelain'), '');
  await assert.rejects(f.write('cherryPick', [['other']]));
  await f.write('resolveConflictFile', ['a.txt', 'incoming']);
  await f.write('continueOperation');
  assert.equal(f.git('show', 'HEAD:a.txt'), 'topic');
  const after = f.git('rev-parse', 'HEAD');
  await f.write('revert', [after]);
  f.file('loose.txt', 'stash');
  await f.write('stash', ['a stash', true]);
  assert(!fs.existsSync(path.join(f.repo, 'loose.txt')));
  await f.write('stashPop');
  assert.equal(fs.readFileSync(path.join(f.repo, 'loose.txt'), 'utf8'), 'stash');
  await f.write('deleteBranch', ['other', true]);
  const target = path.join(f.root, 'linked tree');
  const linked = await f.write('createWorktree', [target, 'linked']);
  assert.equal(linked.worktreeKind, 'linked');
  fs.writeFileSync(path.join(target, 'dirty'), 'x');
  await assert.rejects(f.write('removeWorktree', [linked.path, true]));
  fs.unlinkSync(path.join(target, 'dirty'));
  const removed = await f.write('removeWorktree', [linked.path, true]);
  assert.deepEqual(removed.removedIds, [linked.id]);
  assert(!fs.existsSync(target));
});

test(
  'shared worktree lock rejects another writer; cancellation targets its operation ID and durable outcome',
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t);
    const linked = await f.write('createWorktree', [path.join(f.root, 'linked'), 'other']);
    const second = await f.prepare('createBranch', ['collision'], linked.resource);
    f.file('a.txt', 'test\n');
    f.git('add', '.');
    const hook = path.join(f.repo, '.git', 'hooks', 'pre-commit');
    // Git for Windows runs Git hooks with its bundled sh, as does POSIX Git.
    fs.writeFileSync(hook, '#!/bin/sh\nprintf ready > hook-ready\nsleep 40\n', { mode: 0o755 });
    const first = await f.prepare('commit', ['blocked']);
    const operation = f.client.writeRepository(first);
    const failure = assert.rejects(operation, (e) => e.outcome === 'unknown');
    for (let n = 0; !fs.existsSync(path.join(f.repo, 'hook-ready')); n++) {
      if (n > 400) throw new Error('hook did not start');
      await delay(50);
    }
    assert.equal((await f.client.repositoryOperation(f.resource)).operationId, first.operationId);
    await rejectsKind(f.client.writeRepository(second), 'busy');
    await rejectsKind(f.client.cancelRepositoryWrite(f.resource, second.operationId), 'conflict');
    await f.client.cancelRepositoryWrite(f.resource, first.operationId);
    await failure;
    assert.equal(f.git('rev-list', '--count', 'HEAD'), '1');
    assert.equal((await f.client.getTask({ taskId: first.operationId })).task.outcome, 'unknown');
    await f.write('createBranch', ['released'], linked.resource);
    assert.equal(f.git('rev-parse', 'released'), f.git('rev-parse', 'HEAD'));
  },
);

test('interactive rebase rechecks its preview; detached checkout, reword, and reset preserve the requested history', async (t) => {
  const f = await fixture(t),
    base = f.git('rev-parse', 'HEAD');
  f.file('b.txt', 'second\n');
  await f.write('stage', [['b.txt']]);
  await f.write('commit', ['second']);
  const before = f.git('rev-parse', 'HEAD');
  const plan = await f.read('previewRebase', { base });
  const request = {
    base,
    token: plan.token,
    entries: [{ hash: before, action: 'reword', message: 'reworded by Agent' }],
    acknowledgePublished: false,
  };
  f.file('b.txt', 'changed');
  await assert.rejects(f.write('startRebase', [request]));
  f.git('restore', 'b.txt');
  await f.write('startRebase', [request]);
  assert.equal(f.git('log', '-1', '--format=%s'), 'reworded by Agent');
  assert.equal((await f.read('rebaseState')).active, false);
  await f.write('createTag', [{ name: 'base', target: base, type: 'lightweight' }]);
  await f.write('checkoutTag', [{ name: 'base', objectHash: base, confirmed: true }]);
  assert.equal(f.git('rev-parse', 'HEAD'), base);
  await f.write('switchBranch', ['main']);
  await f.write('reset', ['hard', base]);
  assert.equal(f.git('rev-parse', 'HEAD'), base);
});

test(
  'disconnect during a real commit hook leaves a queryable unknown receipt and cannot replay',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    f.file('a.txt', 'before disconnect\n');
    f.git('add', 'a.txt');
    const hook = path.join(f.repo, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\nprintf called >> hook-count\nsleep 40\n', { mode: 0o755 });
    const request = await f.prepare('commit', ['disconnected']);
    const lost = assert.rejects(f.client.writeRepository(request), (e) => e.outcome === 'unknown');
    for (let n = 0; !fs.existsSync(path.join(f.repo, 'hook-count')); n++) {
      if (n > 400) throw new Error('hook did not start');
      await delay(50);
    }
    await f.restart();
    await lost;
    assert.equal((await f.client.getTask({ taskId: request.operationId })).task.outcome, 'unknown');
    await rejectsKind(f.client.writeRepository(request), 'duplicate-request');
    assert.equal(fs.readFileSync(path.join(f.repo, 'hook-count'), 'utf8'), 'called');
    assert.equal(f.git('rev-list', '--count', 'HEAD'), '1');
  },
);
