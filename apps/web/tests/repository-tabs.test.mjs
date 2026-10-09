import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horizontalPlacement, moveBeforeOrAfter } from '../src/stores/sidebarOrder.ts';
import { tabsToClose } from '../src/stores/tabCommands.ts';

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
const { createRepositoryStore } = await import('../src/stores/repositoryStore.ts');
const { repositoryApi } = await import('../src/api/index.ts');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const repo = (id) => ({ id, name: id, path: `/repos/${id}` });
const ids = (store) => store.getState().openRepositories.map((item) => item.id);

test('horizontal drop halves use the tab midpoint', () => {
  assert.equal(horizontalPlacement(99, 100, 80), 'before');
  assert.equal(horizontalPlacement(139, 100, 80), 'before');
  assert.equal(horizontalPlacement(140, 100, 80), 'after');
  assert.equal(horizontalPlacement(181, 100, 80), 'after');
});

test('reordering handles adjacent and distant drops without changing no-op arrays', () => {
  const original = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveBeforeOrAfter(original, 'a', 'b', 'after'), ['b', 'a', 'c', 'd']);
  assert.deepEqual(moveBeforeOrAfter(original, 'd', 'a', 'before'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveBeforeOrAfter(original, 'a', 'd', 'after'), ['b', 'c', 'd', 'a']);
  for (const [source, target, placement] of [
    ['a', 'a', 'after'],
    ['a', 'b', 'before'],
    ['b', 'a', 'after'],
    ['missing', 'a', 'before'],
    ['a', 'missing', 'after'],
  ])
    assert.equal(moveBeforeOrAfter(original, source, target, placement), original);
});

test('moving open tabs preserves selection and content state and does not notify on a no-op', () => {
  const store = createRepositoryStore();
  for (const id of ['a', 'b', 'c', 'd']) store.getState().openRepository(repo(id));
  store.getState().setCurrentRepo(repo('c'));
  const selected = store.getState().currentRepo;
  const status = { branch: 'main', files: [] };
  store.setState({ status, diff: 'selected file' });
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  assert.equal(store.getState().moveOpenRepository('a', 'c', 'after'), true);
  assert.deepEqual(ids(store), ['b', 'c', 'a', 'd']);
  assert.equal(store.getState().currentRepo, selected);
  assert.equal(store.getState().status, status);
  assert.equal(store.getState().diff, 'selected file');
  assert.equal(notifications, 1);
  assert.equal(store.getState().moveOpenRepository('a', 'd', 'before'), false);
  assert.equal(store.getState().moveOpenRepository('missing', 'd', 'after'), false);
  assert.equal(notifications, 1);
  store.getState().openRepository(repo('e'));
  assert.deepEqual(ids(store), ['b', 'c', 'a', 'd', 'e']);
  store.getState().closeRepository('b');
  assert.deepEqual(ids(store), ['c', 'a', 'd', 'e']);
  unsubscribe();
});

test('close commands act on the target tab in the current visible order', () => {
  const order = ['b', 'c', 'a', 'd'];
  assert.deepEqual(tabsToClose(order, 'a', 'current'), ['a']);
  assert.deepEqual(tabsToClose(order, 'a', 'others'), ['b', 'c', 'd']);
  assert.deepEqual(tabsToClose(order, 'a', 'right'), ['d']);
  assert.deepEqual(tabsToClose(order, 'a', 'left'), ['b', 'c']);
  assert.deepEqual(tabsToClose(order, 'b', 'left'), []);
  assert.deepEqual(tabsToClose(order, 'd', 'right'), []);
  for (const command of ['others', 'right', 'left'])
    assert.deepEqual(tabsToClose(['only'], 'only', command), []);
  assert.deepEqual(tabsToClose(['only'], 'only', 'current'), ['only']);
  assert.deepEqual(tabsToClose(order, 'missing', 'others'), []);
});

test('batch closing removes only open tabs and keeps registrations and statuses', () => {
  const store = createRepositoryStore();
  const registry = ['a', 'b', 'c', 'd'].map(repo);
  const statuses = { a: { phase: 'success', data: { branch: 'main', files: [] } } };
  store.setState({ repositories: registry, repositoryStatuses: statuses });
  for (const id of ['a', 'b', 'c', 'd']) store.getState().openRepository(repo(id));
  store.getState().setCurrentRepo(repo('b'));
  store.getState().closeRepositories(['c', 'd']);
  assert.deepEqual(ids(store), ['a', 'b']);
  assert.equal(store.getState().currentRepo.id, 'b');
  store.getState().closeRepositories(['a', 'b']);
  assert.deepEqual(ids(store), []);
  assert.equal(store.getState().currentRepo, null);
  assert.equal(store.getState().repositories, registry);
  assert.equal(store.getState().repositoryStatuses, statuses);
});

test('switching workspaces retains each tab selection, including the staged side', () => {
  const store = createRepositoryStore();
  const a = { path: 'first.ts', status: 'modified', staged: false };
  const b = { path: 'second.ts', status: 'added', staged: true };
  for (const [id, file] of [
    ['a', a],
    ['b', b],
  ]) {
    store.getState().openRepository(repo(id));
    store.getState().activateWorkspace(id);
    store.getState().selectRepositoryFile(id, file);
    store.getState().clearDiff(id);
    store.getState().activateWorkspace();
  }
  store.getState().activateWorkspace('a');
  assert.deepEqual(store.getState().selectedFiles, { a, b });
  store.getState().selectRepositoryFile('a', null);
  assert.deepEqual(store.getState().selectedFiles, { b });
});

test('closing or forgetting tabs discards only their selections and late updates cannot restore them', () => {
  const store = createRepositoryStore();
  const file = { path: 'changed.ts', status: 'modified', staged: false };
  for (const id of ['a', 'b', 'c']) {
    store.getState().openRepository(repo(id));
    store.getState().selectRepositoryFile(id, file);
  }
  store.getState().closeRepositories(['a', 'b']);
  store.getState().selectRepositoryFile('a', file);
  assert.deepEqual(store.getState().selectedFiles, { c: file });
  store.getState().openRepository(repo('a'));
  assert.equal(store.getState().selectedFiles.a, undefined);
  store.getState().forgetRepositories(['c']);
  store.getState().selectRepositoryFile('c', file);
  assert.deepEqual(store.getState().selectedFiles, {});
});

test('showing another tab keeps every hidden tab’s loaded panels and preview', async () => {
  const store = createRepositoryStore();
  const ws = (id) => store.getState().workspaces[id];
  repositoryApi.branches = async (id) => [{ name: `${id}-main` }];
  repositoryApi.stashes = async (id) => [{ index: 0, message: `${id} stash` }];
  repositoryApi.remotes = async (id) => [{ name: `${id}-origin` }];
  repositoryApi.diff = async (id) => `${id} commit diff`;
  for (const id of ['a', 'b']) {
    store.getState().openRepository(repo(id));
    store.getState().activateWorkspace(id);
    await Promise.all([
      store.getState().fetchBranches(id),
      store.getState().fetchStashes(id),
      store.getState().fetchRemotes(id),
      store.getState().fetchDiff(id, { commit: 'abc' }),
    ]);
  }
  const hidden = ws('a');
  store.getState().activateWorkspace('a');
  store.getState().activateWorkspace('b');
  assert.equal(ws('a'), hidden, 'switching does not touch a hidden tab');
  assert.deepEqual(ws('a').branches, [{ name: 'a-main' }]);
  assert.deepEqual(ws('a').stashes, [{ index: 0, message: 'a stash' }]);
  assert.deepEqual(ws('a').remotes, [{ name: 'a-origin' }]);
  assert.equal(ws('a').diff, 'a commit diff');
  assert.equal(ws('b').diff, 'b commit diff');
  repositoryApi.branches = async () => {
    throw new Error('b offline');
  };
  await store.getState().fetchBranches('b');
  assert.equal(ws('b').error, 'b offline');
  assert.equal(ws('a').error, null, 'one tab’s failure is not shown in another');
});

test('closing a tab drops its workspace and aborts its reads; late replies cannot restore it', async () => {
  const store = createRepositoryStore();
  const branches = deferred();
  const diff = deferred();
  let signal;
  repositoryApi.branches = () => branches.promise;
  repositoryApi.diff = (_id, _params, incoming) => {
    signal = incoming;
    return diff.promise;
  };
  store.getState().openRepository(repo('a'));
  store.getState().openRepository(repo('b'));
  store.getState().activateWorkspace('a');
  store.getState().activateWorkspace('b');
  const reads = [
    store.getState().fetchBranches('a'),
    store.getState().fetchDiff('a', { commit: 'abc' }),
  ];
  store.getState().closeRepository('a');
  assert.equal(signal.aborted, true);
  assert.equal(store.getState().workspaces.a, undefined);
  assert.ok(store.getState().workspaces.b, 'other tabs stay open');
  branches.resolve([{ name: 'late' }]);
  diff.resolve('late diff');
  await Promise.all(reads);
  assert.equal(store.getState().workspaces.a, undefined);
  store.getState().openRepository(repo('a'));
  store.getState().activateWorkspace('a');
  assert.deepEqual(store.getState().workspaces.a.branches, []);
  assert.equal(store.getState().workspaces.a.diff, '');
});

test('a status read validating a Git write keeps running after its tab is hidden', async () => {
  const store = createRepositoryStore();
  const write = deferred();
  repositoryApi.status = (id) =>
    id === 'a' ? write.promise : Promise.resolve({ branch: id, files: [] });
  store.getState().openRepository(repo('a'));
  store.getState().activateWorkspace('a');
  const validation = store.getState().fetchStatus('a', true);
  await flush();
  store.getState().activateWorkspace('b');
  await store.getState().fetchStatus('b');
  write.resolve({ branch: 'after-push', files: [] });
  await validation;
  assert.equal(store.getState().repositoryStatuses.a.data.branch, 'after-push');
  assert.equal(store.getState().workspaces.a.worktreeDiffRevision, 1);
  assert.equal(store.getState().workspaces.b.worktreeDiffRevision, 0);
});
