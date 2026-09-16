const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAiSecretStorage } = require('../src/ai-secret-storage.cjs');

test('desktop secrets use the main-process OS storage adapter', () => {
  const calls = [];
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      calls.push(value);
      return Buffer.from('encrypted OS payload');
    },
    decryptString: (value) => {
      assert.equal(value.toString(), 'encrypted OS payload');
      return calls[0];
    },
  };
  const secrets = createAiSecretStorage(safeStorage);
  const encrypted = secrets.encrypt('fixture-key');
  assert.equal(encrypted.includes('fixture-key'), false);
  assert.equal(secrets.decrypt(encrypted), 'fixture-key');
  assert.throws(() => secrets.decrypt('plaintext'), /unavailable/);
});

for (const [available, backend] of [
  [false, undefined],
  [true, 'basic_text'],
]) {
  test(`refuses unavailable or unprotected OS storage (${available}, ${backend})`, () => {
    const secrets = createAiSecretStorage({
      isEncryptionAvailable: () => available,
      getSelectedStorageBackend: () => backend,
    });
    assert.equal(secrets.available, false);
    assert.throws(() => secrets.encrypt('key'), /unavailable/);
    assert.throws(() => secrets.decrypt('safe-storage:abc'), /unavailable/);
  });
}
