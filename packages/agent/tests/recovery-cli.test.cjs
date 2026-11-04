const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AgentState } = require('../dist/adapters/sqlite/state');
const { loadIdentity } = require('../dist/adapters/identity');
const cli = path.resolve(__dirname, '../bin/alune-agent.cjs');
test(
  'recovery CLI reads passphrases only from stdin and restores identity and public state',
  { timeout: 90000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-recovery-cli-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const directory = path.join(root, 'agent'),
      agentId = await loadIdentity(directory);
    const state = await AgentState.open(directory, agentId);
    const document = state.document('fixture');
    document.read();
    document.write({ retained: 'fixture data' });
    await state.close();
    const output = path.join(root, 'state.recovery');
    const run = (args, input = 'fixture-cli-passphrase\n') =>
      spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8', timeout: 45000 });
    const backed = run(['recovery-backup', '--data-dir', directory, '--output', output]);
    assert.equal(backed.status, 0, backed.stderr);
    assert.equal(JSON.parse(backed.stdout).scope, 'identity-state-and-credentials');
    const destination = path.join(root, 'restored');
    const wrong = run(
      ['recovery-restore', '--data-dir', destination, '--input', output],
      'fixture-wrong-passphrase\n',
    );
    assert.notEqual(wrong.status, 0);
    assert.equal(fs.existsSync(destination), false);
    const restored = run(['recovery-restore', '--data-dir', destination, '--input', output]);
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(JSON.parse(restored.stdout).agentId, agentId);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(destination, 'identity.json'))).agentId,
      agentId,
    );
    const reopened = await AgentState.open(destination, agentId);
    try {
      assert.deepEqual(reopened.document('fixture').read(), { retained: 'fixture data' });
    } finally {
      await reopened.close();
    }
    const short = run(
      ['recovery-backup', '--data-dir', directory, '--output', path.join(root, 'bad')],
      'short\n',
    );
    assert.notEqual(short.status, 0);
    assert.equal(fs.existsSync(path.join(root, 'bad')), false);
    assert.doesNotMatch(
      backed.stdout +
        backed.stderr +
        wrong.stdout +
        wrong.stderr +
        restored.stdout +
        restored.stderr,
      /fixture-cli-passphrase|fixture-wrong-passphrase/,
    );
  },
);
