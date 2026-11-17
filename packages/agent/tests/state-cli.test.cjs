const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { spawnAgent } = require('@alune/agent-client/node');
const cli = path.resolve(__dirname, '../bin/alune-agent.cjs');

test(
  'CLI owns a single state writer and backup/restore preserve Agent identity',
  { timeout: 60000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-state-cli-'));
    const children = [];
    t.after(async () => {
      await Promise.all(children.map((c) => c.close()));
      fs.rmSync(root, { recursive: true, force: true });
    });
    const a = spawnAgent(process.execPath, [cli, 'serve', '--data-dir', root]);
    children.push(a);
    const identity = await a.client.initialize();
    assert.equal(identity.protocol.minor, require('@alune/protocol').PROTOCOL_VERSION.minor);
    assert.equal((await a.client.storageStatus()).writer, true);
    const receipt = await a.client.backupDatabase();
    assert.equal(receipt.scope, 'database-only');
    const backup = path.join(root, 'backups', receipt.backupId);
    const before = fs.readFileSync(path.join(root, 'state/current.json'));
    const refused = spawnSync(
      process.execPath,
      [cli, 'state-restore', '--data-dir', root, '--backup', backup],
      { encoding: 'utf8', timeout: 20000 },
    );
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /already has a writer/);
    assert.deepEqual(fs.readFileSync(path.join(root, 'state/current.json')), before);
    await a.close();
    assert.equal((await a.exited).code, 0);
    const restored = spawnSync(
      process.execPath,
      [cli, 'state-restore', '--data-dir', root, '--backup', backup],
      { encoding: 'utf8', timeout: 20000 },
    );
    assert.equal(restored.status, 0, restored.stderr);
    const result = JSON.parse(restored.stdout);
    const b = spawnAgent(process.execPath, [cli, 'serve', '--data-dir', root]);
    children.push(b);
    const next = await b.client.initialize();
    assert.equal(next.agentId, identity.agentId);
    assert.equal((await b.client.request('storage.status')).generation, result.generation);
    await b.close();
    const offline = spawnSync(process.execPath, [cli, 'state-backup', '--data-dir', root], {
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(offline.status, 0, offline.stderr);
    assert.equal(JSON.parse(offline.stdout).scope, 'database-only');
  },
);

test(
  'an existing state directory with a missing identity never gets a replacement UUID',
  { timeout: 30000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-state-identity-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const a = spawnAgent(process.execPath, [cli, 'serve', '--data-dir', root]);
    try {
      await a.client.initialize();
    } finally {
      await a.close();
    }
    fs.unlinkSync(path.join(root, 'identity.json'));
    const b = spawnAgent(process.execPath, [cli, 'serve', '--data-dir', root]);
    try {
      await assert.rejects(b.client.initialize());
      await b.exited;
    } finally {
      await b.close();
    }
    assert.equal(fs.existsSync(path.join(root, 'identity.json')), false);
  },
);
