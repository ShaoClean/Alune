const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHistoryFilterFixture } = require('./history-filter-fixture.cjs');

test('production HTTP filters and follows file history identically for local, SSH and Worktree', async () => {
  const fixture = await createHistoryFilterFixture();
  const get = async (id, params) => {
    const response = await fetch(
      `${fixture.url}/api/repositories/${id}/log?${new URLSearchParams(params)}`,
    );
    return { status: response.status, body: await response.json() };
  };
  const readAll = async (id, params) => {
    const commits = [];
    let page;
    do {
      const result = await get(id, {
        count: '20',
        ...params,
        ...(page ? { skip: String(page.nextSkip), revision: page.revision } : {}),
      });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      page = result.body;
      commits.push(...page.commits);
    } while (page.hasMore);
    return commits.map((commit) => commit.hash);
  };
  const cli = (...args) =>
    fixture
      .git('log', '--topo-order', '--format=%H', ...args)
      .split('\n')
      .filter(Boolean);
  const all = ['--all', 'HEAD'];
  try {
    const since = fixture.start + 2 * fixture.day;
    const until = fixture.start + 30 * fixture.day;
    const cases = [
      [{ search: 'parser' }, ['-i', '-F', '--grep=parser', ...all]],
      [{ author: 'alice' }, ['-i', '-F', '--author=alice', ...all]],
      [
        { since: String(since), until: String(until) },
        ['--since=@' + since, '--until=@' + until, ...all],
      ],
      [
        { author: 'bob', search: 'fix', branch: 'HEAD' },
        ['-i', '-F', '--author=bob', '--grep=fix', 'HEAD'],
      ],
      [{ file: 'docs' }, [...all, '--', 'docs']],
    ];
    for (const repo of [fixture.local, fixture.ssh, fixture.worktree]) {
      for (const [params, args] of cases)
        assert.deepEqual(await readAll(repo.id, params), cli(...args), JSON.stringify(params));
      const followed = await get(repo.id, { file: fixture.file, follow: 'true', count: '50' });
      assert.deepEqual(
        followed.body.commits.map((commit) => [commit.oldPath, commit.path]),
        [
          ['src/reader.ts', 'src/scanner.ts'],
          [undefined, 'src/reader.ts'],
          ['src/parser.ts', 'src/reader.ts'],
          [undefined, 'src/parser.ts'],
          [undefined, 'src/parser.ts'],
        ],
      );
      const hash = await get(repo.id, { search: fixture.renamed.slice(0, 8) });
      assert.equal(hash.body.commits[0].hash, fixture.renamed);
      const invalid = await get(repo.id, { since: String(until), until: String(since) });
      assert.equal(invalid.status, 400);
      const empty = await get(repo.id, { search: '不存在的提交信息' });
      assert.deepEqual([empty.body.commits, empty.body.hasMore], [[], false]);
    }
  } finally {
    await fixture.close();
  }
});
