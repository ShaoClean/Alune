import { test } from 'node:test';
import assert from 'node:assert/strict';

const saved = new Map();
globalThis.localStorage = {
  getItem: (key) => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
};
const { useWorkspaceStore: workspace } = await import('../src/stores/workspaceStore.ts');

test('old and malformed preferences default each collection to cards independently', async () => {
  for (const [collectionViews, expected] of [
    [undefined, { repositories: 'grid', connections: 'grid' }],
    [null, { repositories: 'grid', connections: 'grid' }],
    [[], { repositories: 'grid', connections: 'grid' }],
    [
      { repositories: 'list', connections: 'table' },
      { repositories: 'list', connections: 'grid' },
    ],
    [
      { repositories: true, connections: 'list' },
      { repositories: 'grid', connections: 'list' },
    ],
  ]) {
    saved.set('alune-workspace', JSON.stringify({ version: 1, state: { collectionViews } }));
    await workspace.persist.rehydrate();
    assert.deepEqual(workspace.getState().collectionViews, expected);
  }
});

test('independent view choices survive reload, list reconciliation and layout reset', async () => {
  const existing = {
    appearance: { theme: 'dark', reduceMotion: true },
    treeOpen: false,
    layout: { sidebarWidth: 300 },
  };
  saved.set('alune-workspace', JSON.stringify({ version: 1, state: existing }));
  await workspace.persist.rehydrate();
  workspace.getState().setCollectionView('repositories', 'list');
  await workspace.persist.rehydrate();
  assert.deepEqual(workspace.getState().collectionViews, {
    repositories: 'list',
    connections: 'grid',
  });
  workspace.getState().setCollectionView('connections', 'list');
  workspace.getState().setCollectionView('repositories', 'grid');
  workspace.getState().reconcileConnections(['dev']);
  workspace.getState().reconcileRepositories([{ id: 'repo', connectionId: 'dev' }]);
  workspace.getState().resetLayout();
  await workspace.persist.rehydrate();
  assert.deepEqual(workspace.getState().collectionViews, {
    repositories: 'grid',
    connections: 'list',
  });
  assert.deepEqual(workspace.getState().appearance, existing.appearance);
  assert.equal(workspace.getState().treeOpen, false);
  assert.deepEqual(JSON.parse(saved.get('alune-workspace')).state.collectionViews, {
    repositories: 'grid',
    connections: 'list',
  });
});
