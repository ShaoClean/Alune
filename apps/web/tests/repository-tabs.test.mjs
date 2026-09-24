import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horizontalPlacement, moveBeforeOrAfter } from '../src/stores/sidebarOrder.ts';

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
