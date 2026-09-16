import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { createRepositoryStore } = await import('../src/stores/repositoryStore.ts');
const { repositoryApi } = await import('../src/api/index.ts');
const commit = (hash) => ({ hash, parents: [], references: [] });
const page = (hashes, more = false, nextSkip = hashes.length, revision = 'r1') => ({
  commits: hashes.map(commit),
  hasMore: more,
  nextSkip,
  revision,
  shallow: false,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};
let store;
beforeEach(() => {
  store = createRepositoryStore();
  store.getState().resetWorkspace('a');
});

test('pages append once and use server offsets even when defensive deduplication removes a row', async () => {
  const calls = [];
  repositoryApi.log = async (id, options) => {
    calls.push(options);
    return calls.length === 1 ? page(['a', 'b'], true, 50) : page(['b', 'c'], false, 100);
  };
  await store.getState().fetchLog('a');
  const generation = store.getState().logGeneration;
  await store.getState().fetchLog('a', 'more');
  assert.deepEqual(
    store.getState().log.map((item) => item.hash),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(calls[1], { count: 50, skip: 50, revision: 'r1' });
  assert.equal(store.getState().logNextSkip, 100);
  assert.equal(store.getState().logGeneration, generation);
  await store.getState().fetchLog('a', 'more');
  assert.equal(calls.length, 2);
});

test('duplicate loading clicks share one append and failures preserve data for retry', async () => {
  repositoryApi.log = async () => page(['a'], true);
  await store.getState().fetchLog('a');
  const pending = deferred();
  let calls = 0;
  repositoryApi.log = () => {
    calls++;
    return pending.promise;
  };
  const first = store.getState().fetchLog('a', 'more');
  await store.getState().fetchLog('a', 'more');
  assert.equal(calls, 1);
  assert.equal(store.getState().logLoadingMore, true);
  pending.reject(new Error('offline'));
  await first;
  assert.deepEqual(
    store.getState().log.map((item) => item.hash),
    ['a'],
  );
  assert.equal(store.getState().logError, 'offline');
  assert.equal(store.getState().logErrorMode, 'more');
  repositoryApi.log = async () => page(['b']);
  await store.getState().fetchLog('a', 'more');
  assert.deepEqual(
    store.getState().log.map((item) => item.hash),
    ['a', 'b'],
  );
});

test('refresh replaces only on success and supersedes an older append response', async () => {
  repositoryApi.log = async () => page(['a'], true);
  await store.getState().fetchLog('a');
  const pending = deferred();
  repositoryApi.log = () => pending.promise;
  const append = store.getState().fetchLog('a', 'more');
  repositoryApi.log = async () => {
    throw new Error('refresh failed');
  };
  await store.getState().fetchLog('a');
  assert.deepEqual(
    store.getState().log.map((item) => item.hash),
    ['a'],
  );
  assert.equal(store.getState().logErrorMode, 'refresh');
  repositoryApi.log = async () => page(['new']);
  await store.getState().fetchLog('a');
  pending.resolve(page(['stale']));
  await append;
  assert.deepEqual(
    store.getState().log.map((item) => item.hash),
    ['new'],
  );
});

test('reference changes keep the visible history but prevent appending until refresh', async () => {
  repositoryApi.log = async () => page(['a'], true);
  await store.getState().fetchLog('a');
  let calls = 0;
  repositoryApi.log = async () => {
    calls++;
    throw { response: { data: { code: 'HISTORY_CHANGED', message: 'refresh required' } } };
  };
  await store.getState().fetchLog('a', 'more');
  await store.getState().fetchLog('a', 'more');
  assert.equal(calls, 1);
  assert.equal(store.getState().logChanged, true);
  assert.equal(store.getState().log[0].hash, 'a');
  repositoryApi.log = async () => page(['b'], false, 1, 'r2');
  await store.getState().fetchLog('a');
  assert.equal(store.getState().logChanged, false);
  assert.equal(store.getState().logRevision, 'r2');
});

test('switching repositories aborts and discards stale reads and clears every pagination field', async () => {
  const pending = deferred();
  let signal;
  repositoryApi.log = (_id, _options, incoming) => {
    signal = incoming;
    return pending.promise;
  };
  const first = store.getState().fetchLog('a');
  store.getState().resetWorkspace('b');
  assert.equal(signal.aborted, true);
  assert.equal(store.getState().logRevision, null);
  repositoryApi.log = async () => page(['b']);
  await store.getState().fetchLog('b');
  pending.resolve(page(['a'], true));
  await first;
  assert.deepEqual(
    store.getState().log.map((item) => item.hash),
    ['b'],
  );
  assert.equal(store.getState().logHasMore, false);
});
