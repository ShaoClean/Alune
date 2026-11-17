// Install a real DMG into a private temporary application directory and run the
// existing full native write/restore assertions with disposable application data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const [dmgArg, outputArg] = process.argv.slice(2);
if (!outputArg) throw Error('Usage: local-mac-installed.mjs DMG NEW_EVIDENCE_DIRECTORY');
assert.equal(process.platform + '-' + process.arch, 'darwin-arm64');
const dmg = fs.realpathSync(dmgArg), output = path.resolve(outputArg);
fs.mkdirSync(output, { recursive: false });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const enumerate = (base, dir) => fs.readdirSync(path.join(base, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? enumerate(base, dir + '/' + e.name) : [dir + '/' + e.name]);
const inputs = Object.fromEntries(['apps/desktop/src', 'apps/desktop/scripts', 'scripts/archive/agent-acceptance', 'apps/web/src', 'packages/agent/src', 'packages/domain/src', 'packages/protocol/src', 'packages/agent-client/src'].flatMap(dir => enumerate(root, dir)).map(file => [file, digest(fs.readFileSync(path.join(root, file)))]));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-installed-mac-'));
const mount = path.join(scratch, 'mount'), app = path.join(scratch, 'installed/Alune.app');
fs.mkdirSync(mount); fs.mkdirSync(path.dirname(app));
let mounted = false;
const steps = [];
function run(name, command, args, options = {}) {
  console.log('Running ' + name);
  const fd = fs.openSync(path.join(output, name + '.log'), 'wx');
  let result;
  try { result = spawnSync(command, args, { cwd: root, stdio: ['ignore', fd, fd], timeout: 150000, ...options }); }
  finally { fs.closeSync(fd); }
  steps.push({ name, command, args, status: result.status, log: { path: name + '.log', sha256: digest(fs.readFileSync(path.join(output, name + '.log'))) } });
  assert.equal(result.status, 0, name + ' failed; inspect its log');
}
try {
  run('mount', '/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg]); mounted = true;
  run('install', '/usr/bin/ditto', [path.join(mount, 'Alune.app'), app]);
  run('detach', '/usr/bin/hdiutil', ['detach', mount]); mounted = false;
  const manifestPath = 'Contents/Resources/agent-runtime/manifest.json';
  const installedManifestFile = path.join(app, manifestPath);
  assert(fs.existsSync(installedManifestFile), 'Installed application must contain the independent Agent manifest');
  const manifestBytes = fs.readFileSync(installedManifestFile), manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.sourceSha, sha); assert.equal(manifest.target, 'darwin-arm64');
  for (const [file, expected] of Object.entries(manifest.files)) assert.equal(digest(fs.readFileSync(path.join(path.dirname(installedManifestFile), file))), expected, file);
  fs.writeFileSync(path.join(output, 'agent-manifest.json'), manifestBytes);
  const assets = Object.fromEntries(['Contents/Info.plist', 'Contents/Resources/app.asar', manifestPath].map(file => [file, digest(fs.readFileSync(path.join(app, file)))]));
  const env = { ...process.env, ALUNE_TEST_EXECUTABLE: path.join(app, 'Contents/MacOS/Alune'), ALUNE_CANDIDATE_EVIDENCE: path.join(output, 'raw'), ALUNE_ACCEPTANCE_SHA: sha };
  for (const key of ['CI', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'ELECTRON_RUN_AS_NODE', 'ALUNE_CANDIDATE_FOCUS']) delete env[key];
  run('native', process.execPath, ['scripts/smoke.mjs'], { cwd: path.join(root, 'apps/desktop'), env, timeout: 1250000 });
  for (const phase of ['write', 'restore']) {
    const complete = JSON.parse(fs.readFileSync(path.join(output, 'raw/complete-' + phase + '.json')));
    assert.equal(complete.sha, sha); assert.equal(complete.result, 'passed'); assert.equal(complete.focus, null);
  }
  for (const [file, expected] of Object.entries(inputs)) assert.equal(digest(fs.readFileSync(path.join(root, file))), expected, 'Source changed during installed test: ' + file);
  const proof = { sha, target: 'darwin-arm64', dmg: { path: dmg, sha256: digest(fs.readFileSync(dmg)) }, assets, inputs, results: steps,
    dirty: execFileSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' }),
    assertion: 'Real DMG installed via read-only mount and ditto; installed executable completes unfocused native write and restore with isolated synthetic repositories/data.',
    limitations: 'Current dirty working-source desktop artifact. Signature-command fixture and update smoke adapter remain in the existing native suite. This does not certify old released safeStorage upgrade/normal rollback, real updater download/relaunch or a clean desktop build.' };
  fs.writeFileSync(path.join(output, 'installed.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log('Installed Mac write/restore passed');
} finally {
  fs.writeFileSync(path.join(output, 'execution.json'), JSON.stringify(steps, null, 2) + '\n');
  if (mounted) execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: 'ignore' });
  fs.rmSync(scratch, { recursive: true, force: true });
}
