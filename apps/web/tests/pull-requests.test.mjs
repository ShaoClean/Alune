import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultPullRequestRemote, PullRequestRow } from '../src/components/PullRequestsView.tsx';

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

test('list rows expose statuses, draft, branches and accessible external links without interpreting HTML', () => {
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
