const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { keychainMasterKey } = require('../dist/adapters/secrets/keychain');
const { dpapi } = require('../dist/adapters/secrets/dpapi');

test(
  'macOS Keychain holds an immutable master key across child processes and fails closed while locked',
  { skip: process.platform !== 'darwin', timeout: 30000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-keychain-fixture-'));
    const keychain = path.join(root, 'fixture.keychain-db');
    const password = randomBytes(24).toString('base64');
    const account = randomUUID();
    const security = (...args) =>
      execFileSync('/usr/bin/security', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 10000,
      });
    let created = false;
    try {
      security('create-keychain', '-p', password, keychain);
      created = true;
      security('unlock-keychain', '-p', password, keychain);
      assert.equal(await keychainMasterKey(account, { create: false, keychain }), null);
      const first = await keychainMasterKey(account, { create: true, keychain });
      assert.equal(first.length, 32);
      const second = await keychainMasterKey(account, { create: true, keychain });
      assert.deepEqual(second, first);
      assert.deepEqual(await keychainMasterKey(account, { create: false, keychain }), first);
      security('lock-keychain', keychain);
      await assert.rejects(
        keychainMasterKey(account, { create: true, keychain }),
        (e) => e.kind === 'unavailable',
      );
      security('unlock-keychain', '-p', password, keychain);
      assert.deepEqual(await keychainMasterKey(account, { create: false, keychain }), first);
      first.fill(0);
      second.fill(0);
    } finally {
      if (created) security('delete-keychain', keychain);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'Windows DPAPI protects material for the current user and binds it to scope',
  { skip: process.platform !== 'win32', timeout: 30000 },
  async () => {
    const key = randomBytes(32);
    const scope = randomUUID();
    try {
      const sealed = await dpapi('protect', key, scope);
      assert(!sealed.equals(key));
      const restored = await dpapi('unprotect', sealed, scope);
      assert.deepEqual(restored, key);
      restored.fill(0);
      await assert.rejects(
        dpapi('unprotect', sealed, randomUUID()),
        (e) => e.kind === 'unavailable',
      );
      const bad = Buffer.from(sealed);
      bad[bad.length - 1] ^= 1;
      await assert.rejects(dpapi('unprotect', bad, scope), (e) => e.kind === 'unavailable');
      await assert.rejects(
        dpapi('protect', key, scope, AbortSignal.abort()),
        (e) => e.name === 'AbortError',
      );
    } finally {
      key.fill(0);
    }
  },
);
