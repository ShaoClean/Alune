import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownPreview, MARKDOWN_PREVIEW_MAX_CHARS } from '../src/components/MarkdownPreview.tsx';
import { FilePreviewPane } from '../src/components/FilesView.tsx';
import { isMarkdownFile, resolveMarkdownResource } from '../src/components/markdown-resources.ts';

const render = (content, props = {}) =>
  renderToStaticMarkup(
    createElement(MarkdownPreview, {
      content,
      path: 'README.md',
      repositoryId: 'fixture',
      onOpenFile() {},
      ...props,
    }),
  );
const pane = (content, props = {}) =>
  renderToStaticMarkup(
    createElement(FilePreviewPane, {
      entry: { name: 'README.MD', path: 'README.MD', kind: 'file' },
      file: {
        phase: 'ready',
        path: 'README.MD',
        preview: {
          path: 'README.MD',
          kind: 'text',
          size: content.length,
          encoding: 'utf-8',
          content,
        },
      },
      onRetry() {},
      ...props,
    }),
  );

test('Markdown renders GFM, Chinese headings and literal fenced/indented code', () => {
  const html = render(
    readFileSync(new URL('./fixtures/markdown-preview.md', import.meta.url), 'utf8'),
  );
  assert.match(html, /<h1 id="file-markdown-markdown-预览">Markdown 预览<\/h1>/);
  for (const fragment of [
    '<strong>粗体</strong>',
    '<em>斜体</em>',
    '<del>删除线</del>',
    '<code>行内代码</code>',
    '<blockquote>',
    '<hr/>',
    '<ol>',
    '<table><thead>',
  ])
    assert.ok(html.includes(fragment), fragment);
  assert.match(html, /<input type="checkbox" disabled="" checked=""\/>/);
  assert.match(html, /<input type="checkbox" disabled=""\/>/);
  assert.match(html, /<pre tabindex="0"><code class="language-markdown"># 这里仍然是源码/);
  assert.match(html, /\*\*literal\*\* \[link\]\(javascript:alert\(1\)\) \| table \|/);
  assert.match(html, /&lt;script&gt;alert\(&#x27;code only&#x27;\)&lt;\/script&gt;/);
  assert.match(html, /<pre tabindex="0"><code># 缩进代码也不会变成标题/);
  assert.match(html, /id="file-markdown-中文标题"/);
  assert.match(html, /id="file-markdown-中文标题-1"/);
  assert.doesNotMatch(html, /<script|<img|onerror|window\.markdownExecuted/);
});

test('heading slugs account for formatting and collisions with explicitly numbered headings', () => {
  const html = render('## **Hello** `world`\n\n## Hello world\n\n## Hello world-1');
  assert.deepEqual(
    [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]),
    ['file-markdown-hello-world', 'file-markdown-hello-world-1', 'file-markdown-hello-world-1-1'],
  );
});

test('Markdown file detection is case insensitive and does not execute MDX', () => {
  for (const path of ['README.md', 'docs/中文.MD', 'readme.Md'])
    assert.equal(isMarkdownFile(path), true);
  for (const path of ['component.mdx', 'readme.md.ts', 'folder.md/file', 'notes.txt'])
    assert.equal(isMarkdownFile(path), false);
  assert.match(pane('# Heading'), /<h1[^>]*>Heading<\/h1>/);
  assert.match(pane('# Heading'), /aria-pressed="true">Preview/);
  const source = pane('# Heading\n\n**literal**', { markdownMode: 'source' });
  assert.match(source, /aria-pressed="true">源码/);
  assert.match(source, /# Heading\n\n\*\*literal\*\*/);
  assert.doesNotMatch(source, /<article|<h1/);
  const plain = pane('# Not a heading', {
    entry: { name: 'notes.txt', path: 'notes.txt', kind: 'file' },
  });
  assert.doesNotMatch(plain, /Markdown 显示模式|<h1|<article/);
  assert.match(plain, /# Not a heading/);
});

test('empty, whitespace, large and failed Markdown retain clear states and complete source', () => {
  assert.match(pane(''), /空文件/);
  assert.match(pane(' \n\t'), /此文件只有空白内容/);
  const large = `# ${'x'.repeat(MARKDOWN_PREVIEW_MAX_CHARS)}`;
  assert.doesNotMatch(pane(large), /请切换到「源码」查看完整内容/);
  assert.ok(pane(large, { markdownMode: 'source' }).includes(large));
  assert.doesNotMatch(
    pane('', { file: { phase: 'error', path: 'README.MD', status: 403, message: 'denied' } }),
    /没有读取权限/,
  );
  assert.doesNotMatch(
    pane('', {
      file: {
        phase: 'ready',
        path: 'README.MD',
        preview: { kind: 'too-large', size: 2000000, limit: 1048576 },
      },
    }),
    /文件过大/,
  );
});

test('repository paths normalize within the worktree, relative to the current document or root', () => {
  const resolve = (url) => resolveMarkdownResource(url, 'docs/nested/guide.md');
  assert.deepEqual(resolve('../图片%20中文.png?raw=1'), {
    kind: 'file',
    path: 'docs/图片 中文.png',
    fragment: '',
  });
  assert.deepEqual(resolve('/README.MD#%E4%B8%AD%E6%96%87'), {
    kind: 'file',
    path: 'README.MD',
    fragment: '中文',
  });
  assert.deepEqual(resolve('./guide.md#details'), {
    kind: 'file',
    path: 'docs/nested/guide.md',
    fragment: 'details',
  });
  assert.deepEqual(resolve('../../LICENSE'), { kind: 'file', path: 'LICENSE', fragment: '' });
  assert.deepEqual(resolve('#hello-world'), { kind: 'anchor', fragment: 'hello-world' });
  assert.deepEqual(resolve(''), { kind: 'anchor', fragment: '' });
  assert.deepEqual(resolve('asset%23%3F.png'), {
    kind: 'file',
    path: 'docs/nested/asset#?.png',
    fragment: '',
  });
});

test('dangerous schemes, encoded traversal, .git, absolute OS paths and malformed URLs are blocked', () => {
  for (const url of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html;base64,eA==',
    'file:///etc/passwd',
    'vscode://file/etc/passwd',
    'mailto:user@example.com',
    '//example.com/a',
    'C:/windows/system.ini',
    'C:\\windows\\system.ini',
    '../../../outside',
    '%2e%2e/%2e%2e/%2e%2e/outside',
    '/.Git/config',
    '../../%2egit/config',
    'a%2fb.png',
    'a%5cb.png',
    'java%0ascript:foo',
    '%6aavascript%3aalert(1)',
    'bad%00.png',
    'bad%7f.png',
    'bad%zz.png',
    'a.png#bad%zz',
  ])
    assert.equal(resolveMarkdownResource(url, 'docs/nested/guide.md').kind, 'blocked', url);
  for (const url of [
    'javascript&colon;alert%281%29',
    'jav&#x61;script:alert%281%29',
    'java&#x09;script:alert%281%29',
  ])
    assert.doesNotMatch(render(`[unsafe](${url})`), /<a\b/, url);
});

test('external links are HTTP(S) only; image rendering starts with explicit, readable fallbacks', () => {
  const html = render(
    '[web](https://example.com/page)\n\n![remote](https://example.invalid/tracker.png)\n\n![vector](vector.svg)\n\n![unsafe](javascript:alert%281%29)',
  );
  assert.match(
    html,
    /href="https:\/\/example.com\/page" target="_blank" rel="noopener noreferrer"/,
  );
  assert.match(html, /加载外部图片/);
  assert.match(html, /remote：外部图片（example.invalid）/);
  assert.match(html, /暂不支持此图片格式/);
  assert.match(html, /仅支持 HTTP\(S\) 链接/);
  assert.doesNotMatch(html, /<img|src=|href="javascript/);
  const local = render('[guide](docs/guide.MD#中文标题)\n\n![local](assets/sample.png)');
  assert.match(local, /title="docs\/guide.MD"/);
  assert.match(local, /local：正在读取图片/);
});
