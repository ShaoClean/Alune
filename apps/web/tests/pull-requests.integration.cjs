const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startPullRequestsFixture } = require('./pull-requests-fixture.cjs');

test('PR/MR API discovers actual Git remotes over SSH, enforces the destination and preserves the worktree', async () => {
  const fixture = await startPullRequestsFixture();
  try {
    const api = `${fixture.url}/api/repositories/${fixture.main.id}/pull-requests`;
    const post = (body) =>
      fetch(`${api}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const query = {
      remote: 'origin',
      target: 'https://github.com/fixture/alune',
      provider: 'github',
      state: 'open',
      page: 1,
    };
    const before = fixture.fixture.git('status', '--porcelain');
    const remotes = await fetch(`${api}/remotes`);
    assert.equal(remotes.status, 200);
    assert.equal(remotes.headers.get('cache-control'), 'no-store');
    const choices = await remotes.json();
    assert.equal(choices.find((item) => item.name === 'upstream').host, 'gitlab.example.com');
    assert.ok(choices.find((item) => item.name === 'unsupported').unavailableReason);
    const response = await post(query);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).items[0].number, 98);
    const all = await (await post({ ...query, state: 'all' })).json();
    assert.deepEqual(
      all.items.map((item) => item.state),
      ['open', 'open', 'merged', 'closed'],
    );
    const next = await (await post({ ...query, page: 2 })).json();
    assert.equal(next.items[0].number, 76);
    assert.equal(next.hasMore, false);
    const privateQuery = {
      ...query,
      remote: 'upstream',
      target: 'https://gitlab.example.com/team/sub/alune',
      provider: 'gitlab',
    };
    assert.equal((await post(privateQuery)).status, 401);
    assert.equal((await post({ ...privateQuery, token: 'fixture-only-token' })).status, 200);
    assert.equal((await post(privateQuery)).status, 401);
    assert.equal((await post({ ...query, page: '2' })).status, 400);
    assert.equal(
      (await fetch(`${fixture.url}/api/repositories/invalid/pull-requests/remotes`)).status,
      400,
    );
    const calls = fixture.control.calls.length;
    fixture.fixture.git('remote', 'set-url', 'origin', 'https://github.com/different/repo.git');
    assert.equal((await post({ ...query, token: 'do-not-forward' })).status, 409);
    assert.equal(fixture.control.calls.length, calls);
    const empty = await fetch(
      `${fixture.url}/api/repositories/${fixture.emptyRepo.id}/pull-requests/remotes`,
    );
    assert.deepEqual(await empty.json(), []);
    assert.equal(fixture.fixture.git('status', '--porcelain'), before);
  } finally {
    await fixture.close();
  }
});
