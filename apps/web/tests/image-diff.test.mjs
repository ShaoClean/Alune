import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDiffNotice, getImageDiffKind } from '../src/components/diff-lines.ts';
import { diffImageMediaType } from '../../../packages/shared/src/index.ts';

const header = (path, mode) =>
  `diff --git a/${path} b/${path}\n${mode}\nindex 0000000..1111111\n`;
const binary = (path, mode) =>
  `${header(path, mode)}Binary files a/${path} and b/${path} differ\n`;

test('added, deleted and modified image patches map to their own preview mode', () => {
  assert.equal(getImageDiffKind(binary('ui/logo.png', 'new file mode 100644'), 'ui/logo.png'), 'added');
  assert.equal(
    getImageDiffKind(binary('ui/logo.png', 'deleted file mode 100644'), 'ui/logo.png'),
    'deleted',
  );
  assert.equal(getImageDiffKind(binary('ui/logo.png', 'index 1..2 100644'), 'ui/logo.png'), 'modified');
  // A literal `GIT binary patch` body is also an image change, not text.
  assert.equal(
    getImageDiffKind(`${header('a.webp', 'index 1..2 100644')}GIT binary patch\n`, 'a.webp'),
    'modified',
  );
});

test('supported extensions are matched case-insensitively and by the file name only', () => {
  for (const path of ['a.PNG', 'dir.jpg/b.JPEG', 'c.gif', 'd.webp', '中文 图片.png'])
    assert.ok(diffImageMediaType(path), path);
  for (const path of ['a.svg', 'a.bmp', 'dir.png/child', 'noext', '.png', 'a.png.txt'])
    assert.equal(diffImageMediaType(path), null, path);
});

test('non-image binaries, text patches and multi-file patches keep the existing notices', () => {
  const binaryAsset = binary('asset.bin', 'new file mode 100644');
  assert.equal(getImageDiffKind(binaryAsset, 'asset.bin'), null);
  assert.match(getDiffNotice(binaryAsset), /二进制文件/);

  const textPatch =
    'diff --git a/a.png b/a.png\nindex 1..2 100644\n--- a/a.png\n+++ b/a.png\n@@ -1 +1 @@\n-old\n+new\n';
  assert.equal(getImageDiffKind(textPatch, 'a.png'), null, 'text hunks must stay in the text view');

  const multiFile = binary('a.png', 'index 1..2 100644') + binary('b.png', 'index 3..4 100644');
  assert.equal(getImageDiffKind(multiFile, 'a.png'), null, 'whole-commit patches stay textual');

  const emptyFile = `${header('a.png', 'new file mode 100644')}`;
  assert.equal(getImageDiffKind(emptyFile, 'a.png'), null, 'an empty file has no image payload');
  assert.equal(getDiffNotice(emptyFile), '新增空文件');
  assert.equal(getImageDiffKind(binary('a.png', 'index 1..2 100644'), ''), null);
});
