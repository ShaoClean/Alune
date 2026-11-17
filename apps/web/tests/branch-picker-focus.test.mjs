import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreBranchTriggerFocus } from '../src/components/branch-picker-focus.ts';

function fixture() {
  const frames = new Map();
  let serial = 0, mutations, disconnected = false, restored = 0, calls = 0, blocked = false;
  const document = { body: {}, activeElement: {} };
  document.defaultView = {
    requestAnimationFrame(callback) { frames.set(++serial, callback); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); },
    MutationObserver: class {
      constructor(callback) { mutations = callback; }
      observe(body, options) {
        assert.equal(body, document.body);
        assert.deepEqual(options.attributeFilter, ['open', 'inert', 'disabled']);
      }
      disconnect() { disconnected = true; }
    },
  };
  const target = {
    ownerDocument: document, isConnected: true, disabled: false,
    focus(options) {
      calls++;
      assert.deepEqual(options, { preventScroll: true });
      if (!blocked) document.activeElement = target;
    },
  };
  return {
    target, document,
    block(value) { blocked = value; },
    start() { return restoreBranchTriggerFocus(target, () => restored++); },
    mutate() { if (!disconnected) mutations(); },
    frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); },
    state() { return { restored, calls, disconnected, pending: frames.size }; },
  };
}

test('a native progress modal cannot consume the pending branch trigger focus return', () => {
  const f = fixture();
  const modalButton = {};
  f.document.activeElement = modalButton;
  f.block(true);
  const stop = f.start();
  f.frame();
  assert.equal(f.document.activeElement, modalButton);
  assert.deepEqual(f.state(), { restored: 0, calls: 1, disconnected: false, pending: 0 });
  // The modal closes after the branch popover and the initial animation frame.
  f.block(false);
  f.document.activeElement = {};
  f.mutate();
  f.mutate();
  assert.equal(f.state().pending, 1);
  f.frame();
  assert.equal(f.document.activeElement, f.target);
  assert.deepEqual(f.state(), { restored: 1, calls: 2, disconnected: true, pending: 0 });
  // Later DOM changes cannot take focus back from the user's next control.
  const nextControl = {};
  f.document.activeElement = nextControl;
  f.mutate();
  f.frame();
  assert.equal(f.document.activeElement, nextControl);
  stop();
});

test('a disabled trigger waits for its committed enabled state without spinning', () => {
  const f = fixture();
  f.target.disabled = true;
  f.start();
  f.frame();
  assert.deepEqual(f.state(), { restored: 0, calls: 0, disconnected: false, pending: 0 });
  f.target.disabled = false;
  f.mutate();
  f.frame();
  assert.equal(f.document.activeElement, f.target);
  assert.deepEqual(f.state(), { restored: 1, calls: 1, disconnected: true, pending: 0 });
});

test('unmount cancels pending focus work and disconnects its observer', () => {
  const f = fixture();
  const stop = f.start();
  f.target.isConnected = false;
  stop();
  f.mutate();
  f.frame();
  assert.deepEqual(f.state(), { restored: 0, calls: 0, disconnected: true, pending: 0 });
});
