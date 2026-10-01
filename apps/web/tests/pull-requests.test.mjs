import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultPullRequestRemote, PullRequestRow } from '../src/components/PullRequestsView.tsx';
import {
  DiscussionThread,
  mergeDiscussions,
  PullRequestPatch,
  ReviewLineGuidance,
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

test('review line buttons expose the selected side/range and disable writes while pending', () => {
  const html = renderToStaticMarkup(
    createElement(PullRequestPatch, {
      patch: '@@ -3,2 +3,3 @@\n context\n-old\n+new\n+next',
      selection: { path: 'a.ts', side: 'RIGHT', startLine: 4, endLine: 5, filePage: 1 },
      onSelect() {},
      disabled: true,
    }),
  );
  assert.match(html, /aria-label="旧行 4，评论不可用" aria-pressed="false"/);
  assert.match(html, /aria-label="新行 4，评论不可用" aria-pressed="true"/);
  assert.match(html, /aria-label="新行 5，评论不可用" aria-pressed="true"/);
  assert.equal((html.match(/<button[^>]*disabled=""/g) || []).length, 5);
  const enabled = renderToStaticMarkup(
    createElement(PullRequestPatch, {
      patch: '@@ -1 +1 @@\n-old\n+new',
      onSelect() {},
    }),
  );
  assert.match(enabled, /aria-label="新行 1，点击评论，Shift 点击选择多行"/);
  assert.doesNotMatch(enabled, /disabled=""/);
});

test('file diff explains why line comments are unavailable and only shows selection instructions when allowed', () => {
  const render = ({ review: reviewChanges = {}, ...props } = {}) =>
    renderToStaticMarkup(
      createElement(ReviewLineGuidance, {
        revision: 'revision-1',
        review: {
          loading: false,
          pending: false,
          error: '',
          actions: { comment: { allowed: true } },
          load() {},
          ...reviewChanges,
        },
        ...props,
      }),
    );
  const allowed = render();
  assert.match(allowed, /点击新行或旧行的行号评论/);
  const unauthenticated = render({
    review: {
      actions: { comment: { allowed: false, reason: '请配置有写入权限的访问令牌。' } },
    },
  });
  assert.match(unauthenticated, /评论不可用：请配置有写入权限的访问令牌/);
  assert.match(unauthenticated, /返回 PR\/MR 列表.*应用到此仓库/);
  const locked = render({
    review: {
      actions: { comment: { allowed: false, reason: '讨论已锁定，当前用户不能发表评论。' } },
    },
  });
  assert.match(locked, /评论不可用：讨论已锁定/);
  assert.doesNotMatch(locked, /应用到此仓库/);
  const loading = render({ review: { loading: true } });
  assert.match(loading, /正在检查评论权限/);
  const failed = render({ review: { error: '网络错误', actions: undefined } });
  assert.match(failed, /评论权限检查失败：网络错误/);
  assert.match(failed, /重\s*试/);
  for (const blocked of [unauthenticated, locked, loading, failed])
    assert.doesNotMatch(blocked, /点击新行或旧行的行号评论/);
  assert.match(render({ review: { pending: true } }), /正在执行 Review 操作/);
  assert.match(render({ fileNotice: '部分 Diff 缺失' }), /此 Diff 不完整/);
});
