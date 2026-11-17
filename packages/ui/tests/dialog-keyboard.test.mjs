import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleDialogEscape } from '../src/components/dialog-keyboard.ts';

function fixture(overrides = {}, options = {}) {
  const target = {};
  let cancelled = 0, stopped = 0, prevented = 0;
  const event = { key: 'Escape', target, currentTarget: { contains: node => node === target },
    defaultPrevented: false, nativeEvent: { isComposing: false },
    preventDefault: () => prevented++, stopPropagation: () => stopped++, ...overrides };
  const handled = handleDialogEscape(event, { enabled: true, busy: false,
    compositionEndedAt: 0, cancel: () => cancelled++, ...options });
  return { handled, cancelled, stopped, prevented };
}

test('focused dialog handles Escape before an unrelated global portal stack', () => {
  assert.deepEqual(fixture(), { handled: true, cancelled: 1, stopped: 1, prevented: 1 });
});
test('busy dialog consumes Escape without cancelling; keyboard-disabled dialog does not handle it', () => {
  assert.deepEqual(fixture({}, { busy: true }), { handled: true, cancelled: 0, stopped: 1, prevented: 1 });
  assert.equal(fixture({}, { enabled: false }).handled, false);
});
test('nested popup consumption, portalled targets and IME composition cannot cancel the dialog', () => {
  for (const event of [{ key: 'Enter' }, { defaultPrevented: true },
    { nativeEvent: { isComposing: true } }, { currentTarget: { contains: () => false } },
    { target: { closest: () => ({}) }, currentTarget: { contains: () => true } }]) {
    assert.deepEqual(fixture(event), { handled: false, cancelled: 0, stopped: 0, prevented: 0 });
  }
  assert.equal(fixture({}, { compositionEndedAt: Date.now() }).handled, false);
});
