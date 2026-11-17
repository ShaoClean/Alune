const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { bridgeLegacyAgentSecrets } = require('../src/legacy-agent-secrets.cjs');
function child() {
  const value = new EventEmitter();
  value.connected = true;
  value.sent = [];
  value.send = (message, callback) => {
    value.sent.push(message);
    callback();
  };
  return value;
}
test('legacy decrypt bridge accepts each exact allowed ciphertext once and disposes with its child', () => {
  const process = child();
  let calls = 0;
  bridgeLegacyAgentSecrets(
    process,
    {
      available: true,
      decrypt() {
        calls++;
        return 'synthetic-private-value';
      },
    },
    ['safe-storage:allowed'],
  );
  process.emit('message', {
    kind: 'alune.legacy.decrypt',
    id: 'one',
    ciphertext: 'safe-storage:unknown',
  });
  assert.deepEqual(process.sent.at(-1), { kind: 'alune.legacy.decrypted', id: 'one', ok: false });
  assert.equal(calls, 0);
  process.emit('message', {
    kind: 'alune.legacy.decrypt',
    id: 'two',
    ciphertext: 'safe-storage:allowed',
  });
  assert.equal(process.sent.at(-1).plaintext, 'synthetic-private-value');
  process.emit('message', {
    kind: 'alune.legacy.decrypt',
    id: 'three',
    ciphertext: 'safe-storage:allowed',
  });
  assert.equal(process.sent.at(-1).ok, false);
  assert.equal(calls, 1);
  process.emit('disconnect');
  assert.equal(process.listenerCount('message'), 0);
});
test('locked storage and native errors never disclose values or source errors to the import child', () => {
  for (const storage of [
    {
      available: false,
      decrypt() {
        throw Error('must-not-run');
      },
    },
    {
      available: true,
      decrypt() {
        throw Error('synthetic-private-value');
      },
    },
  ]) {
    const process = child();
    const dispose = bridgeLegacyAgentSecrets(process, storage, ['safe-storage:allowed']);
    process.emit('message', {
      kind: 'alune.legacy.decrypt',
      id: 'one',
      ciphertext: 'safe-storage:allowed',
    });
    assert.deepEqual(process.sent, [{ kind: 'alune.legacy.decrypted', id: 'one', ok: false }]);
    dispose();
    assert.equal(process.listenerCount('message'), 0);
  }
});
