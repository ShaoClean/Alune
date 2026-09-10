import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReleaseNotes } from '../src/components/ReleaseNotes.tsx';

const render = (notes) => renderToStaticMarkup(createElement(ReleaseNotes, { notes }));

test('release notes render Markdown, nested lists and GFM tables without interpreting code', () => {
  const html = render(readFileSync(new URL('./fixtures/update-notes.md', import.meta.url), 'utf8'));
  assert.match(html, /<h1>RemoteGit v0\.2\.1<\/h1>/);
  assert.match(html, /<h2>新功能<\/h2>/);
  assert.match(html, /<strong>版本更新体验<\/strong>/);
  assert.match(html, /<em>长内容阅读<\/em>/);
  assert.match(html, /<ul>[\s\S]*<li>[\s\S]*<ul>/);
  assert.match(html, /<ol>[\s\S]*<li>[\s\S]*<ol>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<del>直接展示 Markdown 原文<\/del>/);
  assert.match(html, /<code>行内代码<\/code>/);
  assert.match(
    html,
    /<pre tabindex="0"><code class="language-sh"># This is a code comment, not a heading/,
  );
  assert.match(html, /\*\*literal\*\* \[link\]\(https:\/\/example\.com\) \| table \|/);
  assert.match(html, /<table><thead>[\s\S]*<tbody>/);
  assert.match(html, /<th style="text-align:center">安装方式<\/th>/);
  assert.match(html, /<input type="checkbox" disabled="" checked=""\/>/);
  assert.match(
    html,
    /href="https:\/\/github\.com\/ShaoClean\/remote-git\/compare\/v0\.2\.0\.\.\.v0\.2\.1" target="_blank" rel="noopener noreferrer"/,
  );
});

test('empty or whitespace notes keep the placeholder and plain text stays readable', () => {
  for (const notes of ['', '  \n\t ']) assert.match(render(notes), /此版本未提供更新说明。/);
  assert.match(
    render('修复连接问题。\n\n保留现有操作。'),
    /<p>修复连接问题。<\/p>\n<p>保留现有操作。<\/p>/,
  );
  assert.match(render('    **indented code**'), /<code>\*\*indented code\*\*/);
});

test('raw HTML is ignored and Markdown images cannot load external resources', () => {
  const html = render(
    [
      '<script>alert("xss")</script>',
      '<iframe src="https://example.com"></iframe>',
      '<img src=x onerror="alert(1)">',
      '<a href="https://example.com" onclick="alert(1)">raw link</a>',
      '![Image description](https://example.com/tracker.png)',
      'Safe **text**',
    ].join('\n\n'),
  );
  assert.doesNotMatch(html, /<script|<iframe|<img|onclick|onerror|tracker\.png|alert\(/);
  assert.match(html, /Image description/);
  assert.match(html, /<strong>text<\/strong>/);
});

test('only absolute HTTP(S) links are interactive, including reference links and autolinks', () => {
  for (const target of [
    'javascript:alert%281%29',
    'JaVaScRiPt:alert%281%29',
    'javascript&colon;alert%281%29',
    'jav&#x61;script:alert%281%29',
    'java&#x09;script:alert%281%29',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///tmp/installer',
    'mailto:user@example.com',
    'vscode://file/tmp/test',
    '//example.com/notes',
    '/relative',
    '#heading',
  ]) {
    const html = render(`[label](${target})`);
    assert.doesNotMatch(html, /<a\b/, target);
    assert.match(html, /label/);
  }
  const html = render(
    '[reference][release]\n\n[release]: https://example.com/notes\n\n<http://example.com/changes>',
  );
  assert.match(html, /href="https:\/\/example\.com\/notes"/);
  assert.match(html, /href="http:\/\/example\.com\/changes"/);
});
