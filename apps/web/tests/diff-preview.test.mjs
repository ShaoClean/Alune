import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDiffLines, getDiffNotice, getNumberedDiffLines } from '../src/components/diff-lines.ts';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
const { createRepositoryStore } = await import('../src/stores/repositoryStore.ts');
const { repositoryApi } = await import('../src/api/index.ts');
const { DiffViewer } = await import('../src/components/DiffViewer.tsx');
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

test('line numbers follow each hunk and do not advance for patch metadata', () => {
  const patch =
    'diff --git a/a b/a\n@@ -3,2 +7,2 @@\n context\n-old\n+new\n\\ No newline at end of file\n@@ -20 +30 @@\n-before\n+after\n';
  assert.deepEqual(
    getNumberedDiffLines(patch)
      .filter((line) => line.kind !== 'meta')
      .map(({ oldLine, newLine }) => [oldLine, newLine]),
    [
      [3, 7],
      [4, undefined],
      [undefined, 8],
      [20, undefined],
      [undefined, 30],
    ],
  );
  assert.deepEqual(
    getNumberedDiffLines(textPatch)
      .filter((line) => line.kind === 'add')
      .map(({ oldLine, newLine }) => [oldLine, newLine]),
    [
      [undefined, 1],
      [undefined, 2],
    ],
  );
});

test('refreshing the same comparison keeps readable content until the latest response', async () => {
  repositoryApi.diff = async () => textPatch;
  await store.getState().fetchDiff('repo', { file: 'new' });
  const pending = [];
  repositoryApi.diff = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const first = store.getState().fetchDiff('repo', { staged: false, file: 'new' });
  const second = store.getState().fetchDiff('repo', { file: 'new' });
  assert.equal(store.getState().diff, textPatch);
  assert.equal(store.getState().diffLoading, false);
  assert.equal(store.getState().diffRefreshing, true);
  pending[1].resolve('updated patch');
  await second;
  pending[0].reject(new Error('late refresh error'));
  await first;
  assert.equal(store.getState().diff, 'updated patch');
  assert.equal(store.getState().diffRefreshing, false);
  assert.equal(store.getState().diffError, null);
});

test('failed refresh hides outdated content, exposes the error and permits retry', async () => {
  repositoryApi.diff = async () => textPatch;
  await store.getState().fetchDiff('repo', { file: 'new' });
  repositoryApi.diff = async () => {
    throw new Error('offline');
  };
  await store.getState().fetchDiff('repo', { file: 'new' });
  assert.equal(store.getState().diff, '');
  assert.equal(store.getState().diffError, 'offline');
  assert.equal(store.getState().diffRefreshing, false);
  repositoryApi.diff = async () => '';
  await store.getState().fetchDiff('repo', { file: 'new' });
  assert.equal(store.getState().diff, '');
  assert.equal(store.getState().diffError, null);
  assert.equal(store.getState().diffLoading, false);
});

test('changing repository, file, side, commit or parent never retains another comparison', async () => {
  const comparisons = [
    { file: 'new' },
    { file: 'other' },
    { file: 'other', staged: true },
    { file: 'other', commit: 'a' },
    { file: 'other', commit: 'b' },
    { file: 'other', commit: 'b', parentCommit: 'second-parent' },
  ];
  for (const params of comparisons) {
    let resolve;
    repositoryApi.diff = () =>
      new Promise((done) => {
        resolve = done;
      });
    const request = store.getState().fetchDiff('repo', params);
    assert.equal(store.getState().diff, '');
    assert.equal(store.getState().diffLoading, true);
    assert.equal(store.getState().diffRefreshing, false);
    resolve(textPatch);
    await request;
  }
  let resolve;
  repositoryApi.diff = () =>
    new Promise((done) => {
      resolve = done;
    });
  const refresh = store.getState().fetchDiff('repo', comparisons.at(-1));
  store.getState().resetWorkspace('other-repo');
  resolve('late refresh');
  await refresh;
  assert.equal(store.getState().diff, '');
  assert.equal(store.getState().diffRefreshing, false);
  assert.equal(store.getState().diffKey, null);
});

test('视图切换只显示图标，并保留可访问名称与选中态', () => {
  const html = renderToStaticMarkup(
    createElement(DiffViewer, { diff: textPatch, title: 'new', splitView: true }),
  );
  const items = [
    ...html.matchAll(/<label class="([^"]*ant-segmented-item[^"]*)">([\s\S]*?)<\/label>/g),
  ].map(([, className, content]) => ({
    selected: className.includes('ant-segmented-item-selected'),
    checked: /<input[^>]*checked/.test(content),
    icons: [...content.matchAll(/class="diff-view-icon"/g)].length,
    text: content.replace(/<[^>]*>/g, '').trim(),
  }));
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => item.text),
    ['统一视图', '分栏视图'],
    'accessible names survive dropping the visible caption',
  );
  for (const item of items) {
    assert.equal(item.icons, 1, 'every option renders exactly one icon');
  }
  assert.match(html, /diff-view-switch__label">统一视图/, 'the caption is visually hidden only');
  assert.equal(items[1].checked, true, 'splitView keeps driving the selected option');
  assert.equal(items[1].selected, true);
  assert.equal(items[0].checked, false);
});
