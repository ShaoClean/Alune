import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DiffPackage from 'react-diff-viewer-continued';
import {
  highlightLines,
  highlightLinesHTML,
  highlightLineHTML,
} from '../src/components/syntax-highlight.ts';
import { highlightDiffLines } from '../src/components/diff-highlight.ts';
import { getNumberedDiffLines } from '../src/components/diff-lines.ts';
import { importCodeTheme, defaultCodeTheme, readCustomCodeTheme } from '../src/code-themes.ts';
import {
  DEFAULT_CODE_APPEARANCE,
  codeAppearanceStyle,
  readCodeAppearance,
} from '../src/stores/codeAppearance.ts';
const html = (nodes) => renderToStaticMarkup(createElement('code', null, nodes));

test('patch tokenization preserves text, side-specific multiline comments, file languages and hunk boundaries', () => {
  const patch =
    'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,4 +1,4 @@\n /* open\n- old comment\n+ new comment\n  end */\n const value = "<script>&";\n@@ -20 +20 @@\n-return 1;\n+return 2;\ndiff --git a/b.py b/b.py\n--- a/b.py\n+++ b/b.py\n@@ -1 +1 @@\n-print("old")\n+print("new")\n';
  const lines = getNumberedDiffLines(patch);
  const tokens = highlightDiffLines(lines, undefined, highlightLines);
  for (const [index, line] of lines.entries()) {
    if (line.kind === 'meta') assert.equal(tokens[index], undefined);
    else {
      assert.ok(tokens[index]);
      const text = html(tokens[index])
        .replace(/<[^>]+>/g, '')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&')
        .replaceAll('&quot;', '"');
      assert.equal(text, line.text.slice(1));
      if (line.text.includes('comment') || line.text.includes('end */'))
        assert.match(html(tokens[index]), /syntax-comment/);
      if (line.text.includes('return')) assert.match(html(tokens[index]), /syntax-keyword/);
      if (line.text.includes('print')) assert.match(html(tokens[index]), /syntax-string/);
    }
  }
});

test('unknown file types stay plain; supplied paths cover headerless PR/MR patches and deleted files', () => {
  const patch = '@@ -1 +1 @@\n-const value = 1;\n+const value = 2;';
  const lines = getNumberedDiffLines(patch);
  assert.equal(highlightDiffLines(lines, 'file.unknown', highlightLines).filter(Boolean).length, 0);
  assert.match(html(highlightDiffLines(lines, 'file.ts', highlightLines)[2]), /syntax-number/);
  const deleted = getNumberedDiffLines('--- a/old.py\n+++ /dev/null\n@@ -1 +0,0 @@\n-print("old")');
  assert.match(html(highlightDiffLines(deleted, undefined, highlightLines)[3]), /syntax-string/);
});

test('HTML adapter escapes file content and retains multiline styles for the word diff renderer', () => {
  const code = '/* multiline\ncomment */\nconst text = "<img src=x onerror=alert(1)>&";';
  const lines = highlightLinesHTML(code, 'typescript');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /syntax-comment/);
  assert.match(lines[2], /&lt;img/);
  assert.doesNotMatch(lines[2], /<img/);
  assert.equal(highlightLineHTML('<script>&', 'unknown'), '&lt;script&gt;<span>&amp;</span>');
  assert.match(html(highlightLines(code, 'typescript')[2]), /&lt;img/);
});

test('custom diff backgrounds import, persist and override fallbacks without requiring a storage migration', () => {
  const diffColors = {
    'diffEditor.insertedLineBackground': '#12345622',
    'diffEditor.removedLineBackground': '#65432122',
    'diffEditor.insertedTextBackground': '#2468ac44',
    'diffEditor.removedTextBackground': '#ca864244',
  };
  const theme = importCodeTheme(
    JSON.stringify({
      type: 'dark',
      colors: diffColors,
      tokenColors: [{ scope: 'keyword', settings: { foreground: '#aabbcc' } }],
    }),
    'diff.json',
    'custom-diff',
  ).theme;
  assert.deepEqual(readCustomCodeTheme(theme), theme);
  const restored = readCodeAppearance({
    ...DEFAULT_CODE_APPEARANCE,
    customThemes: [theme],
    darkTheme: theme.id,
  });
  assert.equal(restored.notice, null);
  assert.equal(restored.preferences.darkTheme, theme.id);
  const style = codeAppearanceStyle(restored.preferences, theme);
  assert.equal(style['--code-diff-added'], '#12345622');
  assert.equal(style['--code-diff-wordRemoved'], '#ca864244');
  const { diff, ...legacy } = theme;
  assert.ok(readCustomCodeTheme(legacy), 'pre-existing imported themes remain valid');
  assert.match(
    codeAppearanceStyle(DEFAULT_CODE_APPEARANCE, legacy)['--code-diff-added'],
    /color-mix/,
  );
  assert.equal(
    readCustomCodeTheme({ ...theme, diff: { added: 'url(https://example.invalid)' } }),
    null,
  );
  assert.equal(
    readCodeAppearance({
      ...DEFAULT_CODE_APPEARANCE,
      customThemes: [{ ...theme, diff: [] }],
      darkTheme: theme.id,
    }).preferences.darkTheme,
    defaultCodeTheme('dark').id,
  );
});

test('Git C-quoted non-ASCII file names retain their language suffix', () => {
  const lines = getNumberedDiffLines(String.raw`diff --git "a/\344\270\255.ts" "b/\344\270\255.ts"
--- "a/\344\270\255.ts"
+++ "b/\344\270\255.ts"
@@ -1 +1 @@
-const value = 1;
+const value = 2;`);
  assert.match(html(highlightDiffLines(lines, undefined, highlightLines).at(-1)), /syntax-keyword/);
});

test('real word diff composition preserves literal entities and escaped markup without truncation', () => {
  const Viewer = DiffPackage.default ?? DiffPackage;
  const viewer = new Viewer({});
  viewer.styles = { wordDiff: 'word', wordAdded: 'added', wordRemoved: 'removed' };
  viewer.shouldHighlightWordDiff = () => true;
  const decode = (text) =>
    text.replace(
      /&(amp|lt|gt|quot|#39);/g,
      (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity],
    );
  for (const source of [
    'const text = "&quot; &nbsp; &#39; &#x27; &amp; &lt; &gt;";',
    'const html = "<img src=x onerror=alert(1)>&";',
    'const escaped = "&amp;quot; &amp;amp; 中文";',
  ]) {
    const result = html(
      viewer.renderWordDiff(
        [
          { value: source.slice(0, 6), type: 0 },
          { value: source.slice(6), type: 1 },
        ],
        (text) =>
          createElement('span', {
            dangerouslySetInnerHTML: { __html: highlightLineHTML(text, 'typescript') },
          }),
      ),
    );
    assert.equal(decode(result.replace(/<[^>]+>/g, '')), source);
    assert.match(result, /<ins/);
    assert.match(result, /syntax-string/);
    assert.doesNotMatch(result, /<img/);
  }
});
