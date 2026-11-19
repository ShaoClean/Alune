// Verify the isolated jobs start from source and use their own toolchain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const [phase, target = 'agent'] = process.argv.slice(2);
assert.ok(['agent', 'desktop-candidate'].includes(target), 'unknown clean-checkout target');
for (const file of [
  'packages/agent/package.json',
  'apps/web/package.json',
  ...(target === 'desktop-candidate' ? ['apps/desktop/package.json'] : []),
])
  assert.ok(fs.existsSync(file), 'required sparse source missing: ' + file);
assert.ok(
  ['before-install', 'after-install'].includes(phase),
  'expected before-install or after-install',
);
for (const file of [
  ...(target === 'agent'
    ? ['apps/desktop/package.json']
    : ['apps/desktop/dist', 'apps/desktop/release']),
  ...[
    'packages/agent',
    'packages/agent-client',
    'packages/domain',
    'packages/protocol',
    'apps/web',
  ].map((p) => p + '/dist'),
]) {
  assert.equal(
    fs.existsSync(file),
    false,
    file + ' is not allowed at the start of the independent job',
  );
}
if (phase === 'before-install')
  assert.equal(fs.existsSync('node_modules'), false, 'use a fresh checkout');
else {
  const require = createRequire(import.meta.url);
  // Windows VS 2026 is not recognized by npm 10's bundled node-gyp 11.
  // better-sqlite3 builds from source; the Agent declares its compiler
  // driver itself instead of inheriting it transitively from Electron.
  assert.equal(
    require('node-gyp/package.json').version,
    require('../../packages/agent/package.json').devDependencies['node-gyp'],
  );
  if (target === 'agent')
    assert.throws(() => require.resolve('electron'), { code: 'MODULE_NOT_FOUND' });
}
console.log('Independent checkout verified: ' + phase);
