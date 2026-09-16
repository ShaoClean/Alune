import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useCommitDraftStore as store } from '../src/stores/commitDraftStore.ts';
import { defaultCommitModel } from '../src/stores/aiSettingsStore.ts';

const draft = {
  message: 'fix: 修复 "quote" 与 $(literal)',
  description: '第一行\n\n第二行 `literal`',
};
const reset = () => store.setState({ drafts: {}, generations: {}, undo: {} });

test('generation fills both fields atomically and undo restores the entire previous draft', () => {
  reset();
  store.getState().updateDraft('a', draft);
  const ticket = store.getState().beginGeneration('a');
  const generated = { message: 'feat: 生成摘要', description: '生成正文\n换行' };
  assert.equal(store.getState().applyGeneration('a', ticket, generated), true);
  assert.deepEqual(store.getState().drafts.a, generated);
  store.getState().undoGeneration('a');
  assert.deepEqual(store.getState().drafts.a, draft);
  assert.equal(store.getState().undo.a, undefined);
});

test('manual edits retire undo and stale generation even if text is edited back to its original value', () => {
  reset();
  store.getState().updateDraft('a', draft);
  const ticket = store.getState().beginGeneration('a');
  store.getState().updateDraft('a', { message: 'changed' });
  store.getState().updateDraft('a', draft);
  assert.equal(
    store.getState().applyGeneration('a', ticket, { message: 'stale', description: '' }),
    false,
  );
  const fresh = store.getState().beginGeneration('a');
  store.getState().applyGeneration('a', fresh, { message: 'new', description: '' });
  store.getState().updateDraft('a', { description: 'my correction' });
  assert.equal(store.getState().undo.a, undefined);
  store.getState().undoGeneration('a');
  assert.equal(store.getState().drafts.a.description, 'my correction');
});

test('cancel, failed requests, repository switches and out-of-order responses preserve drafts', () => {
  reset();
  store.getState().updateDraft('a', draft);
  store.getState().updateDraft('b', { message: 'other repository' });
  const first = store.getState().beginGeneration('a');
  store.getState().cancelGeneration('a', first);
  assert.equal(
    store.getState().applyGeneration('a', first, { message: 'stale', description: '' }),
    false,
  );
  assert.deepEqual(store.getState().drafts.a, draft);
  const second = store.getState().beginGeneration('a');
  const third = store.getState().beginGeneration('a');
  store.getState().cancelGeneration('a', second);
  assert.equal(
    store.getState().applyGeneration('a', second, { message: 'late', description: '' }),
    false,
  );
  assert.equal(
    store
      .getState()
      .applyGeneration('a', third, { message: 'current', description: 'current body' }),
    true,
  );
  assert.equal(store.getState().drafts.b.message, 'other repository');
  store.getState().undoGeneration('a');
  assert.deepEqual(store.getState().drafts.a, draft);
});

test('regeneration undo restores the previous generated draft, then submission retires undo', () => {
  reset();
  const first = store.getState().beginGeneration('a');
  store.getState().applyGeneration('a', first, draft);
  const second = store.getState().beginGeneration('a');
  store.getState().applyGeneration('a', second, { message: 'second generation', description: '' });
  store.getState().undoGeneration('a');
  assert.deepEqual(store.getState().drafts.a, draft);
  store.getState().clearSubmittedDraft('a', draft);
  assert.equal(store.getState().drafts.a, undefined);
  assert.equal(store.getState().undo.a, undefined);
});

test('disabled provider/model or missing configuration cannot be used as the default', () => {
  const settings = {
    commit: { providerId: 'p', modelId: 'm' },
    providers: [{ id: 'p', enabled: true, models: [{ id: 'm', enabled: true }] }],
  };
  assert.equal(defaultCommitModel(settings).model.id, 'm');
  settings.providers[0].enabled = false;
  assert.equal(defaultCommitModel(settings), null);
  settings.providers[0].enabled = true;
  settings.providers[0].models[0].enabled = false;
  assert.equal(defaultCommitModel(settings), null);
  assert.equal(defaultCommitModel(null), null);
});
