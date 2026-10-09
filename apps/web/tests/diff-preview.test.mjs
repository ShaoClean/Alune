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
const ws = () => store.getState().workspaces.repo;
beforeEach(() => {
  store = createRepositoryStore();
  store.getState().activateWorkspace('repo');
});
const textPatch =
  'diff --git a/new b/new\nnew file mode 100644\n--- /dev/null\n+++ b/new\n@@ -0,0 +1,2 @@\n+hello\n+++ looks like a header\n';
const emptyPatch = 'diff --git a/new b/new\nnew file mode 100644\nindex 0000000..e69de29\n';
const binaryPatch =
  'diff --git a/new b/new\nnew file mode 100644\nBinary files /dev/null and b/new differ\n';

test('fullscreen and focus are separate actions, including when a focus callback is provided', () => {
  for (const onFocus of [undefined, () => {}]) {
    const html = renderToStaticMarkup(createElement(DiffViewer, { diff: textPatch, onFocus }));
    assert.match(html, /aria-label="全屏查看差异"/);
    assert.equal(html.includes('aria-label="专注阅读差异"'), Boolean(onFocus));
    assert.doesNotMatch(html, /role="dialog"/);
  }
});

test('loading, error and empty diffs disable the fullscreen entry', () => {
  for (const props of [
    { loading: true, diff: textPatch },
    { error: 'offline', diff: textPatch },
    { diff: '' },
    {},
  ]) {
    const html = renderToStaticMarkup(createElement(DiffViewer, props));
    const button = html.match(/<button[^>]*aria-label="全屏查看差异"[^>]*>/)?.[0];
    assert.ok(button);
    assert.match(button, /disabled/);
  }
});

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
    options?.editable
      ? Promise.resolve({ diff: 'current', revision: 'validated' })
      : new Promise((resolve, reject) => pending.push({ options, resolve, reject }));
  const first = store.getState().fetchDiff('repo', { file: 'new', staged: false });
  const second = store.getState().fetchDiff('repo', { file: 'new', staged: true });
  const third = store.getState().fetchDiff('repo', { file: 'other', staged: false });
  assert.equal(ws().diff, '');
  assert.equal(ws().diffLoading, true);
  pending[2].resolve('current');
  await third;
  pending[1].reject(new Error('stale error'));
  pending[0].resolve('stale content');
  await Promise.all([first, second]);
  assert.equal(ws().diff, 'current');
  assert.equal(ws().diffError, null);
});

test('closing or losing the selected file invalidates pending requests and clears errors', async () => {
  let resolve;
  repositoryApi.diff = () =>
    new Promise((done) => {
      resolve = done;
    });
  const pending = store.getState().fetchDiff('repo', { file: 'new' });
  store.getState().clearDiff('repo');
  resolve(textPatch);
  await pending;
  assert.equal(ws().diff, '');
  assert.equal(ws().diffLoading, false);
  repositoryApi.diff = async () => {
    throw Object.assign(new Error('Request failed with status code 400'), {
      response: { data: { message: '文件或差异超出预览限制（1 MiB）' } },
    });
  };
  await store.getState().fetchDiff('repo', { file: 'large' });
  assert.match(ws().diffError, /1 MiB/);
  assert.equal(ws().error, null, 'preview failures must not hide the repository');
  store.getState().clearDiff('repo');
  assert.equal(ws().diffError, null);
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
  repositoryApi.diff = (_id, options) =>
    options?.editable
      ? Promise.resolve({ diff: 'updated patch', revision: 'validated' })
      : new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const first = store.getState().fetchDiff('repo', { staged: false, file: 'new' });
  const second = store.getState().fetchDiff('repo', { file: 'new' });
  assert.equal(ws().diff, textPatch);
  assert.equal(ws().diffLoading, false);
  assert.equal(ws().diffRefreshing, true);
  pending[1].resolve('updated patch');
  await second;
  pending[0].reject(new Error('late refresh error'));
  await first;
  assert.equal(ws().diff, 'updated patch');
  assert.equal(ws().diffRefreshing, false);
  assert.equal(ws().diffError, null);
});

test('failed refresh hides outdated content, exposes the error and permits retry', async () => {
  repositoryApi.diff = async () => textPatch;
  await store.getState().fetchDiff('repo', { file: 'new' });
  repositoryApi.diff = async () => {
    throw new Error('offline');
  };
  await store.getState().fetchDiff('repo', { file: 'new' });
  assert.equal(ws().diff, '');
  assert.equal(ws().diffError, 'offline');
  assert.equal(ws().diffRefreshing, false);
  repositoryApi.diff = async () => '';
  await store.getState().fetchDiff('repo', { file: 'new' });
  assert.equal(ws().diff, '');
  assert.equal(ws().diffError, null);
  assert.equal(ws().diffLoading, false);
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
    repositoryApi.diff = (_id, options) =>
      options?.editable
        ? Promise.resolve({ diff: textPatch, revision: 'validated' })
        : new Promise((done) => {
            resolve = done;
          });
    const request = store.getState().fetchDiff('repo', params);
    assert.equal(ws().diff, '');
    assert.equal(ws().diffLoading, true);
    assert.equal(ws().diffRefreshing, false);
    resolve(textPatch);
    await request;
  }
  let resolve;
  repositoryApi.diff = () =>
    new Promise((done) => {
      resolve = done;
    });
  const refresh = store.getState().fetchDiff('repo', comparisons.at(-1));
  store.getState().disposeWorkspaces(['repo']);
  resolve('late refresh');
  await refresh;
  store.getState().activateWorkspace('repo');
  assert.equal(ws().diff, '');
  assert.equal(ws().diffRefreshing, false);
  assert.equal(ws().diffKey, null);
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

test('the inspector and History keep separate Diff slots that load and clear independently', async () => {
  const pending = [];
  repositoryApi.diff = (_id, options, signal) =>
    options?.editable
      ? Promise.resolve({ diff: 'worktree', revision: 'validated' })
      : new Promise((resolve, reject) => pending.push({ options, signal, resolve, reject }));
  const commit = store.getState().fetchDiff('repo', { commit: 'abc', file: 'new' }, 'commit');
  const worktree = store.getState().fetchDiff('repo', { file: 'new' });
  assert.equal(pending[0].signal.aborted, false, 'a worktree request must not abort History');
  assert.equal(ws().commitDiff.diffLoading, true);
  assert.equal(ws().diffLoading, true);
  pending[1].resolve('worktree');
  await worktree;
  assert.equal(ws().diff, 'worktree');
  assert.equal(ws().commitDiff.diff, '', 'a worktree response must not reach History');
  pending[0].resolve('commit');
  await commit;
  assert.equal(ws().commitDiff.diff, 'commit');
  assert.equal(ws().commitDiff.partialDiff, null);
  assert.equal(ws().diff, 'worktree', 'a late commit response must not reach the inspector');
  assert.equal(ws().partialDiff.revision, undefined, 'line actions wait for an opt-in');
  await store.getState().preparePartialDiff('repo', { file: 'new' });
  assert.equal(ws().partialDiff.revision, 'validated');
  assert.equal(ws().commitDiff.diff, 'commit', 'validating the inspector leaves History alone');

  store.getState().clearDiff('repo', 'commit');
  assert.equal(ws().commitDiff.diff, '');
  assert.equal(ws().diff, 'worktree', 'leaving History keeps the inspector Diff');
  store.getState().clearDiff('repo');
  assert.equal(ws().diff, '');
  assert.equal(ws().partialDiff, null);
});

test('clearing one slot invalidates only its own pending request', async () => {
  const pending = [];
  repositoryApi.diff = (_id, options, signal) =>
    new Promise((resolve) => pending.push({ options, signal, resolve }));
  const commit = store.getState().fetchDiff('repo', { commit: 'abc' }, 'commit');
  const worktree = store.getState().fetchDiff('repo', { file: 'new' });
  store.getState().clearDiff('repo');
  assert.equal(pending[1].signal.aborted, true);
  assert.equal(pending[0].signal.aborted, false);
  pending[1].resolve('stale worktree');
  pending[0].resolve('commit');
  await Promise.all([commit, worktree]);
  assert.equal(ws().diff, '');
  assert.equal(ws().diffLoading, false);
  assert.equal(ws().commitDiff.diff, 'commit');
  assert.equal(ws().commitDiff.diffLoading, false);
});

test('a retained inspector Diff refreshes in place when its panel is shown again', async () => {
  repositoryApi.diff = async (_id, options) =>
    options?.editable ? { diff: textPatch, revision: 'r1' } : textPatch;
  await store.getState().fetchDiff('repo', { file: 'new' });
  await store.getState().preparePartialDiff('repo', { file: 'new' });
  assert.equal(ws().partialDiff.revision, 'r1');
  await store.getState().fetchDiff('repo', { commit: 'abc' }, 'commit');
  let resolve;
  repositoryApi.diff = async (_id, options) => {
    if (options?.editable) return { diff: textPatch, revision: 'r2' };
    return new Promise((done) => {
      resolve = done;
    });
  };
  const refresh = store.getState().fetchDiff('repo', { file: 'new' });
  assert.equal(ws().diff, textPatch, 'the shown Diff stays while it revalidates');
  assert.equal(ws().diffLoading, false);
  assert.equal(ws().diffRefreshing, true);
  resolve(textPatch);
  await refresh;
  assert.equal(ws().partialDiff.revision, 'r2');
  assert.equal(ws().commitDiff.diff, textPatch);
});

test('closing a tab stops pending requests in both Diff slots', () => {
  const signals = [];
  repositoryApi.diff = (_id, _options, signal) => {
    signals.push(signal);
    return new Promise(() => {});
  };
  void store.getState().fetchDiff('repo', { file: 'new' });
  void store.getState().fetchDiff('repo', { commit: 'abc' }, 'commit');
  store.getState().disposeWorkspaces(['repo']);
  assert.deepEqual(
    signals.map((signal) => signal.aborted),
    [true, true],
  );
  assert.equal(store.getState().workspaces.repo, undefined);
});
