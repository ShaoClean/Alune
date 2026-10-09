import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
const { createRepositoryStore } = await import('../src/stores/repositoryStore.ts');
const { repositoryApi } = await import('../src/api/index.ts');
const flush = () => new Promise((resolve) => setImmediate(resolve));
let store, calls;
beforeEach(() => {
  store = createRepositoryStore();
  calls = [];
  repositoryApi.diff = (id, params, signal) =>
    new Promise((resolve, reject) => {
      calls.push({ id, params, signal, resolve, reject });
    });
});

test('opens a read-only patch and validates only after explicitly enabling line actions', async () => {
  const loading = store.getState().fetchDiff('repo', { file: 'file.txt' });
  assert.equal(calls[0].params.editable, undefined);
  calls[0].resolve('readable patch');
  await flush();
  assert.equal(store.getState().diff, 'readable patch');
  assert.equal(store.getState().diffLoading, false);
  assert.equal(store.getState().diffRefreshing, false);
  assert.equal(store.getState().partialDiffEnabled, false);
  assert.equal(calls.length, 1);
  await loading;
  const preparing = store.getState().preparePartialDiff('repo', { file: 'file.txt' });
  assert.equal(store.getState().diffRefreshing, true);
  assert.equal(store.getState().partialDiff.revision, undefined);
  assert.equal(calls[1].params.editable, true);
  calls[1].resolve({ diff: 'validated patch', revision: 'revision' });
  await preparing;
  assert.equal(store.getState().diff, 'validated patch');
  assert.equal(store.getState().partialDiff.revision, 'revision');
  assert.equal(store.getState().diffRefreshing, false);
});

test('a failed validation preserves the readable diff without enabling writes', async () => {
  const loading = store.getState().fetchDiff('repo', { file: 'file.txt' });
  calls[0].resolve('readable patch');
  await flush();
  await loading;
  const preparing = store.getState().preparePartialDiff('repo', { file: 'file.txt' });
  calls[1].reject(new Error('snapshot changed'));
  await preparing;
  assert.equal(store.getState().diff, 'readable patch');
  assert.equal(store.getState().diffError, null);
  assert.equal(store.getState().partialDiff.revision, undefined);
  assert.equal(store.getState().partialDiff.unavailableReason, 'snapshot changed');
  assert.equal(store.getState().diffRefreshing, false);
});

test('a failed initial read does not start validation', async () => {
  const loading = store.getState().fetchDiff('repo', { file: 'file.txt' });
  calls[0].reject(new Error('offline'));
  await loading;
  assert.equal(calls.length, 1);
  assert.equal(store.getState().diffError, 'offline');
});

for (const phase of ['read', 'validation']) {
  for (const action of ['switch', 'clear', 'reset']) {
    test(`${action} cancels ${phase} and ignores its late response`, async () => {
      let first = store.getState().fetchDiff('repo', { file: 'old.txt' });
      if (phase === 'validation') {
        calls[0].resolve('old readable patch');
        await first;
        first = store.getState().preparePartialDiff('repo', { file: 'old.txt' });
      }
      const old = calls.at(-1);
      let next;
      if (action === 'switch') {
        next = store.getState().fetchDiff('repo', { file: 'new.txt', commit: 'abc' });
        calls.at(-1).resolve('new patch');
        await next;
      } else if (action === 'clear') store.getState().clearDiff();
      else store.getState().resetWorkspace('other');
      assert.equal(old.signal.aborted, true);
      old.resolve(phase === 'validation' ? { diff: 'late patch', revision: 'old' } : 'late patch');
      await first;
      assert.equal(store.getState().diff, action === 'switch' ? 'new patch' : '');
      assert.equal(store.getState().partialDiff, null);
      assert.equal(store.getState().partialDiffEnabled, false);
      assert.equal(store.getState().diffError, null);
      assert.equal(calls.length, (phase === 'validation' ? 2 : 1) + (action === 'switch' ? 1 : 0));
    });
  }
}

test('history uses only the read request', async () => {
  const loading = store.getState().fetchDiff('repo', { file: 'file.txt', commit: 'abc' });
  calls[0].resolve('history patch');
  await loading;
  assert.equal(calls.length, 1);
  assert.equal(store.getState().diff, 'history patch');
  assert.equal(store.getState().partialDiff, null);
});

test('refresh disables the previous revision until the new snapshots arrive', async () => {
  const params = { file: 'file.txt', staged: true };
  const first = store.getState().fetchDiff('repo', params);
  calls[0].resolve('patch');
  await first;
  const preparing = store.getState().preparePartialDiff('repo', params);
  calls[1].resolve({ diff: 'patch', revision: 'old' });
  await preparing;
  const refresh = store.getState().fetchDiff('repo', params);
  assert.equal(store.getState().diffRefreshing, true);
  assert.equal(store.getState().partialDiff.revision, undefined);
  calls[2].resolve('new patch');
  await flush();
  assert.equal(store.getState().partialDiff.revision, undefined);
  calls[3].resolve({ diff: 'new patch', revision: 'new' });
  await refresh;
  assert.equal(store.getState().partialDiff.revision, 'new');
});

test('ordinary refreshes do not opt in to line actions', async () => {
  for (let index = 0; index < 2; index++) {
    const loading = store.getState().fetchDiff('repo', { file: 'file.txt' });
    calls[index].resolve('patch');
    await loading;
    assert.equal(calls.length, index + 1);
    assert.equal(store.getState().partialDiffEnabled, false);
    assert.equal(store.getState().diffRefreshing, false);
  }
});

test('preparation ignores duplicate clicks and can be retried after failure', async () => {
  const params = { file: 'file.txt' };
  const loading = store.getState().fetchDiff('repo', params);
  calls[0].resolve('patch');
  await loading;
  const preparing = store.getState().preparePartialDiff('repo', params);
  await store.getState().preparePartialDiff('repo', params);
  assert.equal(calls.length, 2);
  calls[1].reject(new Error('try again'));
  await preparing;
  const retry = store.getState().preparePartialDiff('repo', params);
  calls[2].resolve({ diff: 'validated', revision: 'new' });
  await retry;
  assert.equal(store.getState().partialDiff.revision, 'new');
  assert.equal(store.getState().partialDiff.unavailableReason, undefined);
});

test('switching file, repository, or staged side requires a new opt-in', async () => {
  for (const [id, params] of [
    ['repo', { file: 'other.txt' }],
    ['other-repo', { file: 'file.txt' }],
    ['repo', { file: 'file.txt', staged: true }],
  ]) {
    store = createRepositoryStore();
    calls = [];
    const loading = store.getState().fetchDiff('repo', { file: 'file.txt' });
    calls[0].resolve('patch');
    await loading;
    const preparing = store.getState().preparePartialDiff('repo', { file: 'file.txt' });
    calls[1].resolve({ diff: 'validated', revision: 'old' });
    await preparing;
    const next = store.getState().fetchDiff(id, params);
    calls[2].resolve('other patch');
    await next;
    assert.equal(calls.length, 3);
    assert.equal(store.getState().partialDiffEnabled, false);
    assert.equal(store.getState().partialDiff.revision, undefined);
    await store.getState().preparePartialDiff('repo', { file: 'file.txt' });
    assert.equal(calls.length, 3);
  }
});
