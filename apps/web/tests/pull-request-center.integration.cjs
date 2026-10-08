const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startPullRequestsFixture } = require('./pull-requests-fixture.cjs');
const { RepositoryService } = require('../../server/dist/repository/repository.service');

const query = { view: 'all', state: 'open', provider: '', search: '', projects: [], account: '' };
test('center HTTP flow covers local/SSH deduplication, all remotes, identities, deep pagination and stale actor rejection', async () => {
  const fixture = await startPullRequestsFixture();
  try {
    const base = `${fixture.url}/api`;
    const request = async (path, body, expected = 200, method = 'POST') => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, expected, await response.clone().text());
      return response.json();
    };
    const collect = async (filters) => {
      let discovery = await request('/pull-request-center/sources', {});
      while (discovery.cursor)
        discovery = await request('/pull-request-center/sources', { cursor: discovery.cursor });
      let page = await request('/pull-request-center/list', {
        discoveryId: discovery.discoveryId,
        query: filters,
      });
      const items = [...page.items];
      while (page.nextCursor) {
        page = await request('/pull-request-center/list', { cursor: page.nextCursor });
        items.push(...page.items);
      }
      return { discovery, page, items };
    };
    const clone = await fixture.app.get(RepositoryService).addLocal(fixture.fixture.repo);
    let initial = await collect(query);
    assert.equal(initial.discovery.repositoryCount, 3);
    assert.equal(initial.items.length, 3);
    assert.equal(initial.items[0].sourceIds.length, 2);
    assert.ok(initial.page.sources.some((s) => s.status === 'configuration'));
    assert.ok(initial.page.sources.some((s) => s.status === 'error'));
    assert.ok(initial.page.sources.some((s) => s.status === 'unsupported'));

    let settings = await request('/access-tokens', null, 200, 'GET');
    for (const [name, remote, provider, target] of [
      ['GitHub fixture', 'origin', 'github', 'https://github.com/fixture/alune'],
      ['GitLab fixture', 'gitlab', 'gitlab', 'https://gitlab.com/team/alune'],
      ['Self hosted fixture', 'upstream', 'gitlab', 'https://gitlab.example.com/team/sub/alune'],
    ]) {
      settings = await request(
        '/access-tokens',
        { name, value: 'isolated-test-token', revision: settings.revision },
        201,
      );
      const tokenId = settings.tokens.find((t) => t.name === name).id;
      for (const repositoryId of [fixture.main.id, clone.id])
        settings = await request(`/repositories/${repositoryId}/pull-requests/token`, {
          remote,
          provider,
          target,
          tokenId,
          revision: settings.revision,
        });
    }
    const reviews = await collect({ ...query, view: 'review' });
    assert.equal(reviews.items.length, 3);
    assert.ok(reviews.items.every((i) => i.number === 76));
    assert.equal(new Set(reviews.items.map((i) => i.projectKey)).size, 3);
    assert.ok(
      reviews.page.sources
        .filter((s) => s.status === 'success')
        .every((s) => s.account.username === 'alune-contributor'),
    );
    const created = await collect({ ...query, view: 'created', search: '分页' });
    assert.equal(created.items.length, 3);
    const closed = await collect({ ...query, state: 'closed' });
    assert.ok(closed.items.every((i) => i.number === 81));

    const source = reviews.page.sources.find(
      (s) => s.repositoryId === fixture.main.id && s.remote?.name === 'origin',
    );
    const detailQuery = {
      remote: 'origin',
      target: source.remote.webUrl,
      provider: 'github',
      number: 76,
      selectionVersion: source.remote.selection.version,
    };
    const detail = await request(
      `/repositories/${fixture.main.id}/pull-requests/detail`,
      detailQuery,
    );
    assert.equal(detail.number, 76);
    const tokenId = source.remote.selection.tokenId;
    settings = await request(
      `/access-tokens/${tokenId}`,
      { name: 'GitHub changed', value: 'isolated-replacement', revision: settings.revision },
      200,
      'PUT',
    );
    const denied = await request(
      `/repositories/${fixture.main.id}/pull-requests/detail`,
      detailQuery,
      409,
    );
    assert.match(denied.message, /关联账号已变化/);
    assert.doesNotMatch(JSON.stringify(reviews), /isolated-test-token|ciphertext/);
    assert.equal(fixture.fixture.git('status', '--porcelain'), '');
  } finally {
    await fixture.close();
  }
});
