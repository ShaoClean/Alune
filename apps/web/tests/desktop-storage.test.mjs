import { test } from 'node:test';
import assert from 'node:assert/strict';

let release;
const pending = new Promise((resolve) => { release = resolve; });
const writes = [];
globalThis.window = { remoteGitWorkspace: {
  load: () => pending,
  save: async (value) => { writes.push(value); },
  clear: async () => {},
} };
const { hydrateWorkspace, useWorkspaceStore: workspace } = await import('../src/stores/workspaceStore.ts');
const { useConnectionStore: connections } = await import('../src/stores/connectionStore.ts');
const { useRepositoryStore: repositories } = await import('../src/stores/repositoryStore.ts');
const { connectionApi, repositoryApi } = await import('../src/api/index.ts');
const { createWorkspaceStorage, useWorkspaceStorageStatus } = await import('../src/stores/workspaceStorage.ts');

test('desktop hydration completes before either list can validate saved order', async () => {
  let requests = 0;
  connectionApi.list = async () => { requests++; return [{ id: 'a' }, { id: 'b' }]; };
  repositoryApi.list = async () => { requests++; return [{ id: 'r1', connectionId: 'a' }, { id: 'r2', connectionId: 'a' }]; };
  const ready = hydrateWorkspace();
  const lists = Promise.all([connections.getState().fetchConnections(), repositories.getState().fetchRepositories()]);
  await Promise.resolve();
  assert.equal(requests, 0);
  assert.equal(writes.length, 0);
  release(JSON.stringify({ version: 1, state: {
    connectionOrder: ['b', 'a'], repositoryOrderByConnection: { a: ['r2', 'r1'] },
    collapsedConnectionIds: ['b'],
  } }));
  await ready;
  await lists;
  assert.equal(requests, 2);
  assert.deepEqual(workspace.getState().connectionOrder, ['b', 'a']);
  assert.deepEqual(workspace.getState().repositoryOrderByConnection, { a: ['r2', 'r1'] });
  assert.deepEqual(workspace.getState().collapsedConnectionIds, ['b']);
  assert.deepEqual(repositories.getState().repositories.map((repo) => repo.id), ['r1', 'r2']);
});

test('storage failures are reported without rejecting UI updates, and later writes recover', async () => {
  let fail = true;
  const storage = createWorkspaceStorage({
    load: async () => { throw new Error('read failure'); },
    save: async () => { if (fail) throw new Error('disk full'); },
    clear: async () => { throw new Error('permission denied'); },
  });
  assert.equal(await storage.getItem('remote-git-workspace'), null);
  await storage.setItem('remote-git-workspace', '{}');
  assert.match(useWorkspaceStorageStatus.getState().error, /保存失败/);
  fail = false;
  await storage.setItem('remote-git-workspace', '{}');
  assert.equal(useWorkspaceStorageStatus.getState().error, null);
  await storage.removeItem('remote-git-workspace');
  assert.match(useWorkspaceStorageStatus.getState().error, /清除失败/);
});
