const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { writeFileSync, readFileSync } = require('node:fs');
const { GitTags, GitCommands, LocalConnection } = require('../dist');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');

for (const mode of ['local', 'worktree', 'ssh', 'ssh-worktree']) {
  test(`${mode}: real Git tag create, history, single/all push, checkout and confirmed deletion`, async (t) => {
    const fixture = createRepository();
    let remote;
    t.after(async () => {
      await remote?.close();
      fixture.close();
    });
    fixture.git('branch', '-m', 'main');
    const head = fixture.git('rev-parse', 'HEAD').trim();
    fixture.write('second.txt', 'second');
    fixture.write('tracked.txt', 'second version\n');
    fixture.git('add', '.');
    fixture.git('commit', '-qm', 'second');
    let repo = fixture.repo;
    if (mode.includes('worktree')) {
      repo = join(fixture.root, 'linked 中文 worktree');
      fixture.git('worktree', 'add', '-qb', 'linked', repo);
    }
    if (mode.startsWith('ssh')) remote = await connectFixture(fixture);
    const connection = remote?.connection ?? new LocalConnection();
    const tags = new GitTags(connection);
    const git = new GitCommands(connection);
    const bare = join(fixture.root, 'remote.git');
    execFileSync('git', ['init', '--bare', '-q', bare]);
    fixture.git('remote', 'add', 'origin', bare);
    const light = "版本/v1.0'$()";
    fixture.git('config', 'tag.gpgSign', 'true');
    await tags.create(repo, { name: light, type: 'lightweight', target: head });
    await tags.create(repo, {
      name: 'v2.0',
      type: 'annotated',
      message: '发布说明\n\n中文第二段\n',
    });
    await tags.create(repo, { name: 'v10.0', type: 'lightweight' });
    const list = await tags.list(repo);
    assert.equal(list.find((tag) => tag.name === light).commitHash, head);
    assert.equal(list.find((tag) => tag.name === light).type, 'lightweight');
    assert.equal(list.find((tag) => tag.name === light).message, '');
    const annotated = list.find((tag) => tag.name === 'v2.0');
    assert.equal(annotated.type, 'annotated');
    assert.equal(annotated.message, '发布说明\n\n中文第二段');
    assert.equal(annotated.tagger, 'Deletion test');
    assert.notEqual(annotated.objectHash, annotated.commitHash);
    assert.ok(
      list.findIndex((tag) => tag.name === 'v10.0') < list.findIndex((tag) => tag.name === 'v2.0'),
    );
    assert.ok(
      (await git.log(repo)).commits.some((commit) =>
        commit.references.some((ref) => ref.name === light),
      ),
    );
    await assert.rejects(tags.create(repo, { name: light, type: 'lightweight' }), /同名/);
    for (const name of ['-x', 'bad name', 'a..b', 'x.lock', 'a\0b', null])
      await assert.rejects(tags.create(repo, { name, type: 'lightweight' }), /名称/);
    await assert.rejects(
      tags.create(repo, { name: 'empty-message', type: 'annotated', message: ' ' }),
      /附注/,
    );
    await assert.rejects(
      tags.create(repo, { name: 'bad-target', type: 'lightweight', target: '--help' }),
      /提交/,
    );
    fixture.git('config', 'push.followTags', 'true');
    fixture.git('branch', 'v10.0');
    fixture.git('branch', light);
    await tags.push(repo, { remote: 'origin', name: 'v10.0' });
    assert.deepEqual(
      (await tags.remoteTags(repo, 'origin')).map((tag) => tag.name),
      ['v10.0'],
    );
    assert.equal(fixture.git('ls-remote', '--heads', 'origin').trim(), '');
    await tags.push(repo, { remote: 'origin', all: true });
    assert.equal((await tags.remoteTags(repo, 'origin')).length, 3);
    const selected = (await tags.list(repo)).find((tag) => tag.name === light);
    writeFileSync(join(repo, 'tracked.txt'), 'unsaved work\n');
    await assert.rejects(
      tags.checkout(repo, { ...selected, branch: 'must-not-exist' }),
      /overwritten|changes/,
    );
    assert.equal(readFileSync(join(repo, 'tracked.txt'), 'utf8'), 'unsaved work\n');
    assert.equal(fixture.git('branch', '--list', 'must-not-exist').trim(), '');
    writeFileSync(join(repo, 'tracked.txt'), 'second version\n');
    await assert.rejects(tags.checkout(repo, { ...selected }), /确认/);
    await tags.checkout(repo, { ...selected, confirmed: true });
    assert.equal((await git.status(repo)).branch, '');
    await tags.checkout(repo, { ...selected, branch: 'release/from-tag' });
    assert.equal((await git.status(repo)).branch, 'release/from-tag');
    assert.equal(fixture.git('rev-parse', 'release/from-tag').trim(), head);
    await assert.rejects(tags.delete(repo, { ...selected, confirmed: false }), /确认/);
    await tags.delete(repo, {
      ...selected,
      confirmed: true,
      remote: 'origin',
      remoteObjectHash: selected.objectHash,
    });
    assert.equal(
      (await tags.list(fixture.repo)).some((tag) => tag.name === light),
      false,
    );
    assert.equal(
      (await tags.remoteTags(repo, 'origin')).some((tag) => tag.name === light),
      false,
    );
    assert.ok(fixture.git('show-ref', '--verify', `refs/heads/${light}`).trim());
    await tags.delete(repo, { ...annotated, confirmed: true });
    assert.equal(
      (await tags.remoteTags(repo, 'origin')).some((tag) => tag.name === 'v2.0'),
      true,
    );
    assert.equal(
      fixture.git('show-ref', '--verify', 'refs/heads/v10.0').trim().endsWith('refs/heads/v10.0'),
      true,
    );
  });
}

test('changed references, different push URLs, rejection and offline reads preserve local tags', async (t) => {
  const fixture = createRepository();
  t.after(() => fixture.close());
  const tags = new GitTags(new LocalConnection());
  const repo = fixture.repo;
  const fetchRemote = join(fixture.root, 'fetch.git');
  const pushRemote = join(fixture.root, 'push.git');
  for (const dir of [fetchRemote, pushRemote]) execFileSync('git', ['init', '--bare', '-q', dir]);
  fixture.git('remote', 'add', 'origin', fetchRemote);
  fixture.git('remote', 'set-url', '--push', 'origin', pushRemote);
  await tags.create(repo, { name: 'v1', type: 'lightweight' });
  const old = (await tags.list(repo))[0];
  await tags.push(repo, { remote: 'origin', name: 'v1' });
  assert.equal((await tags.remoteTags(repo, 'origin')).length, 1);
  assert.equal(fixture.git('ls-remote', '--tags', fetchRemote).trim(), '');
  fixture.write('tracked.txt', 'moved');
  fixture.git('add', '.');
  fixture.git('commit', '-qm', 'moved');
  fixture.git('tag', '-f', 'v1');
  await assert.rejects(tags.delete(repo, { ...old, confirmed: true }), /已变化/);
  await assert.rejects(tags.checkout(repo, { ...old, confirmed: true }), /已变化/);
  await assert.rejects(tags.push(repo, { remote: 'origin', name: 'v1' }), /rejected|exists/);
  const current = (await tags.list(repo))[0];
  fixture.git('push', '--force', pushRemote, 'refs/tags/v1:refs/tags/v1');
  await assert.rejects(
    tags.delete(repo, {
      ...current,
      confirmed: true,
      remote: 'origin',
      remoteObjectHash: old.objectHash,
    }),
    /rejected|stale/,
  );
  assert.equal((await tags.list(repo)).length, 1);
  fixture.git('remote', 'set-url', '--push', 'origin', join(fixture.root, 'missing.git'));
  await assert.rejects(tags.remoteTags(repo, 'origin'));
  await assert.rejects(
    tags.delete(repo, {
      ...current,
      confirmed: true,
      remote: 'origin',
      remoteObjectHash: current.objectHash,
    }),
  );
  assert.equal((await tags.list(repo)).length, 1);
  await assert.rejects(tags.push(repo, { remote: '--all', all: true }), /远程/);
  await assert.rejects(tags.push(repo, { remote: pushRemote, all: true }), /远程/);
  await assert.rejects(tags.push(repo, { remote: 'origin', name: 'v1', all: true }), /单个/);
});

test('unborn repositories stay empty; non-commit tags stay visible and cannot be checked out', async (t) => {
  const fixture = createRepository({ initial: false });
  t.after(() => fixture.close());
  const tags = new GitTags(new LocalConnection());
  assert.deepEqual(await tags.list(fixture.repo), []);
  await assert.rejects(tags.create(fixture.repo, { name: 'v1', type: 'lightweight' }));
  fixture.write('blob.txt', 'blob');
  const blob = fixture.git('hash-object', '-w', 'blob.txt').trim();
  fixture.git('tag', 'blob-tag', blob);
  const tag = (await tags.list(fixture.repo))[0];
  assert.equal(tag.objectType, 'blob');
  assert.equal(tag.commitHash, undefined);
  await assert.rejects(tags.checkout(fixture.repo, { ...tag, confirmed: true }));
});
