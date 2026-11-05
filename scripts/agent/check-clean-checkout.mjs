// Fail this specific clean-checkout gate if legacy code, stale dist or a
// desktop dependency could have made the independent Agent job pass.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const [phase] = process.argv.slice(2);
assert.ok(
  ['before-install', 'after-install'].includes(phase),
  'expected before-install or after-install',
);
for (const file of [
  'apps/server',
  'packages/shared',
  'packages/ssh-client',
  'apps/desktop/package.json',
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
  for (const name of ['electron', '@nestjs/core', '@alune/shared', '@alune/ssh-client', 'server'])
    assert.throws(
      () => require.resolve(name),
      { code: 'MODULE_NOT_FOUND' },
      name + ' must not be resolvable',
    );
}
console.log('Independent checkout ' + phase + ': no legacy workspaces or prebuilt outputs.');
