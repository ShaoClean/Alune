const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { GitCommands, GitLogOptionsError } = require('../dist');
const { createRepository } = require('./helpers/local-repository.cjs');

const DAY = 86400;
const START = 1767225600; // 2026-01-01T00:00:00Z

// Several authors, dated commits, two branches, a merge and a file renamed twice.
function createFilterRepository() {
  const fixture = createRepository();
  const { repo, write } = fixture;
  const commit = (message, author, day, files = {}) => {
    for (const [name, contents] of Object.entries(files)) write(name, contents);
    const date = '@' + (START + day * DAY) + ' +0000';
    execFileSync('git', ['-C', repo, 'add', '-A'], { env: { ...process.env, LC_ALL: 'C' } });
    execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', message], {
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: author,
        GIT_AUTHOR_EMAIL: author.toLowerCase() + '@example.invalid',
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: author,
        GIT_COMMITTER_EMAIL: author.toLowerCase() + '@example.invalid',
        GIT_COMMITTER_DATE: date,
      },
    });
    return fixture.git('rev-parse', 'HEAD').trim();
  };
  fixture.git('branch', '-M', 'main');
  commit('feat: 新增解析器', 'Alice', 1, { 'src/parser.ts': 'v1\n' });
  commit('fix: 修复 Parser 空行', 'Bob', 2, { 'src/parser.ts': 'v2\n' });
  commit('docs: README', 'Carol', 3, { 'README.md': 'docs\n' });
  fixture.git('mv', 'src/parser.ts', 'src/reader.ts');
  const renamed = commit('refactor: 重命名解析器', 'Alice', 4, {});
  fixture.git('checkout', '-qb', 'feature');
  const feature = commit('feat: 侧分支改动 parser', 'Bob', 5, { 'lib/side.ts': 'side\n' });
  fixture.git('checkout', '-q', 'main');
  commit('fix: reader 边界', 'Carol', 6, { 'src/reader.ts': 'v3\n' });
  fixture.git('mv', 'src/reader.ts', 'src/scanner.ts');
  commit('refactor: 再次重命名', 'Bob', 7, {});
  fixture.git('merge', '--no-ff', '-qm', 'merge: 合并侧分支', 'feature');
  return { ...fixture, renamed, feature };
}

const readAll = async (git, repo, options, count = 2) => {
  const commits = [];
  let page;
  do {
    page = await git.log(repo, {
      ...options,
      count,
      ...(page ? { skip: page.nextSkip, revision: page.revision } : {}),
    });
    commits.push(...page.commits);
  } while (page.hasMore);
  return commits;
};
const cli = (fixture, ...args) =>
  fixture
    .git('log', '--topo-order', '--format=%H', ...args)
    .split('\n')
    .filter(Boolean);

test('message, author, date, branch and path filters combine like git log, across pages', async (t) => {
  const fixture = createFilterRepository();
  t.after(fixture.close);
  const git = new GitCommands(fixture.connection);
  const all = ['--all', 'HEAD'];
  const cases = [
    [{ search: 'PARSER' }, ['-i', '-F', '--grep=PARSER', ...all]],
    [{ author: 'bob' }, ['-i', '-F', '--author=bob', ...all]],
    [{ search: '修复', author: 'Bob' }, ['-i', '-F', '--author=Bob', '--grep=修复', ...all]],
    [
      { since: START + 2 * DAY, until: START + 6 * DAY },
      ['--since=@' + (START + 2 * DAY), '--until=@' + (START + 6 * DAY), ...all],
    ],
    [{ branch: 'HEAD', author: 'Bob' }, ['-i', '-F', '--author=Bob', 'HEAD']],
    [{ branch: 'main', file: 'src' }, ['main', '--', 'src']],
    [
      { file: 'lib/side.ts', author: 'alice' },
      ['-i', '-F', '--author=alice', ...all, '--', 'lib/side.ts'],
    ],
    [{ search: '不存在的提交' }, ['-i', '-F', '--grep=不存在的提交', ...all]],
  ];
  for (const [options, args] of cases) {
    const commits = await readAll(git, fixture.repo, options);
    assert.deepEqual(
      commits.map((commit) => commit.hash),
      cli(fixture, ...args),
      JSON.stringify(options),
    );
  }
});

test('a path filter rewrites parents so the remaining commits stay connected', async (t) => {
  const fixture = createFilterRepository();
  t.after(fixture.close);
  const git = new GitCommands(fixture.connection);
  const commits = await readAll(git, fixture.repo, { file: 'README.md' });
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].parents, []);
  const src = await readAll(git, fixture.repo, { file: 'src' });
  const hashes = new Set(src.map((commit) => commit.hash));
  for (const commit of src) for (const parent of commit.parents) assert.ok(hashes.has(parent));
});

test('file history follows renames and reports the path in each commit', async (t) => {
  const fixture = createFilterRepository();
  t.after(fixture.close);
  const git = new GitCommands(fixture.connection);
  const commits = await readAll(git, fixture.repo, { file: 'src/scanner.ts', follow: true });
  assert.deepEqual(
    commits.map((commit) => commit.hash),
    cli(fixture, '--follow', '--all', 'HEAD', '--', 'src/scanner.ts'),
  );
  assert.deepEqual(
    commits.map((commit) => [commit.message, commit.oldPath, commit.path]),
    [
      ['refactor: 再次重命名', 'src/reader.ts', 'src/scanner.ts'],
      ['fix: reader 边界', undefined, 'src/reader.ts'],
      ['refactor: 重命名解析器', 'src/parser.ts', 'src/reader.ts'],
      ['fix: 修复 Parser 空行', undefined, 'src/parser.ts'],
      ['feat: 新增解析器', undefined, 'src/parser.ts'],
    ],
  );
  const filtered = await readAll(git, fixture.repo, {
    file: 'src/scanner.ts',
    follow: 'true',
    author: 'alice',
  });
  assert.deepEqual(
    filtered.map((commit) => commit.path),
    ['src/reader.ts', 'src/parser.ts'],
  );
  // Git alone stops following at a rename it filters out; these reach past two.
  const follow = (options) =>
    readAll(git, fixture.repo, { file: 'src/scanner.ts', follow: true, ...options });
  assert.deepEqual(
    (await follow({ search: 'PARSER' })).map((commit) => commit.message),
    ['fix: 修复 Parser 空行'],
  );
  assert.deepEqual(
    (await follow({ since: START + 2 * DAY, until: START + 4 * DAY })).map((c) => c.path),
    ['src/reader.ts', 'src/parser.ts'],
  );
  const first = commits.at(-1);
  assert.deepEqual(
    (await follow({ search: first.hash.slice(0, 6) })).map((commit) => commit.hash),
    [first.hash],
  );
  assert.equal('body' in first || 'committed' in first, false);
});

test('a hash prefix leads the results once and still honours the other filters', async (t) => {
  const fixture = createFilterRepository();
  t.after(fixture.close);
  const git = new GitCommands(fixture.connection);
  const prefix = fixture.renamed.slice(0, 7);
  const found = await readAll(git, fixture.repo, { search: prefix.toUpperCase() }, 1);
  assert.equal(found[0].hash, fixture.renamed);
  assert.equal(found.filter((commit) => commit.hash === fixture.renamed).length, 1);
  assert.deepEqual(
    (await readAll(git, fixture.repo, { search: prefix, author: 'bob' })).map((c) => c.hash),
    [],
  );
  // The side branch commit is not reachable from main.
  assert.deepEqual(
    await readAll(git, fixture.repo, { search: fixture.feature.slice(0, 8), branch: 'main~1' }),
    [],
  );
  assert.equal(
    (await readAll(git, fixture.repo, { search: fixture.feature.slice(0, 8), branch: 'HEAD' }))[0]
      .hash,
    fixture.feature,
  );
  // Text that only looks like a hash still searches messages.
  assert.deepEqual(await readAll(git, fixture.repo, { search: 'beef' }), []);
});

test('malformed filters are rejected before Git runs', async (t) => {
  const fixture = createRepository();
  t.after(fixture.close);
  const git = new GitCommands(fixture.connection);
  for (const options of [
    { since: 0 },
    { since: 'yesterday' },
    { until: -1 },
    { since: START + DAY, until: START },
    { follow: 'yes' },
    { follow: true },
    { search: 'a\0b' },
  ])
    await assert.rejects(
      git.log(fixture.repo, options),
      GitLogOptionsError,
      JSON.stringify(options),
    );
});
