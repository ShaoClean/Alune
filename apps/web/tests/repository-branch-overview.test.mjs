import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPOSITORY_STATUS_CACHE_MS } from '@alune/shared';
import {
  groupBranchRepositories,
  repositoryBranchSummary,
} from '../src/stores/repositoryBranchOverview.ts';

const now = 200000;
const entry = (data = {}, extra = {}) => ({
  phase: 'success',
  updatedAt: now,
  data: { branch: 'main', files: [], ahead: 0, behind: 0, upstream: 'origin/main', ...data },
  ...extra,
});
test('unknown, pending, detached and unborn branches remain distinct', () => {
  assert.equal(repositoryBranchSummary(undefined, undefined, now).kind, 'unknown');
  assert.equal(repositoryBranchSummary({ phase: 'queued' }, undefined, now).branch, '正在读取…');
  assert.equal(repositoryBranchSummary(entry({ branch: 'HEAD' }), undefined, now).kind, 'detached');
  const unborn = repositoryBranchSummary(
    entry({ branch: 'new-project', unborn: true }),
    undefined,
    now,
  );
  assert.equal(unborn.branch, 'new-project');
  assert.equal(unborn.kind, 'unborn');
  assert.equal(unborn.note, '未首次提交');
});
test('expired, failed and offline reads retain the branch without presenting old worktree metrics as current', () => {
  for (const [cached, connection, time] of [
    [entry(), undefined, now + REPOSITORY_STATUS_CACHE_MS],
    [entry({}, { phase: 'error', error: 'timeout' }), undefined, now],
    [entry(), { status: 'disconnected' }, now],
    [entry({}, { updatedAt: undefined }), undefined, now],
  ]) {
    const summary = repositoryBranchSummary(cached, connection, time);
    assert.equal(summary.branch, 'main');
    assert.equal(summary.stale, true);
    assert.equal(summary.changedFiles, undefined);
    assert.equal(summary.sync, '未知');
    assert.match(summary.note, /缓存/);
  }
});
test('refreshing preserves a usable branch and counts each changed file once', () => {
  const summary = repositoryBranchSummary(
    entry(
      {
        files: [
          { path: 'a', staged: true },
          { path: 'a', staged: false },
        ],
        ahead: 2,
        behind: 1,
      },
      { phase: 'loading' },
    ),
    undefined,
    now,
  );
  assert.equal(summary.branch, 'main');
  assert.equal(summary.note, '更新中');
  assert.equal(summary.changedFiles, 1);
  assert.equal(summary.sync, '↑2 ↓1');
});
test('grouping retains same-name worktrees and orphaned sources and searches current status branches', () => {
  const repos = [
    { id: 'one', name: 'alune', source: 'local', path: '/main' },
    { id: 'two', name: 'alune', source: 'local', path: '/review', worktreeKind: 'linked' },
    { id: 'three', name: 'alune', connectionId: 'dev', path: '/srv/alune' },
    { id: 'four', name: 'orphan', connectionId: 'missing', path: '/srv/orphan' },
  ];
  const connections = [{ id: 'dev', name: '开发服务器' }];
  assert.deepEqual(
    groupBranchRepositories(repos, connections, {}, '').map((group) => group.repositories.length),
    [2, 1, 1],
  );
  const found = groupBranchRepositories(
    repos,
    connections,
    { two: entry({ branch: 'feature/review' }) },
    'FEATURE/REVIEW',
  );
  assert.equal(found[0].repositories[0].id, 'two');
  assert.equal(
    groupBranchRepositories(repos, connections, {}, 'alune', 'dev')[0].repositories.length,
    1,
  );
  assert.deepEqual(groupBranchRepositories(repos, connections, {}, 'not-found'), []);
});
