const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnAgent } = require('@alune/agent-client/node');
const fixture = path.resolve(__dirname, 'settings-fixture.cjs');

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-settings-rpc-'));
  const children = [];
  const responses = [];
  t.after(async () => {
    await Promise.all(children.map((c) => c.close()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    responses,
    async start() {
      let stderr = '';
      const child = spawnAgent(process.execPath, [fixture, root], {
        onStderr: (text) => {
          stderr = (stderr + text).slice(-4096);
        },
      });
      child.diagnostic = () => stderr;
      children.push(child);
      await child.client.initialize();
      child.client.onEvent((event) => responses.push(event));
      await child.client.subscribe(['settings.changed']);
      return child;
    },
  };
}

test(
  'settings RPC persists revisions, encrypts credentials and exposes no credential read capability',
  { timeout: 60000 },
  async (t) => {
    const f = await setup(t);
    const child = await f.start();
    const client = child.client;
    const first = await client.getAiSettings();
    assert.equal(fs.existsSync(path.join(f.root, 'keys')), false, 'read must not initialize a key');
    assert.equal(first.secretStorage.available, false);
    const provider = first.providers.find((p) => p.id === 'openai');
    const input = {
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      enabled: true,
      models: provider.models,
    };
    const saved = await client.saveAiProvider(
      'openai',
      { ...input, apiKey: 'fixture-rpc-ai-private' },
      first.revision,
    );
    assert.equal(saved.providers.find((p) => p.id === 'openai').hasApiKey, true);
    assert.equal(saved.secretStorage.available, true);
    f.responses.push(saved);
    const edited = await client.saveAiProvider(
      'openai',
      { ...input, apiKey: undefined },
      saved.revision,
    );
    assert.equal(edited.providers.find((p) => p.id === 'openai').hasApiKey, true);
    const stale = edited.revision;
    const results = await Promise.allSettled([
      client.saveCommitPreferences({ ...saved.commit, prompt: 'first concurrent' }, stale),
      client.saveCommitPreferences({ ...saved.commit, prompt: 'second concurrent' }, stale),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.filter((r) => r.status === 'rejected' && r.reason.kind === 'conflict').length,
      1,
    );
    const proxy = await client.getProxySettings();
    const proxySaved = await client.saveProxySettings({
      ...proxy,
      enabled: true,
      host: '127.0.0.1',
      authEnabled: true,
      credentials: {
        action: 'replace',
        username: 'fixture-proxy-user',
        password: 'fixture-rpc-proxy-private',
      },
    });
    assert.equal(proxySaved.hasCredentials, true);
    f.responses.push(proxySaved);
    await assert.rejects(
      client.request('settings.ai.key', { id: 'openai' }),
      (e) => e.kind === 'unknown-method',
    );
    await assert.rejects(
      client.request('settings.proxy.snapshot'),
      (e) => e.kind === 'unknown-method',
    );
    await child.close();
    const next = await f.start();
    const restored = await next.client.getAiSettings();
    const proxyRestored = await next.client.getProxySettings();
    assert.equal(restored.providers.find((p) => p.id === 'openai').hasApiKey, true);
    assert.equal(proxyRestored.revision, proxySaved.revision);
    assert.equal(restored.secretStorage.available, true);
    const cleared = await next.client.saveAiProvider(
      'openai',
      { ...input, apiKey: null },
      restored.revision,
    );
    assert.equal(cleared.providers.find((p) => p.id === 'openai').hasApiKey, false);
    f.responses.push(restored, proxyRestored, cleared);
    assert.doesNotMatch(
      JSON.stringify(f.responses),
      /fixture-rpc-ai-private|fixture-rpc-proxy-private|aes-gcm:|encryptedKey|encryptedCredentials/,
    );
  },
);

test(
  'missing credential keys leave settings readable but reject replacement and preserve recovery material',
  { timeout: 60000 },
  async (t) => {
    const f = await setup(t);
    const first = await f.start();
    const ai = await first.client.getAiSettings();
    const p = ai.providers[0];
    const input = {
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      enabled: true,
      models: p.models,
    };
    await first.client.saveAiProvider(
      p.id,
      { ...input, apiKey: 'fixture-recovery-secret' },
      ai.revision,
    );
    await first.close();
    const keyFile = path.join(f.root, 'keys', fs.readdirSync(path.join(f.root, 'keys'))[0]);
    const original = fs.readFileSync(keyFile);
    fs.rmSync(keyFile);
    const broken = await f.start();
    const current = await broken.client.getAiSettings();
    assert.equal(current.secretStorage.available, false);
    assert.equal(current.providers[0].hasApiKey, true);
    await assert.rejects(broken.client.prepareCredentials(), (e) => e.kind === 'unavailable');
    await assert.rejects(
      broken.client.saveAiProvider(p.id, { ...input, apiKey: 'must-not-save' }, current.revision),
      (e) => e.kind === 'unavailable',
    );
    assert.equal((await broken.client.getAiSettings()).revision, current.revision);
    assert.equal(fs.existsSync(keyFile), false);
    await broken.close();
    fs.writeFileSync(keyFile, original, { mode: 0o600 });
    original.fill(0);
    const recovered = await f.start();
    assert.equal((await recovered.client.getAiSettings()).secretStorage.available, true);
  },
);

test(
  'named token RPC keeps IDs and revisions across restart, masks events, and rejects stale deletion',
  { timeout: 60000 },
  async (t) => {
    const f = await setup(t);
    const first = await f.start();
    await first.client.subscribe(['accounts.tokens.changed']);
    const empty = await first.client.listAccessTokens();
    assert.equal(empty.tokens.length, 0);
    assert.equal(fs.existsSync(path.join(f.root, 'keys')), false);
    const saved = await first.client.saveAccessToken(null, {
      name: 'Fixture token',
      value: 'fixture-named-token-secret',
      revision: empty.revision,
    });
    const token = saved.tokens[0];
    assert.equal(saved.secretStorage.available, true);
    await assert.rejects(
      first.client.deleteAccessToken(token.id, empty.revision),
      (e) => e.kind === 'conflict',
    );
    await assert.rejects(
      first.client.request('accounts.tokens.credential', { id: token.id }),
      (e) => e.kind === 'unknown-method',
    );
    await first.close();
    const next = await f.start();
    const restored = await next.client.listAccessTokens();
    assert.deepEqual(restored, saved);
    const renamed = await next.client.saveAccessToken(token.id, {
      name: 'Renamed',
      revision: restored.revision,
    });
    assert.equal(renamed.tokens[0].id, token.id);
    const deleted = await next.client.deleteAccessToken(token.id, renamed.revision);
    assert.equal(deleted.tokens.length, 0);
    f.responses.push(saved, restored, renamed, deleted);
    assert.doesNotMatch(
      JSON.stringify(f.responses),
      /fixture-named-token-secret|aes-gcm:|ciphertext/,
    );
  },
);

test(
  'host profile RPC preserves stable identity and never returns connection passwords',
  { timeout: 60000 },
  async (t) => {
    const f = await setup(t);
    const first = await f.start();
    const empty = await first.client.listHostProfiles();
    const profile = {
      name: 'Fixture host',
      host: 'fixture.invalid',
      port: 22,
      username: 'fixture',
      authType: 'password',
      privateKeyPath: null,
      password: 'fixture-host-private-password',
    };
    const saved = await first.client.saveHostProfile(null, profile, empty.revision);
    assert.equal(saved.hosts[0].hasPassword, true);
    await assert.rejects(
      first.client.deleteHostProfile(saved.hosts[0].id, empty.revision),
      (e) => e.kind === 'conflict',
    );
    await assert.rejects(
      first.client.request('accounts.hosts.credential', { id: saved.hosts[0].id }),
      (e) => e.kind === 'unknown-method',
    );
    await first.close();
    const next = await f.start();
    const restored = await next.client.listHostProfiles();
    assert.deepEqual(restored, saved);
    const cleared = await next.client.saveHostProfile(
      saved.hosts[0].id,
      { ...profile, password: null },
      restored.revision,
    );
    assert.equal(cleared.hosts[0].id, saved.hosts[0].id);
    assert.equal(cleared.hosts[0].hasPassword, false);
    assert.doesNotMatch(
      JSON.stringify([saved, restored, cleared]),
      /fixture-host-private-password|aes-gcm:|password_secret/,
    );
  },
);

test(
  'closing an event subscriber after a completed write exits cleanly with its durable receipt intact',
  { timeout: 90000 },
  async (t) => {
    const f = await setup(t);
    for (let attempt = 0; attempt < 12; attempt++) {
      const child = await f.start();
      await child.client.subscribe(['*']);
      const settings = await child.client.getAiSettings();
      await child.client.saveCommitPreferences(
        { ...settings.commit, prompt: 'close fixture ' + attempt },
        settings.revision,
      );
      await child.close();
      assert.equal((await child.exited).code, 0, child.diagnostic());
    }
    const last = await f.start();
    assert.equal((await last.client.getAiSettings()).commit.prompt, 'close fixture 11');
  },
);
