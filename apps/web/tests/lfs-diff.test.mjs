import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiffViewer } from '../src/components/DiffViewer.tsx';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lfsDiffPointers } from '../src/components/lfs-diff.ts';
const oid = 'a'.repeat(64);
const other = 'b'.repeat(64);
test('LFS diffs identify both OIDs and real sizes including unchanged context', () => {
  const diff = `diff --git a/a.png b/a.png\n--- a/a.png\n+++ b/a.png\n@@ -1,3 +1,3 @@\n version https://git-lfs.github.com/spec/v1\n-oid sha256:${oid}\n-size 120\n+oid sha256:${other}\n+size 240\n`;
  assert.deepEqual(lfsDiffPointers(diff), {
    before: { oid, size: 120 },
    after: { oid: other, size: 240 },
  });
  assert.equal(lfsDiffPointers('diff --git a/a b/a\n@@ -1 +1 @@\n-hello\n+world'), null);
});
test('LFS additions and deletions retain the absent side', () => {
  const lines = ['version https://git-lfs.github.com/spec/v1', `oid sha256:${oid}`, 'size 0'];
  const addition = `diff --git a/a b/a\nnew file mode 100644\n@@ -0,0 +1,3 @@\n${lines.map((line) => '+' + line).join('\n')}\n`;
  assert.deepEqual(lfsDiffPointers(addition), { before: null, after: { oid, size: 0 } });
  assert.deepEqual(
    lfsDiffPointers(
      addition.replace('new file mode', 'deleted file mode').replaceAll('\n+', '\n-'),
    ),
    { before: { oid, size: 0 }, after: null },
  );
});

test('LFS diff renders readable metadata instead of pointer source', () => {
  const diff = `diff --git a/a.bin b/a.bin\n--- a/a.bin\n+++ b/a.bin\n@@ -1,3 +1,3 @@\n version https://git-lfs.github.com/spec/v1\n-oid sha256:${oid}\n-size 120\n+oid sha256:${other}\n+size 2048\n`;
  const html = renderToStaticMarkup(createElement(DiffViewer, { diff, filePath: 'a.bin' }));
  assert.match(html, /Git LFS 文件变化/);
  assert.match(html, /变更前/);
  assert.match(html, /变更后/);
  assert.match(html, /2\.0 KB/);
  assert.match(html, new RegExp(oid));
  assert.match(html, new RegExp(other));
  assert.doesNotMatch(html, /https:\/\/git-lfs/);
});
