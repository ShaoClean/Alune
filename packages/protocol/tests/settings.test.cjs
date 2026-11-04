const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateAiSettings,
  validateProxySettings,
  validateCredentialStorageStatus,
} = require('../dist');

test('settings response schemas reject secret-bearing extra fields and malformed public values', () => {
  const provider = {
    id: 'fixture',
    name: 'Fixture',
    protocol: 'openai',
    baseUrl: 'https://fixture.invalid',
    enabled: false,
    builtin: false,
    hasApiKey: true,
    models: [{ id: 'model', name: 'Model', enabled: true }],
  };
  const ai = {
    revision: 'revision',
    providers: [provider],
    commit: { providerId: null, modelId: null, language: 'en', format: 'natural', prompt: '' },
    secretStorage: { available: true, description: 'Fixture' },
  };
  assert.equal(validateAiSettings(ai), ai);
  for (const change of [
    { apiKey: 'secret' },
    { encryptedKey: 'aes-gcm:ciphertext' },
    { builtin: 'yes' },
    { models: [...provider.models, ...provider.models] },
  ]) {
    assert.throws(() => validateAiSettings({ ...ai, providers: [{ ...provider, ...change }] }));
  }
  assert.throws(() => validateAiSettings({ ...ai, providers: [provider, provider] }));
  assert.throws(() => validateAiSettings({ ...ai, commit: { ...ai.commit, prompt: {} } }));
  assert.throws(() =>
    validateCredentialStorageStatus({
      available: true,
      description: 'Fixture',
      masterKey: 'secret',
    }),
  );
  const proxy = {
    revision: 'revision',
    enabled: true,
    protocol: 'socks5',
    host: '127.0.0.1',
    port: 1080,
    authEnabled: true,
    hasCredentials: true,
    secretStorageAvailable: true,
  };
  assert.equal(validateProxySettings(proxy), proxy);
  for (const change of [
    { credentials: { password: 'secret' } },
    { encryptedCredentials: 'aes-gcm:ciphertext' },
    { port: 0 },
    { protocol: 'direct' },
  ]) {
    assert.throws(() => validateProxySettings({ ...proxy, ...change }));
  }
});
