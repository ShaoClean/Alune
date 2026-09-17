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
const parent = { id: 'parent', connectionId: 'ssh', name: 'main', path: '/main' };
const target = { id: 'worktree', connectionId: 'ssh', name: 'feature', path: '/feature' };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
let store;
beforeEach(() => {
  store = createRepositoryStore();
  workspace.setState(workspace.getInitialState(), true);
  drafts.setState({ drafts: {}, generations: {}, undo: {} });
  repositoryApi.openWorktree = async () => target;
  repositoryApi.list = async () => [parent];
});

test('registration and tabs deduplicate, closing keeps registration and independent drafts', async () => {
  await store.getState().fetchRepositories();
  store.getState().openRepository(parent);
  await Promise.all([
    store.getState().addWorktree(parent.id, target.path),
    store.getState().addWorktree(parent.id, target.path),
  ]);
  assert.equal(store.getState().currentRepo.id, parent.id, 'late registration must not navigate');
  store.getState().openRepository(target);
  store.getState().openRepository(target);
  assert.equal(store.getState().repositories.length, 2);
  assert.equal(store.getState().openRepositories.length, 2);
  assert.deepEqual(workspace.getState().repositoryOrderByConnection.ssh, ['parent', 'worktree']);
  drafts.getState().updateDraft(parent.id, { message: 'main draft' });
  drafts.getState().updateDraft(target.id, { message: 'feature draft' });
  store.getState().closeRepository(target.id);
  assert.equal(store.getState().repositories.length, 2);
  assert.equal(drafts.getState().drafts.parent.message, 'main draft');
  assert.equal(drafts.getState().drafts.worktree.message, 'feature draft');
});

test('a stale registry response cannot prune a worktree opened while refresh was pending', async () => {
  const pending = deferred();
  let calls = 0;
  repositoryApi.list = () => (++calls === 1 ? pending.promise : Promise.resolve([parent, target]));
  const refresh = store.getState().fetchRepositories();
  await flush();
  await store.getState().addWorktree(parent.id, target.path);
  pending.resolve([parent]);
  await refresh;
  assert.equal(calls, 2);
  assert.deepEqual(
    store.getState().repositories.map((repo) => repo.id),
    ['parent', 'worktree'],
  );
});

test('out-of-order Diff and status never overwrite the active worktree', async () => {
  const oldStatus = deferred();
  const oldDiff = deferred();
  repositoryApi.status = (id) =>
    id === parent.id
      ? oldStatus.promise
      : Promise.resolve({ branch: 'feature', files: [], ahead: 0, behind: 0 });
  repositoryApi.diff = (id) =>
    id === parent.id ? oldDiff.promise : Promise.resolve('feature diff');
  store.getState().resetWorkspace(parent.id);
  const status = store.getState().fetchStatus(parent.id);
  const diff = store.getState().fetchDiff(parent.id, { file: 'same.txt' });
  await flush();
  store.getState().resetWorkspace(target.id);
  await store.getState().fetchStatus(target.id);
  await store.getState().fetchDiff(target.id, { file: 'same.txt' });
  oldStatus.resolve({ branch: 'main', files: [], ahead: 0, behind: 0 });
  oldDiff.resolve('main diff');
  await Promise.all([status, diff]);
  await flush();
  assert.equal(store.getState().status.branch, 'feature');
  assert.equal(store.getState().diff, 'feature diff');
});
