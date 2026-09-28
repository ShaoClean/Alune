const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { certificate } = require('../../../packages/ssh-client/tests/helpers/proxy-fixture.cjs');

test('controlled proxy routes AI, updates, SSH and HTTPS/SSH Git with worktrees and configuration changes', { skip: process.platform === 'win32', timeout: 120_000 }, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(__dirname, 'proxy-scenario.cjs')], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: certificate }, timeout: 110_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.match(stdout, /PROXY_INTEGRATION_PASSED/);
});
