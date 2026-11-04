const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { AgentState } = require('../dist/adapters/sqlite/state');
const { openProtectedSecrets } = require('../dist/adapters/secrets/protected');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-protected-secrets-'));
  const id = randomUUID();
  const state = await AgentState.open(root, id);
  const stores = [];
  const document = () => state.document('credential-key');
  t.after(async () => {
    for (const store of stores) store.close();
    await state.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    id,
    state,
    document,
    keyFile() {
      return path.join(root, 'keys', document().read().keyId + '.key');
    },
    async open(options = {}, port = document()) {
      const store = await openProtectedSecrets(root, id, port, {
        allowInitialize: true,
        backend: 'file',
        ...options,
      });
      stores.push(store);
      return store;
    },
  };
}

test(
  'protected credentials survive reopen and authenticate ciphertext; closed stores cannot access keys',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const first = await f.open();
    const secret = 'fixture-password-密码';
    const encrypted = first.encrypt(secret);
    assert(!encrypted.includes(secret));
    assert.equal(first.decrypt(encrypted), secret);
    const descriptor = f.document().read();
    assert.equal(descriptor.status, 'ready');
    assert(!JSON.stringify(descriptor).includes(fs.readFileSync(f.keyFile()).toString('base64')));
    first.close();
    assert.equal(first.available, false);
    assert.throws(
      () => first.decrypt(encrypted),
      (e) => e.kind === 'unavailable',
    );
    assert.throws(
      () => first.encrypt(secret),
      (e) => e.kind === 'unavailable',
    );
    const next = await f.open({ allowInitialize: false });
    assert.equal(next.decrypt(encrypted), secret);
    const bad = Buffer.from(encrypted.slice(11), 'base64');
    bad[bad.length - 1] ^= 1;
    assert.throws(
      () => next.decrypt('aes-gcm:v1:' + bad.toString('base64')),
      (e) => e.kind === 'corrupt',
    );
    assert.throws(
      () => next.decrypt(encrypted + '\n'),
      (e) => e.kind === 'corrupt',
    );
  },
);

test(
  'ready credentials never regenerate missing, truncated or mismatched keys',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const store = await f.open();
    const encrypted = store.encrypt('retained fixture');
    store.close();
    const file = f.keyFile();
    const original = fs.readFileSync(file);
    const descriptor = f.document().read();
    fs.rmSync(file);
    await assert.rejects(f.open(), (e) => e.kind === 'unavailable');
    assert.equal(fs.existsSync(file), false);
    for (const invalid of [Buffer.from('broken'), randomBytes(32)]) {
      fs.writeFileSync(file, invalid, { mode: 0o600 });
      await assert.rejects(f.open(), (e) => e.kind === 'corrupt');
      assert.deepEqual(fs.readFileSync(file), invalid);
      assert.deepEqual(f.document().read(), descriptor);
    }
    fs.writeFileSync(file, original);
    const recovered = await f.open();
    assert.equal(recovered.decrypt(encrypted), 'retained fixture');
    original.fill(0);
  },
);

test(
  'interrupted initialization resumes the persisted key intent without replacing the key',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const port = f.document();
    const fault = {
      read: () => port.read(),
      write(value) {
        if (value.status === 'ready') throw new Error('fixture durable write failure');
        port.write(value);
      },
    };
    await assert.rejects(f.open({}, fault), (e) => e.kind === 'unavailable');
    assert.equal(f.document().read().status, 'pending');
    const key = fs.readFileSync(f.keyFile());
    const resumed = await f.open();
    assert.deepEqual(fs.readFileSync(f.keyFile()), key);
    assert.equal(f.document().read().status, 'ready');
    assert.equal(resumed.decrypt(resumed.encrypt('resumed')), 'resumed');
    key.fill(0);
  },
);

test(
  'missing or corrupt descriptors and fixed backend mismatches fail without overwriting state',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    await assert.rejects(f.open({ allowInitialize: false }), (e) => e.kind === 'unavailable');
    assert.equal(fs.existsSync(path.join(f.root, 'keys')), false);
    const port = f.document();
    port.read();
    port.write(null);
    await assert.rejects(f.open(), (e) => e.kind === 'corrupt');
    assert.equal(f.document().read(), null);
    const other = f.state.document('other-key');
    const store = await f.open({}, other);
    store.close();
    const original = other.read();
    await assert.rejects(f.open({ backend: 'keychain' }, other), (e) => e.kind === 'conflict');
    assert.deepEqual(other.read(), original);
  },
);

test(
  'credential ciphertext is bound to the Agent identity even with identical master bytes',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const first = await f.open();
    const encrypted = first.encrypt('identity bound');
    const otherId = randomUUID();
    const item = { ...f.document().read(), agentId: otherId };
    const second = await openProtectedSecrets(
      f.root,
      otherId,
      {
        read: () => item,
        write() {
          throw Error('unexpected write');
        },
      },
      { allowInitialize: false, backend: 'file' },
    );
    try {
      assert.throws(
        () => second.decrypt(encrypted),
        (e) => e.kind === 'corrupt',
      );
    } finally {
      second.close();
    }
  },
);

test(
  'credential key paths reject links and cancellation leaves no initialized descriptor',
  { skip: process.platform === 'win32', timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    await assert.rejects(f.open({ signal: AbortSignal.abort() }), (e) => e.name === 'AbortError');
    assert.equal(f.document().read(), undefined);
    const store = await f.open();
    store.close();
    const file = f.keyFile();
    const original = file + '.original';
    fs.renameSync(file, original);
    fs.symlinkSync(original, file);
    await assert.rejects(f.open(), (e) => e.kind === 'permission');
    assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
    fs.rmSync(file);
    fs.linkSync(original, file);
    await assert.rejects(f.open(), (e) => e.kind === 'permission');
  },
);
