import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { createRepositoryStore } = await import('../src/stores/repositoryStore.ts');
const { repositoryApi } = await import('../src/api/index.ts');
test('simultaneous list failures remain owned by their panels and each successful retry clears only its own error', async () => {
  const store = createRepositoryStore(),
    original = {
      branches: repositoryApi.branches,
      stashes: repositoryApi.stashes,
      remotes: repositoryApi.remotes,
    };
  store.getState().openRepository({ id: 'one', name: 'one', path: '/repo' });
  store.getState().activateWorkspace('one');
  try {
    for (const name of Object.keys(original))
      repositoryApi[name] = async () => {
        throw new Error(name + ' failed');
      };
    await Promise.all([
      store.getState().fetchBranches('one'),
      store.getState().fetchStashes('one'),
      store.getState().fetchRemotes('one'),
    ]);
    assert.deepEqual(store.getState().workspaces.one.panelErrors, {
      branches: 'branches failed',
      stashes: 'stashes failed',
      remotes: 'remotes failed',
    });
    repositoryApi.remotes = async () => [{ name: 'origin' }];
    await store.getState().fetchRemotes('one');
    assert.deepEqual(store.getState().workspaces.one.panelErrors, {
      branches: 'branches failed',
      stashes: 'stashes failed',
      remotes: null,
    });
    let rejectOld;
    repositoryApi.branches = () =>
      new Promise((_ok, reject) => {
        rejectOld = reject;
      });
    const pending = store.getState().fetchBranches('one');
    repositoryApi.branches = async () => [{ name: 'main' }];
    await store.getState().fetchBranches('one');
    rejectOld(new Error('obsolete branch failure'));
    await pending;
    assert.deepEqual(store.getState().workspaces.one.panelErrors, {
      branches: null,
      stashes: 'stashes failed',
      remotes: null,
    });
    assert.equal(store.getState().workspaces.one.branches[0].name, 'main');
  } finally {
    Object.assign(repositoryApi, original);
  }
});
