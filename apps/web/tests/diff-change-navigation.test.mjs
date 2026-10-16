import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDiffChangeSegments, getNumberedDiffLines } from '../src/components/diff-lines.ts';
import { DiffViewer } from '../src/components/DiffViewer.tsx';

// One hunk with two separate edits, then a second hunk ending without a newline.
const diff = [
  'diff --git a/a.txt b/a.txt',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1,5 +1,6 @@',
  ' one',
  '-two',
  '+TWO',
  ' three',
  ' four',
  '+inserted',
  ' five',
  '@@ -20,2 +20,2 @@',
  ' keep',
  '-old',
  '\\ No newline at end of file',
  '+new',
  '\\ No newline at end of file',
  '',
].join('\n');

test('each run of added/removed lines is one stop, including several per hunk', () => {
  const lines = getNumberedDiffLines(diff);
  assert.deepEqual(getDiffChangeSegments(lines), [[5, 6], [9], [13, 15]]);
  assert.deepEqual(getDiffChangeSegments(getNumberedDiffLines('diff --git a/x b/x\n')), []);
});

for (const splitView of [false, true]) {
  test(`${splitView ? 'split' : 'unified'} view exposes navigation and tags change rows`, () => {
    const html = renderToStaticMarkup(React.createElement(DiffViewer, { diff, splitView }));
    assert.match(html, /aria-label="上一处改动"[^>]*title="上一处改动 · Shift\+Alt\+F5"/);
    assert.match(html, /aria-label="下一处改动"[^>]*title="下一处改动 · Alt\+F5"/);
    assert.match(html, /共 3 处改动/);
    for (const segment of [0, 1, 2]) assert.match(html, new RegExp(`data-change="${segment}"`));
    assert.doesNotMatch(html, /data-change="3"/);
    // The body is focusable so the shortcuts work after clicking into the Diff.
    assert.match(html, /class="diff-shell__body code-diff"[^>]*tabindex="0"/);
  });
}

test('non-text diffs show no change navigation', () => {
  const binary =
    'diff --git a/b.bin b/b.bin\nnew file mode 100644\nBinary files /dev/null and b/b.bin differ\n';
  for (const props of [{ diff: binary }, { loading: true, diff }, { error: 'x', diff }, {}]) {
    const html = renderToStaticMarkup(React.createElement(DiffViewer, props));
    assert.doesNotMatch(html, /下一处改动|data-change=/);
  }
});

test('line actions render inside the single header row, not as a second toolbar row', () => {
  const html = renderToStaticMarkup(
    React.createElement(DiffViewer, {
      diff,
      repoId: 'test',
      filePath: 'a.txt',
      subtitle: '未暂存 · 暂存区 → 工作区',
      partial: { revision: 'a'.repeat(64), staged: false, onChanged: async () => {} },
    }),
  );
  const header = html.slice(html.indexOf('diff-shell__header'), html.indexOf('diff-shell__body'));
  assert.match(header, /class="diff-toolbar"[\s\S]*class="partial-diff-toolbar"/);
  assert.match(header, /暂存所选行[\s\S]*上一处改动[\s\S]*Diff 视图/);
  assert.match(header, /aria-label="更多按行操作"/);
  assert.match(header, /title="a\.txt · 未暂存 · 暂存区 → 工作区"|title="差异预览 · 未暂存/);
  assert.equal(html.match(/class="partial-diff-toolbar"/g).length, 1);
});
