import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../dist/candidate-app/', import.meta.url));
assert.equal(
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).main,
  'candidate-main.cjs',
);
for (const name of [
  'server',
  'legacy-backend.cjs',
  'node_modules/better-sqlite3',
  'node_modules/node-pty',
  'node_modules/@alune/agent',
  'node_modules/@alune/ssh-client',
  'node_modules/@alune/shared',
  'node_modules/@nestjs',
])
  assert.equal(
    existsSync(join(root, name)),
    false,
    'Unexpected candidate runtime dependency: ' + name,
  );
for (const file of [
  'web/index.html',
  'node_modules/@alune/agent-client/dist/node.js',
  'candidate-main.cjs',
  'desktop-agent.cjs',
])
  assert.ok(existsSync(join(root, file)), file);
