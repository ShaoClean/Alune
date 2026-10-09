import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parsePatchHunks } from '../../../packages/shared/src/partial-diff.ts';
import { DiffViewer } from '../src/components/DiffViewer.tsx';
const diff =
  'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n keep\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n';
test('line IDs retain patch positions and no-newline markers attach only to their rows', () => {
  const [hunk] = parsePatchHunks(diff);
  assert.equal(hunk.headerIndex, 3);
  assert.deepEqual(hunk.rows, [
    { index: 4, kind: 'context', content: 'keep\n' },
    { index: 5, kind: 'remove', content: 'old' },
    { index: 7, kind: 'add', content: 'new' },
  ]);
  assert.throws(() => parsePatchHunks(diff.replace('-1,2', '-1,3')), /不完整/);
});
for (const splitView of [false, true]) {
  test(`${splitView ? 'split' : 'unified'} renders the same actionable lines and hunk controls`, () => {
    const html = renderToStaticMarkup(
      React.createElement(DiffViewer, {
        diff,
        repoId: 'test',
        filePath: 'a.txt',
        splitView,
        partial: { revision: 'a'.repeat(64), staged: false, onChanged: async () => {} },
      }),
    );
    assert.match(html, /暂存此块/);
    assert.match(html, /放弃此块/);
    assert.match(html, /暂存所选行/);
    assert.match(html, /data-partial-line="5"/);
    assert.match(html, /data-partial-line="7"/);
    assert.doesNotMatch(html, /data-partial-line="4"/);
    assert.match(html, /选择删除行 2/);
    assert.match(html, /选择新增行 2/);
  });
}
test('history remains read only; staged comparison offers only unstage', () => {
  const readOnly = renderToStaticMarkup(React.createElement(DiffViewer, { diff }));
  assert.doesNotMatch(readOnly, /data-partial-line|暂存此块|放弃此块/);
  const staged = renderToStaticMarkup(
    React.createElement(DiffViewer, {
      diff,
      repoId: 'test',
      filePath: 'a.txt',
      partial: {
        revision: 'a'.repeat(64),
        staged: true,
        onChanged: async () => {},
      },
    }),
  );
  assert.match(staged, /取消暂存此块/);
  assert.match(staged, /取消暂存所选行/);
  assert.doesNotMatch(staged, /放弃此块|放弃所选行/);
});

for (const splitView of [false, true]) {
  test(`${splitView ? 'split' : 'unified'} offers an enable button before preparation`, () => {
    const props = {
      diff,
      repoId: 'test',
      filePath: 'a.txt',
      splitView,
      partial: { staged: false, onEnable: async () => {}, onChanged: async () => {} },
    };
    const html = renderToStaticMarkup(React.createElement(DiffViewer, props));
    assert.match(html, /开启按行操作/);
    assert.doesNotMatch(html, /正在准备按行操作|data-partial-line|暂存此块|暂存所选行/);
    const preparing = renderToStaticMarkup(
      React.createElement(DiffViewer, {
        ...props,
        partial: { ...props.partial, refreshing: true, preparing: true },
      }),
    );
    assert.match(preparing, /正在准备按行操作/);
    assert.doesNotMatch(preparing, /开启按行操作|data-partial-line/);
    const failed = renderToStaticMarkup(
      React.createElement(DiffViewer, {
        ...props,
        partial: { ...props.partial, unavailableReason: '校验失败' },
      }),
    );
    assert.match(failed, /校验失败/);
    assert.match(failed, /开启按行操作/);
  });
}
