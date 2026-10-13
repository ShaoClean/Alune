import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUIET_OPERATIONS } from '../src/components/GitOperationNotice.tsx';
import { useSyncStatusStore } from '../src/stores/syncStatusStore.ts';

test('暂存、取消暂存、拉取、推送不弹出进行中提示，其他 Git 操作保持原样', () => {
  for (const kind of ['stage', 'unstage', 'pull', 'push']) assert.ok(QUIET_OPERATIONS.has(kind));
  for (const kind of ['fetch', 'merge', 'rebase', 'commit', 'push-tag', 'submodule-update'])
    assert.ok(!QUIET_OPERATIONS.has(kind));
});

test('同步进度只写入发起同步的仓库，结束后清空', () => {
  const store = useSyncStatusStore.getState();
  store.setProgress('repo-a', 'Uploading LFS objects: 50%');
  assert.equal(useSyncStatusStore.getState().progress, null);
  store.startSync('repo-a', 'push');
  store.setProgress('repo-b', 'Downloading LFS objects: 10%');
  assert.equal(useSyncStatusStore.getState().progress, null);
  store.setProgress('repo-a', 'Uploading LFS objects: 50%');
  assert.equal(useSyncStatusStore.getState().progress, 'Uploading LFS objects: 50%');
  store.finishSync('repo-a');
  assert.equal(useSyncStatusStore.getState().progress, null);
});
