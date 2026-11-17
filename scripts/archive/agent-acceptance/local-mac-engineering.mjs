// Real local commands, isolated application data, and immutable local proofs.
// Installation, updater and clean-checkout gates are deliberately separate.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readPolicy } from './acceptance-policy.mjs';

const root = fileURLToPath(new URL("../../../", import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file));
const [bundleArg, outputArg, policyArg] = process.argv.slice(2);
if (!policyArg) throw Error('Usage: local-mac-engineering.mjs BUNDLE NEW_OUTPUT POLICY');
assert.equal(process.platform + '-' + process.arch, 'darwin-arm64');
const policy = readPolicy(policyArg);
assert.equal(policy.id, 'mac-arm64-local-2026-11-08');
const bundle = fs.realpathSync(bundleArg), output = path.resolve(outputArg);
assert(!bundle.startsWith(root));
const manifestBytes = fs.readFileSync(path.join(bundle, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sha = git('rev-parse', 'HEAD');
assert.equal(manifest.sourceSha, sha);
assert.equal(manifest.target, 'darwin-arm64');
// Refuse a stale package, including changed files not mentioned by a build log.
for (const [file, expected] of Object.entries(manifest.files)) assert.equal(hash(fs.readFileSync(path.join(bundle, file))), expected, file);
for (const name of ['agent', 'agent-client', 'domain', 'protocol']) {
  const prefix = `node_modules/@alune/${name}/`;
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (file.startsWith(prefix + 'dist/') || file === prefix + 'package.json' || file.startsWith(prefix + 'bin/'))
      assert.equal(hash(fs.readFileSync(path.join(root, 'packages', name, file.slice(prefix.length)))), expected, 'Checkout/package mismatch: ' + file);
  }
}
fs.mkdirSync(output, { recursive: false });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-mac-engineering-'));
const files = git('ls-files', 'packages/agent/src', 'packages/agent-client/src', 'packages/domain/src', 'packages/protocol/src', 'package-lock.json').split('\n').filter(Boolean);
// Business sources must match HEAD. Uncommitted test drivers are hashed below.
const inputs = Object.fromEntries(files.map(file => {
  const bytes = fs.readFileSync(path.join(root, file));
  assert(bytes.equals(execFileSync('git', ['show', sha + ':' + file], { cwd: root })), file + ' differs from HEAD');
  return [file, hash(bytes)];
}));
const enumerate = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? enumerate(dir + '/' + e.name) : [dir + '/' + e.name]);
const tooling = Object.fromEntries([...enumerate('packages/agent/tests'), ...enumerate('scripts/agent'), ...enumerate('scripts/archive/agent-acceptance')].filter(f => /\.(cjs|mjs|json|pem)$/.test(f)).map(f => [f, hash(fs.readFileSync(path.join(root, f)))]));
const commands = [
  { name: 'packaged-agent', args: ['scripts/agent/test-packaged.mjs', bundle], gates: ['packaged-agent'], assertion: 'Manifest hashes, isolated dependencies, bundled Node/SQLite/PTY and disposable Keychain; real repository stage/commit, independent terminal ACK, restart persistence and encrypted recovery.' },
  { name: 'protocol-compat', args: ['scripts/agent/test-negotiated-package.mjs', bundle, path.join(output, 'protocol.json')], gates: ['protocol-compat'], assertion: 'Packaged stdio negotiation at every minor 1.0–1.7; exact capability sets, future-minor downgrade, incompatible-major rejection and later methods refused before validation.' },
  { name: 'ssh', args: ['scripts/agent/test-ssh-isolated.mjs', bundle], gates: ['local-remote-parity', 'reconnect-and-tasks'], assertion: 'Two packaged Agents and packaged SDK over real encrypted loopback SSH: pin/install, matching repository reads, PTY ACK, proxy fetch, submodule operations, grants/revocation, interrupted-write unknown receipt and explicit reconnect without replay.' },
  { name: 'migration', args: ['--test', '--test-concurrency=2', 'packages/agent/tests/legacy-import.test.cjs', 'packages/agent/tests/legacy-cli.test.cjs', 'packages/agent/tests/recovery.test.cjs', 'packages/agent/tests/recovery-cli.test.cjs', 'packages/agent/tests/recovery-platform.test.cjs', 'packages/agent/tests/task-journal.test.cjs'], gates: ['migration-and-recovery'], assertion: 'Disposable legacy import and encrypted backup/recovery, fresh native protection after original loss, stale/foreign/tampered/cancelled refusals and durable interrupted/duplicate task receipts. Native Mac recovery uses a temporary Keychain.' },
];
const runs = [], results = [];
try {
  for (const command of commands) {
    console.log('Running ' + command.name);
    const file = command.name + '.log', fd = fs.openSync(path.join(output, file), 'wx', 0o600);
    const startedAt = new Date().toISOString();
    let result;
    try {
      result = spawnSync(process.execPath, command.args, { cwd: root, env: { ...process.env, PI_SCRATCH_DIR: scratch }, stdio: ['ignore', fd, fd], timeout: 600000 });
    } finally { fs.closeSync(fd); }
    const bytes = fs.readFileSync(path.join(output, file));
    results.push({ name: command.name, args: command.args, startedAt, finishedAt: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message, log: { path: file, sha256: hash(bytes) } });
    assert.equal(result.status, 0, command.name + ' failed; inspect ' + file);
    if (command.name === 'migration') {
      // All selected tests apply on this Mac. A conditional skip is not a pass.
      assert.match(bytes.toString(), /(?:#|ℹ) fail 0/);
      assert.match(bytes.toString(), /(?:#|ℹ) skipped 0/);
    }
    for (const gate of command.gates) runs.push({ sha, target: manifest.target, gate, entries: [], result: 'passed', scenario: 'Local Mac ' + gate, assertion: command.assertion,
      limitations: 'Current local macOS arm64 only. Synthetic disposable repositories/credentials; SSH peer is on this Mac. Package dirty=' + manifest.dirty + '. No clean-checkout, installed upgrade/rollback, live native updater or user-data migration certification.', proof: { path: 'engineering.json', sha256: '' } });
    console.log('Passed ' + command.name);
  }
  for (const [file, expected] of Object.entries({ ...inputs, ...tooling })) assert.equal(hash(fs.readFileSync(path.join(root, file))), expected, 'Input changed during run: ' + file);
  assert.equal(git('rev-parse', 'HEAD'), sha);
  const proof = { sha, target: manifest.target, node: process.version, policy: policy.id, status: git('status', '--porcelain=v1'), manifest: { sha256: hash(manifestBytes), sourceSha: manifest.sourceSha, dirty: manifest.dirty }, inputs, tooling, results };
  const bytes = JSON.stringify(proof, null, 2) + '\n';
  fs.writeFileSync(path.join(output, 'engineering.json'), bytes, { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'package-manifest.json'), manifestBytes, { flag: 'wx' });
  for (const run of runs) run.proof.sha256 = hash(bytes);
  fs.writeFileSync(path.join(output, 'receipts.json'), JSON.stringify({ stage: 'after-retirement', sha, baseline: '3c05f640fcc1a04c864e47bfc2880483ad48c984', policy: policy.id, runs }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ gates: runs.map(r => r.gate), sha, dirty: manifest.dirty }));
} finally {
  fs.writeFileSync(path.join(output, 'execution.json'), JSON.stringify(results, null, 2) + '\n');
  fs.rmSync(scratch, { recursive: true, force: true });
}
