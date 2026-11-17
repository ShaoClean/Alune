// Reproduce the independent job locally without CI environment impersonation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readPolicy } from './acceptance-policy.mjs';
const root = fileURLToPath(new URL("../../../", import.meta.url));
const [runtimeArg, outputArg, policyArg] = process.argv.slice(2);
if (!policyArg) throw Error('Usage: local-clean-mac.mjs VERIFIED_RUNTIME_BUNDLE NEW_OUTPUT POLICY');
assert.equal(process.platform + '-' + process.arch, 'darwin-arm64');
const policy = readPolicy(policyArg); assert.equal(policy.id, 'mac-arm64-local-2026-11-08');
const runtime = fs.realpathSync(runtimeArg), output = path.resolve(outputArg);
const metadata = JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json')));
const bundledNode = path.join(runtime, metadata.node.executable);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(fs.readFileSync(bundledNode)), metadata.files[metadata.node.executable]);
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
fs.mkdirSync(output, { recursive: false });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-clean-mac-'));
const checkout = path.join(scratch, 'source'), bundle = path.join(scratch, 'bundle');
// The runtime bundle intentionally omits development headers. Build with the
// same verified interpreter plus node-gyp's matching SDK, never stale .node files.
const node = path.join(scratch, 'sdk/bin/node');
const headers = process.env.ALUNE_NODE_HEADERS || path.join(os.homedir(), 'Library/Caches/node-gyp', metadata.node.version, 'include/node');
assert(fs.existsSync(path.join(headers, 'node_api.h')), 'Matching Node SDK headers required');
fs.mkdirSync(path.dirname(node), { recursive: true });
fs.copyFileSync(bundledNode, node); fs.chmodSync(node, 0o755);
fs.cpSync(headers, path.join(scratch, 'sdk/include/node'), { recursive: true });
const headerInputs = Object.fromEntries(fs.readdirSync(headers).filter(f => fs.statSync(path.join(headers, f)).isFile()).map(f => [f, digest(fs.readFileSync(path.join(headers, f)))]));
const npm = path.join(root, 'node_modules/npm/bin/npm-cli.js');
// npm is normally installed alongside the host Node, not a repo dependency.
const npmCLI = fs.existsSync(npm) ? npm : fs.realpathSync(execFileSync('/usr/bin/which', ['npm'], { encoding: 'utf8' }).trim());
const env = { ...process.env, PATH: path.dirname(node) + path.delimiter + process.env.PATH, ELECTRON_SKIP_BINARY_DOWNLOAD: '1', PI_SCRATCH_DIR: scratch };
for (const name of ['NODE_PATH', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT']) delete env[name];
const results = [];
function run(name, executable, args, cwd = checkout, input) {
  console.log('Running ' + name);
  const fd = fs.openSync(path.join(output, name + '.log'), 'wx', 0o600);
  let result;
  try { result = spawnSync(executable, args, { cwd, env, input, stdio: [input ? 'pipe' : 'ignore', fd, fd], timeout: 900000 }); }
  finally { fs.closeSync(fd); }
  const bytes = fs.readFileSync(path.join(output, name + '.log'));
  results.push({ name, executable, args, status: result.status, signal: result.signal, log: { path: name + '.log', sha256: digest(bytes) } });
  assert.equal(result.status, 0, name + ' failed: ' + result.error?.message);
  console.log('Passed ' + name);
}
try {
  run('clone', 'git', ['clone', '--shared', '--no-checkout', root, checkout], scratch);
  run('sparse', 'git', ['sparse-checkout', 'set', '--no-cone', '--stdin'], checkout,
    '/*\n!/*/\n/.githooks/\n/.github/\n/scripts/\n/apps/web/\n/packages/agent/\n/packages/agent-client/\n/packages/domain/\n/packages/protocol/\n/packages/ui/\n/apps/desktop/src/ai-secret-storage.cjs\n/apps/desktop/src/legacy-agent-secrets.cjs\n');
  run('checkout', 'git', ['checkout', '--detach', sha]);
  run('before-install', node, ['scripts/agent/check-clean-checkout.mjs', 'before-install']);
  run('install', node, [npmCLI, 'ci', '--workspace=@alune/agent', '--workspace=@alune/agent-client', '--workspace=@alune/domain', '--workspace=@alune/protocol', '--workspace=@alune/ui', '--workspace=web', '--include-workspace-root=false', '--no-audit', '--no-fund']);
  run('after-install', node, ['scripts/agent/check-clean-checkout.mjs', 'after-install']);
  for (const workspace of ['@alune/protocol', '@alune/agent-client', '@alune/agent', 'web']) {
    if (workspace === 'web') run('web-build', node, [npmCLI, 'run', 'build', '-w', workspace]);
    run(workspace.replace('@alune/', '') + '-tests', node, [npmCLI, 'test', '-w', workspace]);
  }
  run('boundaries', node, ['scripts/agent/check-boundaries.mjs']);
  assert.equal(execFileSync('git', ['status', '--porcelain=v1'], { cwd: checkout, encoding: 'utf8' }).trim(), '', 'Clean build modified source');
  run('package', node, ['scripts/agent/package.mjs', '--output', bundle]);
  run('packaged-tests', node, ['scripts/agent/test-packaged.mjs', bundle, '--require-clean']);
  run('protocol-matrix', node, ['scripts/agent/test-negotiated-package.mjs', bundle, path.join(output, 'protocol.json')]);
  run('ssh-isolated', node, ['scripts/agent/test-ssh-isolated.mjs', bundle]);
  const manifestBytes = fs.readFileSync(path.join(bundle, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes); assert.equal(manifest.dirty, false); assert.equal(manifest.sourceSha, sha);
  fs.writeFileSync(path.join(output, 'package-manifest.json'), manifestBytes);
  const bytes = JSON.stringify({ sha, target: 'darwin-arm64', node: execFileSync(node, ['--version'], { encoding: 'utf8' }).trim(), headerInputs, policy: policy.id, results, manifestSha256: digest(manifestBytes), status: '' }, null, 2) + '\n';
  fs.writeFileSync(path.join(output, 'clean.json'), bytes);
  const proof = { path: 'clean.json', sha256: digest(bytes) };
  const runs = ['clean-checkout', 'packaged-agent', 'protocol-compat', 'local-remote-parity', 'reconnect-and-tasks'].map(gate => ({ sha, target: 'darwin-arm64', gate, entries: [], result: 'passed', scenario: 'Independent clean Mac ' + gate,
    assertion: 'Exact HEAD sparse checkout with no prebuilt output or development node_modules; fresh workspace npm ci, protocol/SDK/Agent/Web tests and Web build, dependency-boundary check; clean packaged runtime then native/PTY, complete protocol matrix and isolated encrypted SSH/reconnect acceptance.',
    limitations: 'Original clean HEAD; excludes uncommitted compatibility fields and new P0 tooling. Conditional platform skips remain skips in test logs. No installed desktop, live native updater, performance or complete P0 claim.', proof }));
  fs.writeFileSync(path.join(output, 'receipts.json'), JSON.stringify({ stage: 'after-retirement', sha, baseline: '3c05f640fcc1a04c864e47bfc2880483ad48c984', policy: policy.id, runs }, null, 2) + '\n');
  // Preserve the actual clean executable package for later install drills.
  const retainedBundle = path.join(os.tmpdir(), 'alune-clean-mac-bundle-' + process.pid);
  fs.renameSync(bundle, retainedBundle);
  fs.writeFileSync(path.join(output, 'artifact.json'), JSON.stringify({ path: retainedBundle, manifestSha256: digest(manifestBytes) }, null, 2) + '\n');
  console.log(JSON.stringify({ sha, clean: true, gates: runs.map(r => r.gate), bundle: retainedBundle }));
} finally {
  fs.writeFileSync(path.join(output, 'execution.json'), JSON.stringify(results, null, 2) + '\n');
  fs.rmSync(scratch, { recursive: true, force: true });
}
