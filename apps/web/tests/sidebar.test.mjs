import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
const { useWorkspaceStore: workspace, hydrateWorkspace } = await import('../src/stores/workspaceStore.ts');
const { useRepositoryStore: repositories } = await import('../src/stores/repositoryStore.ts');
const { useConnectionStore: connections } = await import('../src/stores/connectionStore.ts');
const { repositoryApi, connectionApi } = await import('../src/api/index.ts');
await hydrateWorkspace();
const repo = (id, connectionId = 'a') => ({ id, connectionId, name: id, path: `/repos/${id}` });
const connectionItem = (id) => ({ kind: 'connection', id });
const repositoryItem = (id, connectionId = 'a') => ({ kind: 'repository', id, connectionId });
const seed = () => {
  workspace.getState().reconcileConnections(['a', 'b', 'c']);
  workspace.getState().reconcileRepositories([repo('a1'), repo('a2'), repo('a3'), repo('b1', 'b')]);
};

beforeEach(() => {
  workspace.setState(workspace.getInitialState(), true);
  repositories.setState(repositories.getInitialState(), true);
  connections.setState(connections.getInitialState(), true);
  storage.clear();
});

test('connection folds are independent and survive root folding and hydration', async () => {
  seed();
  const state = workspace.getState();
  assert.deepEqual(state.collapsedConnectionIds, []);
  state.setConnectionCollapsed('a', true);
  state.setConnectionCollapsed('b', true);
  state.setConnectionCollapsed('a', false);
  state.setTreeOpen(false);
  state.setTreeOpen(true);
  const saved = storage.get('remote-git-workspace');
  workspace.setState(workspace.getInitialState(), true);
  storage.set('remote-git-workspace', saved);
  await workspace.persist.rehydrate();
  assert.deepEqual(workspace.getState().collapsedConnectionIds, ['b']);
  assert.equal(workspace.getState().treeOpen, true);
});

test('both levels reorder without changing open tabs, selection or repository ownership', () => {
  seed();
  const state = workspace.getState();
  repositories.getState().openRepository(repo('a1'));
  repositories.getState().openRepository(repo('b1', 'b'));
  state.moveTreeItem(connectionItem('c'), connectionItem('a'), 'before');
  state.moveTreeItem(repositoryItem('a3'), repositoryItem('a1'), 'before');
  state.moveTreeItem(repositoryItem('a1'), repositoryItem('a2'), 'after');
  assert.deepEqual(workspace.getState().connectionOrder, ['c', 'a', 'b']);
  assert.deepEqual(workspace.getState().repositoryOrderByConnection, { a: ['a3', 'a2', 'a1'], b: ['b1'] });
  assert.deepEqual(repositories.getState().openRepositories.map((repo) => repo.id), ['a1', 'b1']);
  assert.equal(repositories.getState().currentRepo.id, 'b1');
});

test('cross-connection, mixed-level, missing and self drops do not alter saved order', () => {
  seed();
  const saved = storage.get('remote-git-workspace');
  const state = workspace.getState();
  for (const [source, target] of [
    [repositoryItem('a1'), repositoryItem('b1', 'b')],
    [connectionItem('a'), repositoryItem('a1')],
    [repositoryItem('missing'), repositoryItem('a1')],
    [connectionItem('a'), connectionItem('a')],
  ]) assert.equal(state.moveTreeItem(source, target, 'after'), false);
  assert.equal(storage.get('remote-git-workspace'), saved);
});

test('refresh preserves custom order, appends new items and removes confirmed missing IDs', () => {
  seed();
  const state = workspace.getState();
  state.moveTreeItem(connectionItem('c'), connectionItem('a'), 'before');
  state.moveTreeItem(repositoryItem('a3'), repositoryItem('a1'), 'before');
  state.setConnectionCollapsed('b', true);
  state.reconcileRepositories([repo('a2'), repo('a3'), repo('a4'), repo('b1', 'b')]);
  state.reconcileConnections(['a', 'c', 'd']);
  assert.deepEqual(workspace.getState().connectionOrder, ['c', 'a', 'd']);
  assert.deepEqual(workspace.getState().repositoryOrderByConnection, { a: ['a3', 'a2', 'a4'] });
  assert.deepEqual(workspace.getState().collapsedConnectionIds, []);
  // Repository replies cannot recreate preferences for a deleted connection.
  state.reconcileRepositories([repo('a3'), repo('b1', 'b')]);
  assert.deepEqual(workspace.getState().repositoryOrderByConnection, { a: ['a3'] });
});

test('individual create and delete update only the affected preferences', () => {
  seed();
  const state = workspace.getState();
  state.addConnection('d');
  state.addRepository(repo('a4'));
  state.removeRepository('a2');
  state.setConnectionCollapsed('b', true);
  state.removeConnection('b');
  assert.deepEqual(workspace.getState().connectionOrder, ['a', 'c', 'd']);
  assert.deepEqual(workspace.getState().repositoryOrderByConnection, { a: ['a1', 'a3', 'a4'] });
  assert.deepEqual(workspace.getState().collapsedConnectionIds, []);
});

test('failed list requests preserve all sidebar settings', async () => {
  seed();
  workspace.getState().setConnectionCollapsed('a', true);
  const saved = storage.get('remote-git-workspace');
  repositoryApi.list = connectionApi.list = async () => { throw new Error('offline'); };
  await Promise.all([repositories.getState().fetchRepositories(), connections.getState().fetchConnections()]);
  assert.equal(storage.get('remote-git-workspace'), saved);
});

test('page filtering uses a full registry and cannot erase another connection order', async () => {
  seed();
  workspace.getState().moveTreeItem(repositoryItem('a3'), repositoryItem('a1'), 'before');
  let calls = 0;
  repositoryApi.list = async (...args) => {
    assert.deepEqual(args, []);
    calls++;
    return [repo('a1'), repo('a2'), repo('a3'), repo('b1', 'b')];
  };
  await Promise.all([repositories.getState().fetchRepositories('a'), repositories.getState().fetchRepositories('b')]);
  assert.equal(calls, 1);
  assert.deepEqual(workspace.getState().repositoryOrderByConnection, { a: ['a3', 'a1', 'a2'], b: ['b1'] });
});

test('a repository list started before deletion cannot restore the removed ordering entry', async () => {
  seed();
  let resolveList;
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  const pending = new Promise((resolve) => { resolveList = resolve; });
  let calls = 0;
  repositoryApi.list = async () => { if (++calls === 1) { started(); return pending; } return [repo('a1'), repo('a3')]; };
  repositoryApi.delete = async () => {};
  const refresh = repositories.getState().fetchRepositories();
  await began;
  await repositories.getState().deleteRepository('a2');
  resolveList([repo('a1'), repo('a2'), repo('a3')]);
  await refresh;
  assert.equal(calls, 2);
  assert.deepEqual(workspace.getState().repositoryOrderByConnection, { a: ['a1', 'a3'] });
});

test('legacy and malformed preferences normalize sidebar data without restoring unrelated state', async () => {
  storage.set('remote-git-workspace', JSON.stringify({ version: 1, state: {
    openRepositoryIds: ['a1', 'a1', 7], panels: { a1: 'history' },
    drafts: { a1: { message: 'draft', description: 'body' } },
    connectionOrder: ['b', 2, 'b', 'a'], collapsedConnectionIds: 'bad',
    repositoryOrderByConnection: { a: ['a2', false, 'a2'], b: null },
    status: { files: [] }, setPanel: 'invalid',
  } }));
  await workspace.persist.rehydrate();
  assert.deepEqual(workspace.getState().connectionOrder, ['b', 'a']);
  assert.deepEqual(workspace.getState().repositoryOrderByConnection, { a: ['a2'] });
  assert.deepEqual(workspace.getState().collapsedConnectionIds, []);
  assert.equal(workspace.getState().openRepositoryIds, undefined);
  assert.equal(workspace.getState().panels, undefined);
  assert.equal(workspace.getState().drafts, undefined);
  assert.equal(workspace.getState().status, undefined);
  assert.equal(workspace.getState().setPanel, undefined);
  workspace.setState(workspace.getInitialState(), true);
  storage.set('remote-git-workspace', '{broken');
  await workspace.persist.rehydrate();
  assert.deepEqual(workspace.getState().connectionOrder, []);
});

test('repository validation keeps live metadata separate from persisted preferences', async () => {
  repositoryApi.list = async () => [{ ...repo('a1'), name: 'renamed', isDirty: true }];
  await repositories.getState().fetchRepositories();
  assert.deepEqual(workspace.getState().repositoryOrderByConnection, { a: ['a1'] });
  assert.equal(repositories.getState().repositories[0].name, 'renamed');
  const saved = JSON.parse(storage.get('remote-git-workspace')).state;
  assert.equal(saved.validatedConnectionIds, undefined);
  assert.equal(saved.repositories, undefined);
  assert.equal(saved.isDirty, undefined);
  assert.equal(saved.openRepositoryIds, undefined);
});

test('a connection list started before deletion cannot resurrect a removed group', async () => {
  seed();
  let resolveList;
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  const pending = new Promise((resolve) => { resolveList = resolve; });
  let calls = 0;
  connectionApi.list = async () => { if (++calls === 1) { started(); return pending; } return [{ id: 'a' }, { id: 'c' }]; };
  connectionApi.delete = async () => {};
  const refresh = connections.getState().fetchConnections();
  await began;
  await connections.getState().deleteConnection('b');
  resolveList([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  await refresh;
  assert.equal(calls, 2);
  assert.deepEqual(workspace.getState().connectionOrder, ['a', 'c']);
});
