import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPullRequestActivityPoller } from '../src/hooks/pullRequestActivity.ts';

const date = (ms) => new Date(ms).toISOString();
const baseline = Date.parse('2026-11-24T00:00:00Z');

function fixture(provider = 'github') {
  const log = [];
  const notices = [];
  const host = provider === 'github' ? 'github.com' : 'gitlab.com';
  const target = `https://${host}/team/app`;
  const association = { repositoryId: 'repo', remote: 'origin', target };
  const token = { id: 'token', version: 'one', scope: { provider }, associations: [association] };
  const state = {
    tokens: [token],
    items: [{ number: 8, title: 'Example PR', state: 'open', updatedAt: date(baseline - 60000) }],
    notes: [{ id: 'old', createdAt: date(baseline - 60000) }],
    reviews: [{ id: 'review', state: 'APPROVED', createdAt: date(baseline - 60000) }],
    approvalState: 'approved',
    scopes: [],
  };
  const client = {
    async listAccessTokens() {
      return { tokens: state.tokens };
    },
    async collaboration(method, { resource, input }) {
      log.push([method, resource.resourceId, input?.kind, input?.page, input?.number]);
      if (method === 'reviews.remotes') {
        if (resource.resourceId === 'offline') throw new Error('Disconnected');
        return [
          {
            name: 'origin',
            webUrl: target,
            selection: {
              status: 'applied',
              tokenId: token.id,
              provider,
              version: `binding:${token.version}`,
            },
          },
        ];
      }
      assert.equal(input.selectionVersion, `binding:${token.version}`);
      if (method === 'reviews.list') return { items: state.items, hasMore: false };
      const entries =
        input.number !== 8
          ? []
          : input.kind === 'reviews'
            ? state.reviews
            : input.kind === 'comments'
              ? state.notes
              : [];
      return { entries, hasMore: false, approvalState: state.approvalState };
    },
  };
  const poll = createPullRequestActivityPoller();
  const check = (exclude = [], signal = new AbortController().signal) =>
    poll(
      client,
      'agent',
      new Set(exclude),
      signal,
      (notice) => notices.push(notice),
      (scopes) => {
        state.scopes = [...scopes];
      },
    );
  return { state, token, log, notices, check, client, association };
}

test('historical activity creates a baseline and new comments, reviews and merges appear once', async (t) => {
  let now = baseline;
  t.mock.method(Date, 'now', () => now);
  const { state, log, notices, check, association, token } = fixture();
  token.associations.push({ ...association, repositoryId: 'duplicate' });
  await check();
  assert.equal(notices.length, 0);
  assert.ok(log.every(([, repository]) => repository === 'repo'));

  now += 10_000;
  const recent = date(now - 1000);
  state.notes.push({ id: 'new', createdAt: recent });
  state.reviews[0].state = 'DISMISSED';
  state.items[0] = { ...state.items[0], state: 'merged', updatedAt: recent, mergedAt: recent };
  await check();
  assert.deepEqual(
    notices.map(({ title }) => title).sort(),
    ['PR #8 已合并', 'PR #8 审阅状态有变化', 'PR #8 有 1 条新评论'].sort(),
  );
  assert.ok(notices.every(({ path }) => path.startsWith('/pull-requests/repo/8?')));
  assert.equal(new Set(notices.map(({ id }) => id)).size, 3);
  await check();
  assert.equal(notices.length, 3);
});

test('GitLab approval changes are detected even if the merge request timestamp stays fixed', async (t) => {
  let now = baseline;
  t.mock.method(Date, 'now', () => now);
  const { state, log, notices, token, check } = fixture('gitlab');
  await check();
  assert.deepEqual(
    log.filter(([method]) => method === 'reviews.activity').map(([, , kind]) => kind),
    ['comments', 'approvals'],
  );
  assert.equal(notices.length, 0);
  now += 5000;
  state.approvalState = 'revoked';
  await check();
  assert.deepEqual(
    notices.map(({ title }) => title),
    ['MR !8 审阅状态有变化'],
  );
  const firstScope = state.scopes[0];
  token.version = 'new-credential';
  state.approvalState = 'approved';
  await check();
  assert.equal(notices.length, 1);
  assert.ok(!state.scopes.includes(firstScope));
  state.tokens = [];
  await check();
  assert.deepEqual(state.scopes, []);
});

test('revisiting an evicted request does not replay its merge or comments', async (t) => {
  let now = baseline;
  t.mock.method(Date, 'now', () => now);
  const { state, log, notices, check } = fixture();
  await check();
  now += 5_000;
  const recent = date(now - 1_000);
  const merged = { ...state.items[0], state: 'merged', updatedAt: recent, mergedAt: recent };
  const note = { id: 'new', createdAt: recent };
  state.items = [merged];
  state.notes = [note];
  await check();
  assert.equal(notices.length, 2);
  state.items = Array.from({ length: 121 }, (_, offset) => ({
    ...merged,
    number: 100 + offset,
    state: 'closed',
    mergedAt: undefined,
  }));
  state.notes = [];
  await check();
  log.length = 0;
  state.items = [{ ...merged, updatedAt: date(now + 1_000) }];
  state.notes = [note];
  await check();
  assert.ok(
    log.some(
      ([method, , kind, , number]) =>
        method === 'reviews.activity' && kind === 'comments' && number === 8,
    ),
  );
  assert.equal(notices.length, 2);
});

test('offline aliases and excluded repositories are skipped and late responses stay silent', async (t) => {
  t.mock.method(Date, 'now', () => baseline);
  const { log, notices, token, check, client, association } = fixture();
  token.associations.unshift({ ...association, repositoryId: 'offline' });
  await check(['repo']);
  assert.deepEqual(
    log.map(([, id]) => id),
    ['offline'],
  );
  await check();
  assert.ok(log.some(([method, id]) => method === 'reviews.list' && id === 'repo'));
  const original = client.collaboration;
  const cancellation = new AbortController();
  client.collaboration = async (method, args) => {
    if (method === 'reviews.activity') {
      cancellation.abort();
      return { entries: [{ id: 'late', createdAt: date(baseline + 1000) }], hasMore: false };
    }
    return original(method, args);
  };
  await assert.rejects(check([], cancellation.signal), { name: 'AbortError' });
  assert.equal(notices.length, 0);
});
