import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pullRequestCenterApi } from '../src/api/index.ts';
import {
  usePullRequestCenter,
  readCenterQuery,
  centerParams,
  centerQueryKey,
  defaultCenterQuery,
} from '../src/stores/pullRequestCenter.ts';

const d = {
  discoveryId: 'discovery',
  sources: [],
  repositoryCount: 2,
  discoveredCount: 2,
  complete: true,
  cursor: null,
};
const row = (key) => ({ key, number: 1, title: key });
const page = (items, nextCursor = null) => ({
  items,
  nextCursor,
  sources: [],
  updatedAt: new Date().toISOString(),
  scanning: !!nextCursor && !items.length,
  totalSources: 2,
  completedSources: 0,
});
beforeEach(() => {
  usePullRequestCenter.getState().stop();
  usePullRequestCenter.setState({ entries: {}, revision: 0 });
});

test('URL round trip retains all filters, deduplicates projects and excludes detail identity', () => {
  const q = readCenterQuery(
    new URLSearchParams(
      'view=created&state=merged&q=feature%2Fone&project=z&project=a&project=z&provider=gitlab&account=gitlab%3Ax%3Aalice&actorVersion=secret',
    ),
  );
  assert.deepEqual(q.projects, ['a', 'z']);
  assert.deepEqual(readCenterQuery(centerParams(q)), q);
  assert.ok(!centerQueryKey(q).includes('actorVersion'));
  assert.equal(readCenterQuery(new URLSearchParams('view=review&state=closed')).state, 'open');
});

test('source discovery and sparse searches continue across cursors and append without duplicates', async () => {
  const original = { ...pullRequestCenterApi };
  let searches = 0,
    discoveryCalls = 0;
  pullRequestCenterApi.sources = async () =>
    ++discoveryCalls === 1 ? { ...d, complete: false, cursor: 'discover-next' } : d;
  pullRequestCenterApi.list = async (input) => {
    searches++;
    if (searches === 1) return page([], 'next');
    if (searches === 2) {
      assert.equal(input.cursor, 'next');
      return page([row('a')], 'last');
    }
    return page([row('a'), row('b')]);
  };
  try {
    await usePullRequestCenter.getState().load(defaultCenterQuery);
    assert.equal(discoveryCalls, 2);
    assert.deepEqual(
      usePullRequestCenter.getState().entries[''].items.map((r) => r.key),
      ['a', 'b'],
    );
    await usePullRequestCenter.getState().load(defaultCenterQuery, 'more');
    assert.deepEqual(
      usePullRequestCenter.getState().entries[''].items.map((r) => r.key),
      ['a', 'b'],
    );
  } finally {
    Object.assign(pullRequestCenterApi, original);
  }
});

test('a background refresh preserves rows and scroll until new results arrive, errors preserve prior results', async () => {
  const original = { ...pullRequestCenterApi };
  pullRequestCenterApi.sources = async () => d;
  pullRequestCenterApi.list = async () => page([row('old')]);
  try {
    await usePullRequestCenter.getState().load(defaultCenterQuery);
    usePullRequestCenter.getState().setScroll('', 440);
    let release;
    pullRequestCenterApi.list = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const loading = usePullRequestCenter.getState().load(defaultCenterQuery);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(usePullRequestCenter.getState().entries[''].items[0].key, 'old');
    release(page([row('new')]));
    await loading;
    assert.equal(usePullRequestCenter.getState().entries[''].scroll, 440);
    pullRequestCenterApi.list = async () => {
      throw new Error('offline');
    };
    await usePullRequestCenter.getState().load(defaultCenterQuery);
    const entry = usePullRequestCenter.getState().entries[''];
    assert.equal(entry.items[0].key, 'new');
    assert.ok(entry.error);
    assert.equal(entry.loading, false);
  } finally {
    Object.assign(pullRequestCenterApi, original);
  }
});

test('late results from a cancelled filter cannot overwrite the current view', async () => {
  const original = { ...pullRequestCenterApi };
  pullRequestCenterApi.sources = async () => d;
  let release;
  pullRequestCenterApi.list = (input) =>
    input.query.search === 'old'
      ? new Promise((resolve) => {
          release = resolve;
        })
      : Promise.resolve(page([row('new')]));
  try {
    const old = usePullRequestCenter.getState().load({ ...defaultCenterQuery, search: 'old' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await usePullRequestCenter.getState().load(defaultCenterQuery);
    release(page([row('old')]));
    await old;
    assert.equal(usePullRequestCenter.getState().entries[''].items[0].key, 'new');
    assert.equal(usePullRequestCenter.getState().entries['q=old'].items.length, 0);
  } finally {
    Object.assign(pullRequestCenterApi, original);
  }
});
