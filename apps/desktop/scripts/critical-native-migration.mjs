import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const checkout = fileURLToPath(new URL('../../../', import.meta.url));
const [releaseDirArg, nodeArg, outArg] = process.argv.slice(2);
if (!outArg || process.argv.length !== 5) throw Error('Usage: critical-native-migration.mjs VERIFIED_RELEASE_DIRECTORY NODE22 NEW_OUTPUT');
assert.equal(process.platform + '-' + process.arch, 'darwin-arm64');
const releaseDir = fs.realpathSync(releaseDirArg), node = fs.realpathSync(nodeArg), out = path.resolve(outArg);
const hash = value => createHash('sha256').update(value).digest('hex');
const dmg = path.join(releaseDir, 'Alune-0.11.0-mac-arm64.dmg');
const expected = 'c12e18d92c1b901645f274ef7e73dd052249a0f1f64f26faf5f59cf98761a554';
assert.equal(hash(fs.readFileSync(dmg)), expected);
assert(fs.readFileSync(path.join(releaseDir, 'SHA256SUMS'), 'utf8').includes(expected + '  Alune-0.11.0-mac-arm64.dmg'));
const releaseApp = path.join(releaseDir, 'Alune.app');
const asar = path.join(releaseApp, 'Contents/Resources/app.asar');
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alune-critical-native-')));
fs.mkdirSync(out, { mode: 0o700 });
const name = 'Alune Critical ' + randomUUID(), service = name + ' Safe Storage';
const marker = { version: 1, name };
fs.writeFileSync(path.join(scratch, 'fixture-marker.json'), JSON.stringify(marker), { mode: 0o600 });
fs.mkdirSync(path.join(scratch, 'electron-data'), { mode: 0o700 });
const keychain = path.join(scratch, 'destination.keychain-db'), password = randomBytes(32).toString('base64');
const security = args => spawnSync('/usr/bin/security', args, { stdio: 'pipe', timeout: 15000 });
assert.notEqual(security(['find-generic-password', '-s', service]).status, 0, 'fixture name must not exist');
const inputs = Object.fromEntries(['critical-native-migration.mjs', 'critical-native-migration-electron.cjs', 'critical-native-migration-worker.cjs'].map(file => [file, hash(fs.readFileSync(path.join(checkout, 'apps/desktop/scripts', file)))]));
const currentInputs = {};
function tree(directory) {
  const result = {};
  function visit(at, prefix = '') {
    for (const e of fs.readdirSync(at, { withFileTypes: true })) {
      const file = path.join(at, e.name), name = prefix + e.name;
      if (e.isDirectory()) visit(file, name + '/');
      else if (e.isFile()) result[name] = hash(fs.readFileSync(file));
      else if (e.isSymbolicLink()) result[name] = { link: fs.readlinkSync(file) };
      else assert.fail('Unexpected input file type');
    }
  }
  visit(directory); return result;
}
for (const dir of ['packages/agent/src', 'packages/agent/dist', 'packages/protocol/src', 'packages/protocol/dist', 'packages/domain/src', 'packages/domain/dist']) currentInputs[dir] = tree(path.join(checkout, dir));
let created = false, status;
try {
  // Establish that the modules and native dependencies really came from the
  // checksum-verified disk image, rather than trusting a previously copied app.
  const mount = path.join(scratch, 'release-mount'); fs.mkdirSync(mount);
  execFileSync('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg], { stdio: 'pipe', timeout: 60000 });
  let releasedFiles;
  try { releasedFiles = tree(path.join(mount, 'Alune.app')); assert.deepEqual(tree(releaseApp), releasedFiles); }
  finally { execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: 'pipe', timeout: 30000 }); }
  fs.writeFileSync(path.join(out, 'released-files.json'), JSON.stringify(releasedFiles, null, 2));
  assert.equal(security(['create-keychain', '-p', password, keychain]).status, 0); created = true;
  assert.equal(security(['unlock-keychain', '-p', password, keychain]).status, 0);
  const env = { ...process.env, ALUNE_CRITICAL_FIXTURE: scratch, ALUNE_CRITICAL_NODE: node, ALUNE_CRITICAL_RELEASE_APP: releaseApp };
  for (const key of ['CI', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) delete env[key];
  const fd = fs.openSync(path.join(out, 'native.log'), 'wx', 0o600);
  let result;
  try { result = spawnSync(require('electron'), [path.join(checkout, 'apps/desktop/scripts/critical-native-migration-electron.cjs')], { env, stdio: ['ignore', fd, fd], timeout: 180000 }); }
  finally { fs.closeSync(fd); }
  status = { status: result.status, signal: result.signal, error: result.error?.message };
  assert.equal(result.status, 0, 'inspect native.log');
  for (const [dir, expectedInputs] of Object.entries(currentInputs)) assert.deepEqual(tree(path.join(checkout, dir)), expectedInputs, 'current implementation changed during native run');
  // Verify safeStorage really used our unique service before deleting it.
  assert.equal(security(['find-generic-password', '-s', service]).status, 0, 'unique safeStorage service was not created');
  for (const file of ['node-result.json', 'electron-result.json']) fs.copyFileSync(path.join(scratch, file), path.join(out, file));
  fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({
    result: 'passed', policy: 'mac-arm64-local-2026-11-08',
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim(),
    artifact: { version: '0.11.0', dmgSha256: expected, asarSha256: hash(fs.readFileSync(asar)), filesComparedToReadOnlyImage: Object.keys(releasedFiles).length }, inputs, currentInputs,
    scope: 'Actual released credential modules under a unique Electron application name, native safeStorage source and isolated Keychain destination; complete stopped synthetic source backup/restore plus encrypted Agent recovery after original identity/key loss.',
    limitations: 'Does not boot the unmodified released application with its normal Alune identity, exercise installer UI, or certify installed application upgrade/rollback. Current Agent is from a dirty working tree. No user credentials.',
  }, null, 2));
  console.log('Released-module native credential migration and full fixture recovery passed');
} finally {
  const cleanup = {};
  const exists = security(['find-generic-password', '-s', service]).status === 0;
  if (exists) assert.equal(security(['delete-generic-password', '-s', service]).status, 0);
  cleanup.uniqueSafeStorageAbsent = security(['find-generic-password', '-s', service]).status !== 0;
  if (created) assert.equal(security(['delete-keychain', keychain]).status, 0);
  cleanup.destinationKeychainRemoved = !fs.existsSync(keychain);
  fs.rmSync(scratch, { recursive: true, force: true }); cleanup.scratchRemoved = !fs.existsSync(scratch);
  fs.writeFileSync(path.join(out, 'execution.json'), JSON.stringify({ ...status, cleanup, log: { path: 'native.log', sha256: fs.existsSync(path.join(out, 'native.log')) ? hash(fs.readFileSync(path.join(out, 'native.log'))) : null } }, null, 2));
}
