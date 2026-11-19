import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
if (process.argv.slice(2).some((arg) => arg !== '--default'))
  throw new Error('Usage: check-candidate.mjs [--default]');
const candidate = !process.argv.includes('--default');
const root = fileURLToPath(new URL(candidate ? '../dist/candidate-app/' : '../dist/app/', import.meta.url));
assert.equal(
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).main,
  candidate ? 'candidate-main.cjs' : 'main.cjs',
);
for (const name of [
  'packages/agent',
  'node_modules/better-sqlite3',
  'node_modules/node-pty',
  'node_modules/@alune/agent',
])
  assert.equal(
    existsSync(join(root, name)),
    false,
    'Unexpected desktop runtime dependency: ' + name,
  );
for (const file of [
  'web/index.html',
  'node_modules/@alune/agent-client/dist/node.js',
  'candidate-main.cjs',
  'main.cjs',
  'desktop-agent.cjs',
])
  assert.ok(existsSync(join(root, file)), file);
