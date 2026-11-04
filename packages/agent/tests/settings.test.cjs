const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AgentState } = require('../dist/adapters/sqlite/state');
const { AiSettingsStore, ProxySettingsStore } = require('../dist/modules/settings');
const { agentFileSecretStorage } = require('../dist/adapters/secrets/file');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-settings-'));
  const id = randomUUID();
  const state = await AgentState.open(root, id);
  const secrets = agentFileSecretStorage(root, true);
  t.after(async () => {
    await state.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, state, secrets };
}
test(
  'AI settings persist through the document port and never expose or resurrect cleared credentials',
  { timeout: 30000 },
  async (t) => {
    const { state, secrets } = await fixture(t);
    const store = new AiSettingsStore(state.document('ai-settings'), secrets);
    const settings = store.read();
    const provider = settings.providers.find((p) => p.id === 'openai');
    const secret = 'fixture-provider-private-key';
    const saved = store.saveProvider(
      'openai',
      { ...provider, enabled: true, apiKey: secret },
      settings.revision,
    );
    assert.equal(store.key('openai'), secret);
    assert(!JSON.stringify(saved).includes(secret));
    assert(!JSON.stringify(saved).includes('aes-gcm:'));
    const restored = new AiSettingsStore(state.document('ai-settings'), secrets);
    assert.equal(restored.key('openai'), secret);
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'ignored-fixture-environment';
    try {
      restored.saveProvider('openai', { ...provider, apiKey: null }, saved.revision);
      assert.equal(restored.key('openai'), '');
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  },
);
test(
  'document CAS refreshes stale settings without replacing the newer revision',
  { timeout: 30000 },
  async (t) => {
    const { state, secrets } = await fixture(t);
    const a = new AiSettingsStore(state.document('ai-settings'), secrets);
    const b = new AiSettingsStore(state.document('ai-settings'), secrets);
    const stale = b.read();
    const first = a.read();
    const next = a.saveCommit({ ...first.commit, prompt: 'new value' }, first.revision);
    assert.throws(
      () => b.saveCommit({ ...stale.commit, prompt: 'stale' }, stale.revision),
      (e) => e.kind === 'conflict',
    );
    assert.equal(b.read().revision, next.revision);
    assert.equal(b.read().commit.prompt, 'new value');
  },
);
test(
  'proxy authentication remains bound to destination and failure never becomes direct access',
  { timeout: 30000 },
  async (t) => {
    const { state, secrets } = await fixture(t);
    const store = new ProxySettingsStore(state.document('network-proxy'), secrets);
    const first = store.read();
    const saved = store.save({
      ...first,
      enabled: true,
      host: '127.0.0.1',
      port: 8080,
      authEnabled: true,
      credentials: { action: 'replace', username: 'fixture-user', password: 'fixture-password' },
    });
    assert(!JSON.stringify(saved).includes('fixture-password'));
    assert(!JSON.stringify(saved).includes('aes-gcm:'));
    assert.equal(store.snapshot().credentials.password, 'fixture-password');
    assert.throws(
      () => store.save({ ...saved, host: 'other.invalid', credentials: { action: 'keep' } }),
      (e) => e.kind === 'invalid-input',
    );
    const unavailable = new ProxySettingsStore(state.document('network-proxy'), {
      available: false,
      description: 'unavailable',
      encrypt() {
        throw Error('unavailable');
      },
      decrypt() {
        throw Error('unavailable');
      },
    });
    assert.throws(
      () => unavailable.snapshot(),
      (e) => e.kind === 'unavailable' && e.message.includes('不会回退直连'),
    );
    const cleared = store.save({ ...saved, authEnabled: false, credentials: { action: 'clear' } });
    assert.equal(cleared.hasCredentials, false);
    assert.equal(store.snapshot().credentials, undefined);
  },
);
test(
  'JSON null is damaged settings, distinct from an absent document',
  { timeout: 30000 },
  async (t) => {
    const { state, secrets } = await fixture(t);
    for (const [name, Store] of [
      ['ai-settings', AiSettingsStore],
      ['network-proxy', ProxySettingsStore],
    ]) {
      const doc = state.document(name);
      assert.equal(doc.read(), undefined);
      doc.write(null);
      const store = new Store(state.document(name), secrets);
      assert.throws(
        () => store.read(),
        (e) => e.kind === 'unavailable',
      );
      assert.equal(state.document(name).read(), null);
    }
  },
);
