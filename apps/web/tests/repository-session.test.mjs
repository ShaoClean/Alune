import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readRepositorySession } from '../src/stores/repositorySession.ts';

const saved = new Map();
globalThis.localStorage = {
  getItem: (key) => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
  removeItem: (key) => saved.delete(key),
};
const { useWorkspaceStore: workspace, hydrateWorkspace } =
  await import('../src/stores/workspaceStore.ts');
const { createRepositoryStore } = await import('../src/stores/repositoryStore.ts');
const { repositoryApi } = await import('../src/api/index.ts');
await hydrateWorkspace();
const repo = (id, source = 'local') => ({ id, source, name: `name-${id}`, path: `/repos/${id}` });
const persisted = () => JSON.parse(saved.get('alune-workspace')).state.repositorySession;
const ids = (store) => store.getState().openRepositories.map((item) => item.id);
const seed = (ids, activeId) => workspace.setState({ repositorySession: { ids, activeId } });

beforeEach(() => {
  workspace.setState(workspace.getInitialState(), true);
  saved.clear();
});

test('legacy and malformed sessions normalize to unique IDs without persisting metadata', () => {
  for (const input of [undefined, null, 1, [], { ids: 'bad' }])
    assert.deepEqual(readRepositorySession(input), { ids: [], activeId: null });
  assert.deepEqual(readRepositorySession({ ids: ['a', '', 2, 'a', 'b'], activeId: 'missing' }), {
    ids: ['a', 'b'],
    activeId: 'a',
  });
  assert.deepEqual(readRepositorySession({ ids: ['a', 'b'], activeId: 'b', path: '/secret' }), {
    ids: ['a', 'b'],
    activeId: 'b',
  });
});

test('open, switch, reorder, single close and batch close save immediately', () => {
  const store = createRepositoryStore();
  for (const id of ['a', 'b', 'c', 'd']) store.getState().openRepository(repo(id));
  assert.deepEqual(persisted(), { ids: ['a', 'b', 'c', 'd'], activeId: 'd' });
  store.getState().setCurrentRepo(repo('b'));
  store.getState().moveOpenRepository('d', 'a', 'before');
  assert.deepEqual(persisted(), { ids: ['d', 'a', 'b', 'c'], activeId: 'b' });
  store.getState().closeRepository('b');
  assert.deepEqual(persisted(), { ids: ['d', 'a', 'c'], activeId: 'c' });
  store.getState().closeRepositories(['a', 'c'], 'd');
  assert.deepEqual(persisted(), { ids: ['d'], activeId: 'd' });
  store.getState().closeRepository('d');
  assert.deepEqual(persisted(), { ids: [], activeId: null });
});

test('a new store restores local, SSH and worktree tabs in saved order without workspace requests', async () => {
  const registry = [repo('local'), repo('ssh', 'ssh'), { ...repo('worktree'), isWorktree: true }];
  seed(['worktree', 'local', 'ssh'], 'local');
  const value = saved.get('alune-workspace');
  workspace.setState(workspace.getInitialState(), true);
  saved.set('alune-workspace', value);
  await workspace.persist.rehydrate();
  repositoryApi.list = async () => registry;
  let requests = 0;
  repositoryApi.get = repositoryApi.status = async () => {
    requests++;
    throw new Error('not needed');
  };
  const store = createRepositoryStore();
  await store.getState().fetchRepositories();
  assert.deepEqual(ids(store), ['worktree', 'local', 'ssh']);
  assert.deepEqual(store.getState().openRepositories, [registry[2], registry[0], registry[1]]);
  assert.equal(persisted().activeId, 'local');
  assert.equal(requests, 0);
  assert.equal(store.getState().currentRepo, null);
});

test('an explicit address wins even before a delayed full list finishes', async () => {
  seed(['a', 'b'], 'a');
  let release;
  repositoryApi.list = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const store = createRepositoryStore();
  const pending = store.getState().fetchRepositories();
  await Promise.resolve();
  store.getState().activateRepositoryTab('c');
  store.getState().setCurrentRepo(repo('c'));
  release([repo('a'), repo('b'), repo('c')]);
  await pending;
  assert.deepEqual(ids(store), ['a', 'b', 'c']);
  assert.deepEqual(persisted(), { ids: ['a', 'b', 'c'], activeId: 'c' });
});

test('list failures and opening one known tab cannot erase unrestored IDs; retry uses fresh names', async () => {
  seed(['a', 'b'], 'b');
  repositoryApi.list = async () => {
    throw new Error('offline');
  };
  const store = createRepositoryStore();
  await store.getState().fetchRepositories();
  assert.equal(store.getState().listLoaded, false);
  assert.deepEqual(persisted(), { ids: ['a', 'b'], activeId: 'b' });
  store.getState().setCurrentRepo(repo('b', 'ssh'));
  assert.deepEqual(persisted().ids, ['a', 'b']);
  repositoryApi.list = async () => [{ ...repo('a'), name: 'renamed' }, repo('b', 'ssh')];
  await store.getState().fetchRepositories();
  assert.deepEqual(ids(store), ['a', 'b']);
  assert.equal(store.getState().openRepositories[0].name, 'renamed');
});

test('only a complete list removes absent registrations and picks right then left neighbors', async () => {
  for (const [remaining, activeId] of [
    [['a', 'c'], 'c'],
    [['a'], 'a'],
    [[], null],
  ]) {
    seed(['a', 'b', 'c'], 'b');
    repositoryApi.list = async () => remaining.map((id) => repo(id));
    const store = createRepositoryStore();
    await store.getState().fetchRepositories('ignored-filter');
    assert.deepEqual(persisted(), { ids: remaining, activeId });
    assert.deepEqual(ids(store), remaining);
    store.getState().setCurrentRepo(repo('b')); // Late detail response cannot resurrect it.
    assert.deepEqual(ids(store), remaining);
  }
});

test('closing all while a list is pending is not undone by its response or another restart', async () => {
  seed(['a', 'b'], 'b');
  let release;
  repositoryApi.list = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const store = createRepositoryStore();
  const pending = store.getState().fetchRepositories();
  await Promise.resolve();
  store.getState().closeRepositories(['a', 'b']);
  release([repo('a'), repo('b')]);
  await pending;
  assert.deepEqual(ids(store), []);
  assert.deepEqual(persisted(), { ids: [], activeId: null });
  repositoryApi.list = async () => [repo('a'), repo('b')];
  const restarted = createRepositoryStore();
  await restarted.getState().fetchRepositories();
  assert.deepEqual(ids(restarted), []);
});

test('forget and delete prune persisted tabs including tabs not yet restored', async () => {
  seed(['a', 'b', 'c'], 'b');
  const store = createRepositoryStore();
  store.getState().forgetRepositories(['b']);
  assert.deepEqual(persisted(), { ids: ['a', 'c'], activeId: 'c' });
  repositoryApi.delete = async () => {};
  await store.getState().deleteRepository('c');
  assert.deepEqual(persisted(), { ids: ['a'], activeId: 'a' });
});

test('an invalid address after registry validation cannot replace the saved active tab', async () => {
  seed(['a', 'b'], 'b');
  repositoryApi.list = async () => [repo('a'), repo('b')];
  const store = createRepositoryStore();
  await store.getState().fetchRepositories();
  store.getState().activateRepositoryTab('not-registered');
  assert.deepEqual(persisted(), { ids: ['a', 'b'], activeId: 'b' });
});
