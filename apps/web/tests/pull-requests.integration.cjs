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

test('named token HTTP lifecycle binds actual SSH destinations and never returns a secret', async () => {
  const fixture = await startPullRequestsFixture();
  try {
    const base = `${fixture.url}/api`;
    const api = `${base}/repositories/${fixture.main.id}/pull-requests`;
    const json = async (path, method = 'GET', body) => {
      const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const data = await response.json();
      assert.doesNotMatch(JSON.stringify(data), /fixture-persisted-secret|fixture-replacement|ciphertext|aes-gcm/);
      return { status: response.status, data };
    };
    let settings = (await json(`${base}/access-tokens`)).data;
    const saved = await json(`${base}/access-tokens`, 'POST', { name: 'Company GitLab', value: 'fixture-persisted-secret', revision: settings.revision });
    assert.equal(saved.status, 201);
    settings = saved.data;
    const token = settings.tokens[0];
    const query = { remote: 'upstream', target: 'https://gitlab.example.com/team/sub/alune', provider: 'gitlab', state: 'open', page: 1 };
    assert.equal((await json(`${api}/list`, 'POST', query)).status, 401);
    const applied = await json(`${api}/token`, 'POST', { ...query, tokenId: token.id, revision: settings.revision });
    assert.equal(applied.status, 200);
    settings = applied.data;
    assert.equal(settings.tokens[0].associations[0].repositoryId, fixture.main.id);
    assert.deepEqual(settings.tokens[0].scope, { provider: 'gitlab', origin: 'https://gitlab.example.com' });
    assert.equal((await json(`${api}/list`, 'POST', query)).status, 200);
    assert.equal(fixture.control.calls.at(-1).authenticated, true);
    let remotes = (await json(`${api}/remotes`)).data;
    assert.equal(remotes.find(r => r.name === 'upstream').selection.tokenId, token.id);
    assert.equal(remotes.find(r => r.name === 'origin').selection.status, 'none');
    const renamed = await json(`${base}/access-tokens/${token.id}`, 'PUT', { name: 'Renamed', value: 'fixture-replacement', revision: settings.revision });
    assert.equal(renamed.status, 200);
    settings = renamed.data;
    assert.equal(settings.tokens[0].id, token.id);
    const incompatible = await json(`${api}/token`, 'POST', { remote: 'origin', target: 'https://github.com/fixture/alune', provider: 'github', tokenId: token.id, revision: settings.revision });
    assert.equal(incompatible.status, 409);
    const deleted = await json(`${base}/access-tokens/${token.id}`, 'DELETE', { revision: settings.revision });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.data.tokens, []);
    remotes = (await json(`${api}/remotes`)).data;
    assert.equal(remotes.find(r => r.name === 'upstream').selection.status, 'token-deleted');
    const calls = fixture.control.calls.length;
    assert.equal((await json(`${api}/list`, 'POST', query)).status, 409);
    assert.equal(fixture.control.calls.length, calls);
    assert.equal((await json(`${api}/token`, 'POST', { ...query, tokenId: null, revision: deleted.data.revision })).status, 200);
    assert.equal((await json(`${api}/list`, 'POST', query)).status, 401);
  } finally { await fixture.close(); }
});
