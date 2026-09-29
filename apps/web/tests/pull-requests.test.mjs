import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultPullRequestRemote, PullRequestRow } from '../src/components/PullRequestsView.tsx';
import {
  DiscussionThread,
  mergeDiscussions,
  PullRequestPatch,
} from '../src/components/PullRequestDetails.tsx';

test('origin is selected explicitly before another platform; invalid remotes have a usable fallback', () => {
  const upstream = { name: 'upstream', provider: 'gitlab' };
  const origin = { name: 'origin', provider: 'github' };
  const local = { name: 'local', provider: null, unavailableReason: 'local path' };
  assert.equal(defaultPullRequestRemote([upstream, origin]), 'origin');
  assert.equal(defaultPullRequestRemote([local, upstream]), 'upstream');
  assert.equal(defaultPullRequestRemote([{ ...local, name: 'origin' }, upstream]), 'upstream');
  assert.equal(defaultPullRequestRemote([{ name: 'origin', provider: null }, upstream]), 'origin');
  assert.equal(defaultPullRequestRemote([]), '');
});

test('list titles open details with a separate external link and escape untrusted titles', () => {
  const item = {
    number: 98,
    title: '<script>not markup</script>',
    url: 'https://github.com/team/repo/pull/98',
    state: 'open',
    draft: true,
    author: 'alice',
    sourceBranch: 'fork:feature',
    targetBranch: 'main',
    updatedAt: '2026-09-26T08:00:00Z',
  };
  const html = renderToStaticMarkup(createElement(PullRequestRow, { item, provider: 'github' }));
  assert.match(html, /&lt;script&gt;not markup&lt;\/script&gt;/);
  for (const text of ['开放中', '草稿', '#98', 'alice', 'fork:feature', 'main', '更新于'])
    assert.ok(html.includes(text));
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /aria-label="在浏览器中打开"/);
  assert.match(html, /<button[^>]*pull-request-row__open[^>]*>&lt;script&gt;not markup/);
  const merged = renderToStaticMarkup(
    createElement(PullRequestRow, {
      item: { ...item, state: 'merged', draft: false },
      provider: 'gitlab',
    }),
  );
  assert.match(merged, /已合并/);
  assert.match(merged, /!98/);
  assert.doesNotMatch(merged, /草稿/);
  const closed = renderToStaticMarkup(
    createElement(PullRequestRow, {
      item: { ...item, state: 'closed', sourceBranch: '' },
      provider: 'github',
    }),
  );
  assert.match(closed, /已关闭/);
  assert.match(closed, /已删除分支/);
});

test('discussion replies merge across pages without duplicates and retain code context', () => {
  const comment = {
    id: '1',
    author: 'alice',
    body: '**Looks good** <script>alert(1)</script>\n\n[unsafe](javascript:alert(1))',
    createdAt: '2026-09-29T00:00:00Z',
    system: false,
    context: {
      path: 'src/old.ts',
      oldLine: 42,
      outdated: true,
      patch: '@@ -42 +42 @@\n-old\n+new',
    },
  };
  const reply = { ...comment, id: '2', author: 'bob', replyTo: '1', body: 'Fixed' };
  const threads = mergeDiscussions([
    { id: 'code:1', comments: [comment] },
    { id: 'code:1', comments: [reply] },
    { id: 'code:1', comments: [reply] },
  ]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].comments.length, 2);
  const html = renderToStaticMarkup(
    createElement(DiscussionThread, { thread: { ...threads[0], resolved: true } }),
  );
  for (const value of [
    'alice',
    'bob',
    '旧行 42',
    '旧版本代码',
    'src/old.ts',
    '回复评论 #1',
    '已解决',
    '<strong>Looks good</strong>',
    'Fixed',
  ])
    assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /<script|href="javascript:/);
});

test('unified patches preserve real line numbers across hunks and escape code', () => {
  const html = renderToStaticMarkup(
    createElement(PullRequestPatch, {
      patch:
        '@@ -12,2 +18,2 @@\n context\n-old\n+<script>new</script>\n@@ -50 +60 @@\n-before\n+after',
    }),
  );
  for (const number of [12, 13, 18, 19, 50, 60]) assert.match(html, new RegExp(`>${number}</td>`));
  assert.match(html, /pull-request-patch__add/);
  assert.match(html, /pull-request-patch__remove/);
  assert.match(html, /&lt;script&gt;new&lt;\/script&gt;/);
});
