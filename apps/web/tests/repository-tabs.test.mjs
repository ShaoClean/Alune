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
