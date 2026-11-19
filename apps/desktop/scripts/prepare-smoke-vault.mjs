// Between native smoke phases only: select the file vault in a new, disposable
// profile. Never open an existing OS credential record or replace any material.
// The smoke run uses an isolated file vault for credential restoration checks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export async function prepareSmokeVault(dataDir) {
  const root = fs.realpathSync.native(dataDir),
    relative = path.relative(fs.realpathSync.native(os.tmpdir()), root);
  assert.ok(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    'fixture must be inside temp',
  );
  const dir = fs.realpathSync.native(path.join(root, 'agent'));
  assert.equal(path.dirname(dir), root, 'fixture Agent must remain under its test directory');
  assert.ok(fs.existsSync(path.join(dir, 'identity.json')));
  const identity = await require('../../../packages/agent/dist/adapters/identity').loadIdentity(
    dir,
  );
  const { AgentState } = require('../../../packages/agent/dist/adapters/sqlite/state');
  const {
    openProtectedSecrets,
  } = require('../../../packages/agent/dist/adapters/secrets/protected');
  const state = await AgentState.open(dir, identity);
  try {
    const descriptor = state.document('credential-key');
    assert.equal(descriptor.read(), undefined, 'never replace an existing protected vault');
    assert.equal(state.hasCredentialMaterial(), false);
    const vault = await openProtectedSecrets(dir, identity, descriptor, {
      allowInitialize: true,
      backend: 'file',
    });
    try {
      assert.equal(vault.available, true);
      assert.equal(descriptor.read().backend, 'file');
    } finally {
      vault.close();
    }
  } finally {
    await state.close();
  }
}

export function checkTokenStorage(dataDir) {
  // Check the closed synthetic profile's SQLite files and diagnostic logs.
  // The ephemeral provider records only fact labels, never raw credentials.
  let databases = 0;
  const examine = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = path.join(dir, entry.name);
      if (entry.isDirectory()) examine(name);
      else if (entry.isFile() && /(?:\.sqlite(?:-wal|-journal)?|\.log)$/.test(entry.name)) {
        if (entry.name.endsWith('.sqlite')) databases++;
        const bytes = fs.readFileSync(name);
        for (const value of ['smoke-named-initial', 'smoke-named-replacement'])
          assert.equal(
            bytes.includes(Buffer.from(value)),
            false,
            'plaintext fixture token found in ' + entry.name,
          );
      }
    }
  };
  examine(path.join(dataDir, 'agent'));
  examine(path.join(dataDir, 'dedicated-test-logs'));
  assert.ok(databases > 0, 'expected an actual Agent database');
}
