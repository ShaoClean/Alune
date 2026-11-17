// Fail this specific clean-checkout gate if legacy code, stale dist or a
// desktop dependency could have made the independent Agent job pass.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const [phase, target = 'agent'] = process.argv.slice(2);
assert.ok(['agent', 'desktop-candidate'].includes(target), 'unknown clean-checkout target');
for (const file of [
  'packages/agent/package.json',
  'apps/web/package.json',
  'apps/desktop/src/legacy-agent-secrets.cjs',
  ...(target === 'desktop-candidate' ? ['apps/desktop/package.json'] : []),
])
  assert.ok(fs.existsSync(file), 'required sparse source missing: ' + file);
assert.ok(
  ['before-install', 'after-install'].includes(phase),
  'expected before-install or after-install',
);
for (const file of [
  'apps/server',
  'packages/shared',
  'packages/ssh-client',
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
  for (const name of [
    ...(target === 'agent' ? ['electron'] : []),
    '@nestjs/core',
    '@alune/shared',
    '@alune/ssh-client',
    'server',
  ])
    assert.throws(
      () => require.resolve(name),
      { code: 'MODULE_NOT_FOUND' },
      name + ' must not be resolvable',
    );
}
console.log('Independent checkout ' + phase + ': no legacy workspaces or prebuilt outputs.');
