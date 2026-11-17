// Fresh committed business source plus explicitly hashed acceptance drivers.
// No root dist/node_modules or dirty business modules enter the desktop build.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readPolicy } from './acceptance-policy.mjs';
const root = fileURLToPath(new URL("../../../", import.meta.url));
const [runtimeArg, outputArg, policyFile] = process.argv.slice(2);
if (!policyFile) throw Error('Usage: local-clean-desktop-mac.mjs VERIFIED_RUNTIME_BUNDLE NEW_OUTPUT POLICY');
assert.equal(process.platform + '-' + process.arch, 'darwin-arm64');
const policy = readPolicy(policyFile); assert.equal(policy.id, 'mac-arm64-local-2026-11-08');
const digest = value => createHash('sha256').update(value).digest('hex');
const runtime = fs.realpathSync(runtimeArg), output = path.resolve(outputArg);
const runtimeManifest = JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json')));
const interpreter = path.join(runtime, runtimeManifest.node.executable);
assert.equal(digest(fs.readFileSync(interpreter)), runtimeManifest.files[runtimeManifest.node.executable]);
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
fs.mkdirSync(output, { recursive: false });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-clean-desktop-'));
const checkout = path.join(scratch, 'source'), bundle = path.join(scratch, 'bundle'), release = path.join(scratch, 'release');
const node = path.join(scratch, 'sdk/bin/node');
fs.mkdirSync(path.dirname(node), { recursive: true }); fs.copyFileSync(interpreter, node); fs.chmodSync(node, 0o755);
const headers = path.join(os.homedir(), 'Library/Caches/node-gyp', runtimeManifest.node.version, 'include/node');
fs.cpSync(headers, path.join(scratch, 'sdk/include/node'), { recursive: true });
const npm = fs.realpathSync(execFileSync('/usr/bin/which', ['npm'], { encoding: 'utf8' }).trim());
const builder = path.join(root, 'node_modules/electron-builder/cli.js');
const env = { ...process.env, PATH: path.dirname(node) + path.delimiter + process.env.PATH, ELECTRON_SKIP_BINARY_DOWNLOAD: '1', PI_SCRATCH_DIR: scratch };
for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'CI', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT']) delete env[key];
const steps = [];
function run(name, executable, args, options = {}) {
  console.log('Running ' + name);
  const fd = fs.openSync(path.join(output, name + '.log'), 'wx');
  let result;
  try { result = spawnSync(executable, args, { cwd: checkout, env, stdio: ['ignore', fd, fd], timeout: 900000, ...options }); }
  finally { fs.closeSync(fd); }
  steps.push({ name, executable, args, status: result.status, signal: result.signal, log: { path: name + '.log', sha256: digest(fs.readFileSync(path.join(output, name + '.log'))) } });
  assert.equal(result.status, 0, name + ' failed; inspect its log'); console.log('Passed ' + name);
}
let mounted = false;
const mount = path.join(scratch, 'mount');
try {
  run('clone', 'git', ['clone', '--shared', '--no-checkout', root, checkout], { cwd: scratch });
  run('checkout', 'git', ['checkout', '--detach', sha]);
  run('before-install', node, ['scripts/agent/check-clean-checkout.mjs', 'before-install', 'desktop-candidate']);
  run('install', node, [npm, 'ci', '--workspace=desktop', '--workspace=web', '--workspace=@alune/agent', '--workspace=@alune/agent-client', '--workspace=@alune/domain', '--workspace=@alune/protocol', '--workspace=@alune/ui', '--include-workspace-root=false', '--no-audit', '--no-fund']);
  run('after-install', node, ['scripts/agent/check-clean-checkout.mjs', 'after-install', 'desktop-candidate']);
  run('agent-build', node, [npm, 'run', 'build', '-w', '@alune/agent']);
  run('web-build', node, [npm, 'run', 'build', '-w', 'web']);
  run('package-agent', node, ['scripts/agent/package.mjs', '--output', bundle]);
  const agentBytes = fs.readFileSync(path.join(bundle, 'manifest.json')), agentManifest = JSON.parse(agentBytes);
  assert.equal(agentManifest.sourceSha, sha); assert.equal(agentManifest.dirty, false);
  assert.equal(execFileSync('git', ['status', '--porcelain=v1'], { cwd: checkout, encoding: 'utf8' }).trim(), '');
  fs.writeFileSync(path.join(output, 'agent-manifest.json'), agentBytes);
  const drivers = ['apps/desktop/scripts/smoke.mjs', 'apps/desktop/scripts/signature-failure-fixture.mjs', 'apps/desktop/src/candidate-history-recovery.cjs', 'apps/desktop/src/candidate-change-safety.cjs', 'apps/desktop/src/candidate-terminal-actions.cjs', 'apps/desktop/src/candidate-ui-driver.cjs', 'apps/desktop/src/candidate-workbench.cjs'];
  const fixtureInputs = Object.fromEntries(drivers.map(file => {
    const bytes = fs.readFileSync(path.join(root, file));
    fs.writeFileSync(path.join(checkout, file), bytes);
    const snapshot = path.join(output, 'fixture-sources', file); fs.mkdirSync(path.dirname(snapshot), { recursive: true }); fs.writeFileSync(snapshot, bytes);
    return [file, digest(bytes)];
  }));
  const files = execFileSync('git', ['ls-files'], { cwd: checkout, encoding: 'utf8' }).trim().split('\n');
  const sourceInputs = {};
  for (const file of files) if (!drivers.includes(file)) {
    const bytes = fs.readFileSync(path.join(checkout, file));
    assert(bytes.equals(execFileSync('git', ['show', sha + ':' + file], { cwd: checkout, maxBuffer: 32 * 1024 * 1024 })), 'Business source differs from committed HEAD: ' + file);
    sourceInputs[file] = digest(bytes);
  }
  fs.writeFileSync(path.join(output, 'source-state.json'), JSON.stringify({ sha, businessSourceClean: true, sourceInputs, fixtureInputs, node: runtimeManifest.node, driverSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))), interpreterSha256: digest(fs.readFileSync(node)), builderVersion: JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron-builder/package.json'))).version, builderSha256: digest(fs.readFileSync(builder)), headerInputs: Object.fromEntries(fs.readdirSync(headers).filter(f => fs.statSync(path.join(headers, f)).isFile()).map(f => [f, digest(fs.readFileSync(path.join(headers, f)))])) }, null, 2) + '\n');
  run('desktop-stage', node, ['apps/desktop/scripts/stage.mjs']);
  fs.cpSync(bundle, path.join(checkout, 'apps/desktop/dist/agent-runtime'), { recursive: true });
  run('dmg-build', node, [builder, '--projectDir', path.join(checkout, 'apps/desktop/dist/app'), '--config', path.join(checkout, 'apps/desktop/electron-builder.cjs'), '--mac', 'dmg', '--arm64', '--publish', 'never', '-c.directories.output=' + release]);
  const dmg = path.join(release, 'Alune-0.11.0-mac-arm64.dmg');
  fs.mkdirSync(mount);
  run('mount', '/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg]); mounted = true;
  const app = path.join(scratch, 'installed/Alune.app'); fs.mkdirSync(path.dirname(app));
  run('install-dmg', '/usr/bin/ditto', [path.join(mount, 'Alune.app'), app]);
  run('detach', '/usr/bin/hdiutil', ['detach', mount]); mounted = false;
  const installed = path.join(app, 'Contents/Resources/agent-runtime');
  assert(fs.readFileSync(path.join(installed, 'manifest.json')).equals(agentBytes));
  for (const [file, expected] of Object.entries(agentManifest.files)) assert.equal(digest(fs.readFileSync(path.join(installed, file))), expected, file);
  run('native', node, ['scripts/smoke.mjs'], { cwd: path.join(checkout, 'apps/desktop'), env: { ...env, ALUNE_TEST_EXECUTABLE: path.join(app, 'Contents/MacOS/Alune'), ALUNE_CANDIDATE_EVIDENCE: path.join(output, 'raw'), ALUNE_ACCEPTANCE_SHA: sha }, timeout: 1250000 });
  const phases = {};
  for (const phase of ['write', 'restore']) {
    const state = JSON.parse(fs.readFileSync(path.join(output, 'raw/complete-' + phase + '.json')));
    assert.equal(state.result, 'passed'); assert.equal(state.focus, null); assert.equal(state.sha, sha); phases[phase] = state;
  }
  for (const [file, expected] of Object.entries({ ...sourceInputs, ...fixtureInputs })) assert.equal(digest(fs.readFileSync(path.join(checkout, file))), expected, 'Source changed during native regression: ' + file);
  const destination = path.join(root, 'apps/desktop/release/acceptance-20261113/Alune-0.11.0-clean-mac-arm64.dmg');
  fs.copyFileSync(dmg, destination, fs.constants.COPYFILE_EXCL);
  const proof = { sha, target: 'darwin-arm64', policy: policy.id, businessSourceClean: true, sourceInputs, fixtureInputs, phases, results: steps, dmg: { path: destination, sha256: digest(fs.readFileSync(dmg)) }, agentManifestSha256: digest(agentBytes),
    limitations: 'Exact committed business source with seven explicitly hashed acceptance driver overlays. External pinned electron-builder is a development tool; source/dependencies/dist are rebuilt in the fresh clone. Signature-command failure fixture and update smoke adapter remain. No released-old-version credential upgrade/normal rollback or live native updater certification.' };
  const bytes = JSON.stringify(proof, null, 2) + '\n'; fs.writeFileSync(path.join(output, 'desktop.json'), bytes);
  const runs = ['clean-checkout', 'native-regression'].map(gate => ({ sha, target: 'darwin-arm64', gate, entries: [], result: 'passed', scenario: 'Fresh committed desktop business source: ' + gate, assertion: 'Fresh dependency installation and Agent/Web/desktop staging, independent clean Agent, actual DMG install and unfocused complete native write/restore with exact source/fixture hashes and package integrity.', limitations: proof.limitations, proof: { path: 'desktop.json', sha256: digest(bytes) } }));
  fs.writeFileSync(path.join(output, 'receipts.json'), JSON.stringify({ stage: 'after-retirement', sha, baseline: '3c05f640fcc1a04c864e47bfc2880483ad48c984', policy: policy.id, runs }, null, 2) + '\n');
  console.log(JSON.stringify({ cleanBusinessSource: true, phases: ['write', 'restore'], dmg: destination }));
} finally {
  fs.writeFileSync(path.join(output, 'execution.json'), JSON.stringify(steps, null, 2) + '\n');
  if (mounted) execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: 'ignore' });
  fs.rmSync(scratch, { recursive: true, force: true });
}
