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

test('shows the readable patch before validation and installs the validated patch and revision together', async () => {
  const loading = store.getState().fetchDiff('repo', { file: 'file.txt' });
  assert.equal(calls[0].params.editable, undefined);
  calls[0].resolve('readable patch');
  await flush();
  assert.equal(store.getState().diff, 'readable patch');
  assert.equal(store.getState().diffLoading, false);
  assert.equal(store.getState().diffRefreshing, true);
  assert.equal(store.getState().partialDiff.revision, undefined);
  assert.equal(calls[1].params.editable, true);
  calls[1].resolve({ diff: 'validated patch', revision: 'revision' });
  await loading;
  assert.equal(store.getState().diff, 'validated patch');
  assert.equal(store.getState().partialDiff.revision, 'revision');
  assert.equal(store.getState().diffRefreshing, false);
});

test('a failed validation preserves the readable diff without enabling writes', async () => {
  const loading = store.getState().fetchDiff('repo', { file: 'file.txt' });
  calls[0].resolve('readable patch');
  await flush();
  calls[1].reject(new Error('snapshot changed'));
  await loading;
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
      const first = store.getState().fetchDiff('repo', { file: 'old.txt' });
      if (phase === 'validation') {
        calls[0].resolve('old readable patch');
        await flush();
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
  await flush();
  calls[1].resolve({ diff: 'patch', revision: 'old' });
  await first;
  const refresh = store.getState().fetchDiff('repo', params);
  assert.equal(store.getState().diffRefreshing, true);
  calls[2].resolve('new patch');
  await flush();
  assert.equal(store.getState().partialDiff.revision, undefined);
  calls[3].resolve({ diff: 'new patch', revision: 'new' });
  await refresh;
  assert.equal(store.getState().partialDiff.revision, 'new');
});
