import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
const { createRepositoryStore } = await import('../src/stores/repositoryStore.ts');
const { useWorkspaceStore: workspace } = await import('../src/stores/workspaceStore.ts');
const { repositoryApi } = await import('../src/api/index.ts');
const { useCommitDraftStore: drafts } = await import('../src/stores/commitDraftStore.ts');
const { LOCAL_GROUP_ID } = await import('../src/stores/repositorySource.ts');
const local = { id: 'local-repo', source: 'local', path: '/same/path', name: 'same' };
const remote = {
  id: 'remote-repo',
  connectionId: 'host',
  source: 'ssh',
  path: '/same/path',
  name: 'same',
};
let store;
beforeEach(() => {
  store = createRepositoryStore();
  workspace.setState(workspace.getInitialState(), true);
  drafts.setState({ drafts: {}, generations: {}, undo: {} });
  repositoryApi.addLocal = async () => local;
  repositoryApi.list = async () => [local, remote];
});

test('local groups survive connection reconciliation, reload and removal of a remote host', async () => {
  await store.getState().fetchRepositories();
  workspace.getState().reconcileConnections(['host']);
  assert.deepEqual(workspace.getState().repositoryOrderByConnection[LOCAL_GROUP_ID], [local.id]);
  workspace.getState().setConnectionCollapsed(LOCAL_GROUP_ID, true);
  workspace.getState().reconcileConnections([]);
  assert(workspace.getState().collapsedConnectionIds.includes(LOCAL_GROUP_ID));
  assert.deepEqual(workspace.getState().repositoryOrderByConnection[LOCAL_GROUP_ID], [local.id]);
  workspace.getState().reconcileRepositories([local]);
  assert.deepEqual(workspace.getState().repositoryOrderByConnection[LOCAL_GROUP_ID], [local.id]);
  await workspace.persist.rehydrate();
  assert.deepEqual(workspace.getState().repositoryOrderByConnection[LOCAL_GROUP_ID], [local.id]);
});

test('same-name local and SSH repositories isolate drafts; closing a local tab preserves registration', async () => {
  await store.getState().fetchRepositories();
  const added = await store.getState().addLocalRepository(local.path);
  await store.getState().addLocalRepository(local.path);
  store.getState().openRepository(added);
  store.getState().openRepository(remote);
  assert.equal(store.getState().repositories.length, 2);
  drafts.getState().updateDraft(local.id, { message: 'local draft' });
  drafts.getState().updateDraft(remote.id, { message: 'remote draft' });
  store.getState().closeRepository(local.id);
  assert.equal(store.getState().repositories.length, 2);
  assert.equal(drafts.getState().drafts[local.id].message, 'local draft');
  assert.equal(drafts.getState().drafts[remote.id].message, 'remote draft');
  store.getState().forgetRepositories([local.id]);
  assert.deepEqual(
    store.getState().repositories.map((repo) => repo.id),
    [remote.id],
  );
  assert.deepEqual(
    store.getState().openRepositories.map((repo) => repo.id),
    [remote.id],
  );
});

test('registering a local repository while a stale registry load is pending preserves the new entry', async () => {
  let finish;
  let calls = 0;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  repositoryApi.list = () => (++calls === 1 ? pending : Promise.resolve([local, remote]));
  const loading = store.getState().fetchRepositories();
  await new Promise((resolve) => setImmediate(resolve));
  await store.getState().addLocalRepository(local.path);
  finish([remote]);
  await loading;
  assert.equal(calls, 2);
  assert.deepEqual(
    store.getState().repositories.map((repo) => repo.id),
    [local.id, remote.id],
  );
});
