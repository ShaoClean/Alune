import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getDiffLines, getDiffNotice } from '../src/components/diff-lines.ts';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
const { createRepositoryStore } = await import('../src/stores/repositoryStore.ts');
const { repositoryApi } = await import('../src/api/index.ts');
let store;
beforeEach(() => {
  store = createRepositoryStore();
  store.getState().resetWorkspace('repo');
});
const textPatch =
  'diff --git a/new b/new\nnew file mode 100644\n--- /dev/null\n+++ b/new\n@@ -0,0 +1,2 @@\n+hello\n+++ looks like a header\n';
const emptyPatch = 'diff --git a/new b/new\nnew file mode 100644\nindex 0000000..e69de29\n';
const binaryPatch =
  'diff --git a/new b/new\nnew file mode 100644\nBinary files /dev/null and b/new differ\n';

test('hunk parsing marks header-like file content as an addition', () => {
  assert.equal(getDiffLines(textPatch).filter(({ kind }) => kind === 'add').length, 2);
  assert.equal(getDiffNotice(textPatch), null);
  assert.deepEqual(
    getDiffLines(textPatch)
      .filter(({ kind }) => kind === 'add')
      .map(({ text }) => text),
    ['+hello', '+++ looks like a header'],
  );
});

test('empty and binary file notices are distinct without hiding mixed history patches', () => {
  assert.equal(getDiffNotice(emptyPatch), '新增空文件');
  assert.match(getDiffNotice(binaryPatch), /二进制文件/);
  assert.equal(getDiffNotice(''), null);
  assert.equal(getDiffNotice(emptyPatch + textPatch), null, 'mixed history patches stay visible');
});

test('the latest file/side wins when older successes and failures arrive late', async () => {
  const pending = [];
  repositoryApi.diff = (_id, options) =>
    new Promise((resolve, reject) => pending.push({ options, resolve, reject }));
  const first = store.getState().fetchDiff('repo', { file: 'new', staged: false });
  const second = store.getState().fetchDiff('repo', { file: 'new', staged: true });
  const third = store.getState().fetchDiff('repo', { file: 'other', staged: false });
  assert.equal(store.getState().diff, '');
  assert.equal(store.getState().diffLoading, true);
  pending[2].resolve('current');
  await third;
  pending[1].reject(new Error('stale error'));
  pending[0].resolve('stale content');
  await Promise.all([first, second]);
  assert.equal(store.getState().diff, 'current');
  assert.equal(store.getState().diffError, null);
});

test('closing or losing the selected file invalidates pending requests and clears errors', async () => {
  let resolve;
  repositoryApi.diff = () =>
    new Promise((done) => {
      resolve = done;
    });
  const pending = store.getState().fetchDiff('repo', { file: 'new' });
  store.getState().clearDiff();
  resolve(textPatch);
  await pending;
  assert.equal(store.getState().diff, '');
  assert.equal(store.getState().diffLoading, false);
  repositoryApi.diff = async () => {
    throw Object.assign(new Error('Request failed with status code 400'), {
      response: { data: { message: '文件或差异超出预览限制（1 MiB）' } },
    });
  };
  await store.getState().fetchDiff('repo', { file: 'large' });
  assert.match(store.getState().diffError, /1 MiB/);
  assert.equal(store.getState().error, null, 'preview failures must not hide the repository');
  store.getState().clearDiff();
  assert.equal(store.getState().diffError, null);
});
