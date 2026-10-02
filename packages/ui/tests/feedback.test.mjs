import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedbackStore } from '../src/stores/feedbackStore.ts';
const event = (id = 'repo:history', revision = 'r1', overrides = {}) => ({
  id,
  revision,
  scope: 'repo',
  context: '验收仓库',
  title: '读取失败',
  type: 'error',
  mode: 'modal',
  ...overrides,
});

test('acknowledged errors survive render and remount without reopening; a new request can notify again', () => {
  const store = createFeedbackStore().getState;
  const first = store().publish(event());
  store().acknowledge('repo:history');
  store().release('repo:history', first);
  store().publish(event());
  assert.equal(store().entries[0].queued, false);
  store().publish(event('repo:history', 'r2'));
  assert.equal(store().entries[0].queued, true);
  assert.equal(store().entries.length, 1);
});

test('simultaneous failures retain arrival order when an earlier source updates its action state', () => {
  const store = createFeedbackStore().getState;
  store().publish(event('first'));
  store().publish(event('second'));
  store().publish(event('first', 'r1', { busy: true }));
  assert.deepEqual(
    store().entries.map((e) => e.id),
    ['first', 'second'],
  );
  store().acknowledge('first');
  assert.equal(store().entries.find((e) => e.queued).id, 'second');
});

test('StrictMode cleanup cannot remove a newer lease; navigation removes the live callback', async () => {
  const store = createFeedbackStore().getState;
  let calls = 0;
  const first = store().publish(event());
  const second = store().publish(event('repo:history', 'r1', { onAction: () => calls++ }));
  store().release('repo:history', first);
  assert.equal(store().entries.length, 1);
  store().release('repo:history', second);
  await store().run('repo:history');
  assert.equal(calls, 0);
});

test('retry prevents duplicate submissions and an identical subsequent failure can be shown', async () => {
  const store = createFeedbackStore().getState;
  let finish,
    calls = 0;
  store().publish(
    event('retry', 'r1', {
      onAction: () => {
        calls++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    }),
  );
  const running = store().run('retry');
  await store().run('retry');
  assert.equal(calls, 1);
  assert.equal(store().entries[0].busy, true);
  finish();
  await running;
  assert.equal(store().entries[0].busy, false);
  store().acknowledge('retry');
  store().publish(event('retry'));
  assert.equal(store().entries[0].queued, true);
});

test('late rejected actions cannot resurrect a removed repository or alter its replacement', async () => {
  const store = createFeedbackStore().getState;
  let reject;
  const first = store().publish(
    event('a', 'r1', {
      onAction: () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    }),
  );
  const running = store().run('a');
  store().release('a', first);
  store().publish(event('b'));
  reject(new Error('late failure'));
  await running;
  assert.deepEqual(
    store().entries.map((e) => e.id),
    ['b'],
  );
});

test('persistent explanations and background failures enter the same modal queue', () => {
  const store = createFeedbackStore().getState;
  store().publish(event('shallow', 'r1', { mode: 'manual' }));
  store().publish(event('poll', 'r1', { mode: 'notification' }));
  assert.equal(
    store().entries.every((e) => e.queued),
    true,
  );
});

test('inbox-only updates share source identity without interrupting or duplicating the modal queue', () => {
  const store = createFeedbackStore().getState;
  const first = store().publish(event('update', 'v1', { type: 'info', autoOpen: false }));
  store().publish(event('storage'));
  store().publish(event('update', 'v1', { type: 'info', autoOpen: false, description: '新说明' }));
  store().release('update', first);
  assert.equal(store().entries.length, 2);
  assert.equal(store().entries.find((entry) => entry.id === 'update').description, '新说明');
  assert.deepEqual(
    store()
      .entries.filter((entry) => entry.queued)
      .map((entry) => entry.id),
    ['storage'],
  );
  store().publish(event('update', 'v2', { type: 'info', autoOpen: false }));
  assert.equal(store().entries.length, 2);
  assert.equal(store().entries.find((entry) => entry.id === 'update').queued, false);
});

test('an inbox action failure still announces the error and preserves its retry action', async () => {
  const store = createFeedbackStore().getState;
  store().publish(
    event('update', 'v1', {
      autoOpen: false,
      onAction: () => {
        throw new Error('离线');
      },
    }),
  );
  await store().run('update');
  assert.equal(store().entries[0].queued, true);
  assert.equal(store().entries[0].description, '离线');
  assert.equal(store().entries[0].busy, false);
});

test('a new failed attempt does not inherit the previous attempt busy lock', () => {
  const store = createFeedbackStore().getState;
  store().publish(event('retry', 'r1', { busy: true }));
  store().publish(event('retry', 'r2'));
  assert.equal(store().entries[0].busy, false);
});

test('retry re-arms background failures; only a new revision reopens an acknowledged result', async () => {
  const store = createFeedbackStore().getState;
  store().publish(event('poll', 'r1', { mode: 'notification', onAction: () => {} }));
  await store().run('poll');
  store().publish(event('poll', 'r2', { mode: 'notification' }));
  assert.equal(store().entries[0].queued, true);
  store().acknowledge('poll');
  store().publish(event('poll', 'r2', { mode: 'notification' }));
  assert.equal(store().entries[0].queued, false);
  store().publish(event('poll', 'r3', { mode: 'notification' }));
  assert.equal(store().entries[0].queued, true);
});

for (const type of ['error', 'warning', 'success', 'info']) {
  test(`${type} shares acknowledgement, stable polling identity and ordered delivery`, () => {
    const store = createFeedbackStore().getState;
    store().publish(event('progress', 'started-at', { type, description: '1 秒' }));
    store().acknowledge('progress');
    store().publish(event('progress', 'started-at', { type, description: '20 秒' }));
    assert.equal(store().entries[0].queued, false);
    assert.equal(store().entries[0].description, '20 秒');
    store().publish(event('progress', 'next-operation', { type }));
    assert.equal(store().entries[0].queued, true);
  });
}

test('moving an acknowledged form error to the page does not announce it again', () => {
  const store = createFeedbackStore().getState;
  store().publish(event('review', 'failure', { host: 'form' }));
  store().acknowledge('review');
  store().publish(event('review', 'failure'));
  assert.equal(store().entries[0].queued, false);
  assert.equal(store().entries[0].host, undefined);
});

test('a new event from an acknowledged source follows already queued events', () => {
  const store = createFeedbackStore().getState;
  store().publish(event('first'));
  store().acknowledge('first');
  store().publish(event('second'));
  store().publish(event('first', 'new-attempt'));
  assert.deepEqual(
    store()
      .entries.filter((entry) => entry.queued)
      .map((entry) => entry.id),
    ['second', 'first'],
  );
});
