const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('Windows CRLF checkout plus npm shebang normalization leaves the Agent bin clean', () => {
  const root = path.resolve(__dirname, '../../..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-agent-checkout-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );
  env.GIT_CONFIG_GLOBAL = path.join(temp, 'empty-config');
  env.GIT_CONFIG_NOSYSTEM = '1';
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  const git = (...args) =>
    execFileSync('git', ['-C', temp, ...args], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const relative = 'packages/agent/bin/alune-agent.cjs';
  const file = path.join(temp, relative);
  try {
    git('init', '-q');
    git('config', 'core.autocrlf', 'true');
    git('config', 'core.filemode', 'false');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'commit.gpgSign', 'false');
    fs.copyFileSync(path.join(root, '.gitattributes'), path.join(temp, '.gitattributes'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(root, relative), file);
    git('add', '.gitattributes', relative);
    git('commit', '-qm', 'fixture');
    fs.unlinkSync(file);
    git('checkout', '--', relative);
    const before = fs.readFileSync(file, 'utf8');
    assert.equal(before.includes('\r'), false);
    // bin-links normalizes a CRLF shebang after workspace bin linking.
    fs.writeFileSync(file, before.replace(/^(#![^\n]+)\r\n/, '$1\n'));
    assert.equal(git('status', '--porcelain', '--untracked-files=no'), '');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
