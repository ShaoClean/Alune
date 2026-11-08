import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const p = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(p) : [p];
});
test('retired execution workspaces cannot be built or resolved from the lockfile', () => {
  for (const p of ['apps/server', 'packages/shared', 'packages/ssh-client']) assert.equal(fs.existsSync(path.join(root, p)), false, p);
  const lock = JSON.parse(read('package-lock.json'));
  for (const p of Object.keys(lock.packages)) assert(!/(?:^|\/)(?:apps\/server|packages\/(?:shared|ssh-client)|node_modules\/(?:@nestjs\/|@alune\/(?:shared|ssh-client)|socket\.io(?:-client|-adapter|-parser)?(?:\/|$)|engine\.io(?:-client|-parser)?(?:\/|$)))/.test(p), p);
});
test('default browser source has no old HTTP or Socket.IO business transport', () => {
  for (const file of walk(path.join(root, 'apps/web/src')).filter(p => /\.(?:ts|tsx)$/.test(p))) {
    const source = fs.readFileSync(file, 'utf8');
    assert(!/from ['"](?:axios|socket\.io-client|@alune\/(?:shared|ssh-client))['"]/.test(source), file);
    assert(!/axios\.create|baseURL:\s*['"]\/api|fetch\(['"]\/api/.test(source), file);
  }
});
test('ordinary desktop cannot select or package the legacy backend', () => {
  assert.equal(fs.existsSync(path.join(root, 'apps/desktop/src/legacy-backend.cjs')), false);
  const main = read('apps/desktop/src/main.cjs');
  assert(main.includes('startDesktopAgent'));
  assert(!/require\(['"]\.\/server\/|startLegacyBackend|ALUNE_DESKTOP_EXECUTOR/.test(main));
  for (const p of ['apps/desktop/package.json', 'apps/desktop/scripts/stage.mjs', 'apps/desktop/electron-builder.cjs']) {
    const source = read(p);
    assert(!/apps\/server\/dist|\.\.\.server\??\.dependencies|['"]server['"]\s*:\s*['"]\*/.test(source), p);
  }
});
test('read-only migration and encrypted recovery remain available', () => {
  for (const p of ['apps/desktop/src/agent-import.cjs', 'apps/desktop/src/legacy-agent-secrets.cjs', 'packages/agent/src/modules/migration/legacy.ts', 'packages/agent/src/adapters/migration/recovery.ts']) assert(fs.existsSync(path.join(root, p)), p);
  assert(!read('packages/agent/src/bootstrap/state-kernel.ts').includes('legacyReads'));
});
