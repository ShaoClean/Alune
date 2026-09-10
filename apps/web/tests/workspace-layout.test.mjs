import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LAYOUT,
  readLayoutPreferences,
  fitWorkspaceLayout,
} from '../src/stores/workspaceLayout.ts';
import { useCommitDraftStore } from '../src/stores/commitDraftStore.ts';

const saved = new Map();
globalThis.localStorage = {
  getItem: (key) => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
  removeItem: (key) => saved.delete(key),
};
const { useWorkspaceStore: workspace } = await import('../src/stores/workspaceStore.ts');
const { useRepositoryStore: repository } = await import('../src/stores/repositoryStore.ts');
const { repositoryApi } = await import('../src/api/index.ts');

test('layout validates old, malformed and out-of-range preferences', () => {
  for (const value of [
    null,
    undefined,
    'broken',
    [],
    { sidebarWidth: '300', changesWidth: NaN, sidebarCollapsed: 'true' },
  ]) {
    assert.deepEqual(readLayoutPreferences(value), DEFAULT_LAYOUT);
  }
  assert.deepEqual(
    readLayoutPreferences({ sidebarWidth: 999, changesWidth: -1, sidebarCollapsed: true }),
    { sidebarWidth: 320, changesWidth: 280, sidebarCollapsed: true },
  );
  assert.equal(readLayoutPreferences({ sidebarWidth: Infinity }).sidebarWidth, 220);
});

test('window fitting preserves inspector space without replacing saved preferences', () => {
  const preference = Object.freeze({
    sidebarWidth: 320,
    changesWidth: 520,
    sidebarCollapsed: false,
  });
  const small = fitWorkspaceLayout(preference, 900);
  assert.equal(small.compact, false);
  assert.ok(900 - small.sidebarWidth - small.changesWidth - 4 >= 360);
  assert.equal(fitWorkspaceLayout(preference, 899).compact, true);
  assert.equal(fitWorkspaceLayout(preference, 1440).sidebarWidth, 320);
  assert.equal(fitWorkspaceLayout(preference, 1440).changesWidth, 520);
  assert.equal(
    fitWorkspaceLayout({ ...preference, sidebarCollapsed: true }, 900).changesWidth,
    484,
  );
});

test('old tree preferences survive adding, saving, rehydrating and resetting layout', async () => {
  saved.set(
    'remote-git-workspace',
    JSON.stringify({
      version: 1,
      state: {
        treeOpen: false,
        connectionOrder: ['b', 'a'],
        collapsedConnectionIds: ['b'],
        repositoryOrderByConnection: { a: ['r2', 'r1'] },
      },
    }),
  );
  await workspace.persist.rehydrate();
  assert.deepEqual(workspace.getState().layout, DEFAULT_LAYOUT);
  workspace
    .getState()
    .updateLayout({ sidebarWidth: 310, changesWidth: 430, sidebarCollapsed: true });
  const persisted = saved.get('remote-git-workspace');
  assert.deepEqual(JSON.parse(persisted).state.layout, {
    sidebarWidth: 310,
    changesWidth: 430,
    sidebarCollapsed: true,
  });
  await workspace.persist.rehydrate();
  assert.equal(workspace.getState().layout.changesWidth, 430);
  workspace.getState().resetLayout();
  assert.deepEqual(workspace.getState().layout, DEFAULT_LAYOUT);
  assert.equal(workspace.getState().treeOpen, false);
  assert.deepEqual(workspace.getState().connectionOrder, ['b', 'a']);
  assert.deepEqual(workspace.getState().repositoryOrderByConnection, { a: ['r2', 'r1'] });
});

test('commit drafts are isolated by repository and late submission completion preserves newer text', () => {
  const drafts = useCommitDraftStore.getState();
  drafts.updateDraft('a', { message: 'first', description: 'details' });
  const submitted = useCommitDraftStore.getState().drafts.a;
  drafts.updateDraft('b', { message: 'other repository' });
  assert.equal(useCommitDraftStore.getState().drafts.a.description, 'details');
  drafts.updateDraft('a', { message: 'next commit' });
  drafts.clearSubmittedDraft('a', submitted);
  assert.equal(useCommitDraftStore.getState().drafts.a.message, 'next commit');
  drafts.clearSubmittedDraft('a', useCommitDraftStore.getState().drafts.a);
  assert.equal(useCommitDraftStore.getState().drafts.a, undefined);
  assert.equal(useCommitDraftStore.getState().drafts.b.message, 'other repository');
});

test('late diffs and refreshes from previous repositories cannot replace the active workspace', async () => {
  const pending = [];
  let calls = 0;
  repositoryApi.diff = async () => {
    calls++;
    return new Promise((resolve) => pending.push(resolve));
  };
  repository.getState().resetWorkspace('a');
  const a = repository.getState().fetchDiff('a');
  repository.getState().resetWorkspace('b');
  const b = repository.getState().fetchDiff('b');
  pending[1]('diff from b');
  await b;
  pending[0]('stale diff from a');
  await a;
  await repository.getState().fetchDiff('a');
  assert.equal(calls, 2);
  assert.equal(repository.getState().diff, 'diff from b');
  let statusCalls = 0;
  repositoryApi.status = async () => {
    statusCalls++;
    return { branch: 'b', files: [] };
  };
  await repository.getState().fetchStatus('b');
  await repository.getState().fetchStatus('a');
  assert.equal(statusCalls, 1);
  assert.equal(repository.getState().status.branch, 'b');
});
