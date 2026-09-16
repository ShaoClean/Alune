const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { GitCommands, GitLogChangedError, GitLogOptionsError } = require('../dist');
const { createRepository } = require('./helpers/local-repository.cjs');
const { createHistoryRepository } = require('./helpers/history-repository.cjs');

const readAll = async (git, repo, count = 50) => {
  const commits = [];
  let page;
  do {
    page = await git.log(repo, {
      count,
      ...(page ? { skip: page.nextSkip, revision: page.revision } : {}),
    });
    commits.push(...page.commits);
  } while (page.hasMore);
  return commits;
};

test('all references, parents and exact pagination agree with real Git over more than 150 commits', async (t) => {
  const fixture = createHistoryRepository();
  t.after(fixture.close);
  const git = new GitCommands(fixture.connection);
  const commits = await readAll(git, fixture.repo);
  const expected = fixture
    .git('log', '--all', 'HEAD', '--topo-order', '--format=%H %P')
    .trim()
    .split('\n');
  assert.deepEqual(
    commits.map((item) => [item.hash, ...item.parents].join(' ')),
    expected.map((line) => line.trim()),
  );
  assert.equal(new Set(commits.map((item) => item.hash)).size, commits.length);
  for (const hash of [
    fixture.local,
    fixture.remote,
    fixture.tagOnly,
    fixture.feature,
    fixture.merge,
  ])
    assert.ok(commits.some((commit) => commit.hash === hash));
  const merge = commits.find((item) => item.hash === fixture.merge);
  assert.equal(merge.parents.length, 2);
  assert.ok(merge.references.some((ref) => ref.kind === 'tag' && ref.name === 'v1.0,preview'));
  assert.ok(merge.references.some((ref) => ref.kind === 'local' && ref.current));
  assert.ok(merge.references.some((ref) => ref.kind === 'remote' && ref.name === 'upstream/main'));
  assert.ok(!merge.references.some((ref) => ref.fullName === 'refs/remotes/upstream/HEAD'));
  assert.equal((await git.commitFiles(fixture.repo, fixture.merge))[0].path, 'graph.ts');
  assert.match(
    await git.diff(fixture.repo, { commit: fixture.merge, file: 'graph.ts' }),
    /graph = true/,
  );
});

for (const total of [49, 50, 51])
  test('end detection with exactly ' + total + ' commits', async (t) => {
    const fixture = createRepository();
    t.after(fixture.close);
    for (let i = 1; i < total; i++) fixture.git('commit', '--allow-empty', '-qm', 'commit ' + i);
    const git = new GitCommands(fixture.connection);
    const first = await git.log(fixture.repo);
    assert.equal(first.commits.length, Math.min(total, 50));
    assert.equal(first.hasMore, total > 50);
    assert.equal((await readAll(git, fixture.repo)).length, total);
  });

test('empty repositories and detached HEAD history are readable', async (t) => {
  const fixture = createRepository({ initial: false });
  t.after(fixture.close);
  const git = new GitCommands(fixture.connection);
  const empty = await git.log(fixture.repo);
  assert.deepEqual(empty.commits, []);
  assert.equal(empty.hasMore, false);
  fixture.git('commit', '--allow-empty', '-qm', 'root');
  fixture.git('checkout', '--detach', '-q');
  fixture.git('commit', '--allow-empty', '-qm', 'detached');
  const page = await git.log(fixture.repo);
  assert.equal(page.commits.length, 2);
  assert.equal(page.commits[0].references[0].kind, 'head');
  assert.deepEqual(page.commits[1].parents, []);
});

test('a moved reference or a reference changed during reading never mixes history pages', async (t) => {
  const fixture = createHistoryRepository(12);
  t.after(fixture.close);
  const git = new GitCommands(fixture.connection);
  const first = await git.log(fixture.repo, { count: 2 });
  fixture.git('commit', '--allow-empty', '-qm', 'new commit');
  await assert.rejects(
    git.log(fixture.repo, { count: 2, skip: first.nextSkip, revision: first.revision }),
    GitLogChangedError,
  );
  const original = fixture.connection.execCommand;
  fixture.connection.execCommand = async (command, ...args) => {
    const result = await original(command, ...args);
    if (command.includes("'log'")) fixture.git('tag', 'changed-during-query');
    return result;
  };
  await assert.rejects(git.log(fixture.repo), GitLogChangedError);
});

test('query values cannot become shell or Git options; malformed pages are rejected', async (t) => {
  const fixture = createRepository();
  t.after(fixture.close);
  const git = new GitCommands(fixture.connection);
  for (const options of [
    { count: -1 },
    { count: 0 },
    { count: 201 },
    { skip: 1 },
    { skip: -1 },
    { author: ['bad'] },
  ])
    await assert.rejects(git.log(fixture.repo, options), GitLogOptionsError);
  const page = await git.log(fixture.repo, {
    search: '$(touch SHOULD_NOT_EXIST)',
    file: 'a;touch SHOULD_NOT_EXIST',
  });
  assert.deepEqual(page.commits, []);
  assert.equal(require('node:fs').existsSync(path.join(fixture.repo, 'SHOULD_NOT_EXIST')), false);
});

test('deepening a shallow clone invalidates the revision even with unchanged tips', async (t) => {
  const fixture = createHistoryRepository(12);
  t.after(fixture.close);
  const clone = path.join(fixture.root, 'shallow');
  execFileSync('git', ['clone', '-q', '--depth=2', 'file://' + fixture.repo, clone]);
  const git = new GitCommands(fixture.connection);
  const first = await git.log(clone, { count: 1 });
  assert.equal(first.shallow, true);
  const all = await readAll(git, clone);
  assert.ok(all.some((commit) => commit.parents.length === 0));
  execFileSync('git', ['-C', clone, 'fetch', '-q', '--deepen=3']);
  await assert.rejects(
    git.log(clone, { count: 1, skip: 1, revision: first.revision }),
    GitLogChangedError,
  );
});

test('octopus parents and nested annotated tags retain exact identities', async (t) => {
  const fixture = createHistoryRepository(12);
  t.after(fixture.close);
  const parents = [fixture.merge, fixture.local, fixture.remote];
  const octopus = fixture.commit('octopus', parents);
  fixture.git('update-ref', 'refs/heads/octopus', octopus);
  fixture.git(
    '-c',
    'advice.nestedTag=false',
    'tag',
    '-a',
    'nested',
    '-m',
    'nested',
    'v1.0,preview',
  );
  const page = await new GitCommands(fixture.connection).log(fixture.repo);
  assert.deepEqual(page.commits.find((commit) => commit.hash === octopus).parents, parents);
  assert.ok(
    page.commits
      .find((commit) => commit.hash === fixture.merge)
      .references.some((ref) => ref.name === 'nested'),
  );
});

test(
  'real SSH preserves Unicode, NUL-delimited parents and page boundaries',
  { timeout: 60000 },
  async (t) => {
    const fixture = createHistoryRepository(51);
    t.after(fixture.close);
    const { connectFixture } = require('./helpers/ssh-server.cjs');
    const ssh = await connectFixture(fixture);
    t.after(ssh.close);
    const commits = await readAll(new GitCommands(ssh.connection), fixture.repo);
    const expected = fixture
      .git('log', '--all', 'HEAD', '--topo-order', '--format=%H')
      .trim()
      .split('\n');
    assert.deepEqual(
      commits.map((commit) => commit.hash),
      expected,
    );
    assert.equal(
      commits.find((commit) => commit.hash === fixture.merge).message,
      'merge: 合并提交图功能',
    );
    assert.deepEqual(commits.find((commit) => commit.hash === fixture.merge).parents, [
      fixture.chain.at(-1),
      fixture.feature,
    ]);
  },
);
