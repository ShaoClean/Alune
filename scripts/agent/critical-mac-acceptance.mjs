// Risk-first verification. This report deliberately makes no P0-ID deductions.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
assert.equal(process.platform + '-' + process.arch, 'darwin-arm64');
const [outArg] = process.argv.slice(2);
if (!outArg || process.argv.length !== 3) throw Error('Usage: critical-mac-acceptance.mjs NEW_OUTPUT');
const out = path.resolve(outArg);
fs.mkdirSync(out, { recursive: false, mode: 0o700 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const write = (file, value) => fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const inputs = {};
function seal(dir) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const file = dir + '/' + e.name;
    if (e.isDirectory()) seal(file);
    else if (e.isFile()) inputs[file] = hash(fs.readFileSync(path.join(root, file)));
  }
}
for (const dir of ['packages/agent/src', 'packages/agent/tests', 'packages/agent-client/src', 'packages/protocol/src', 'packages/domain/src', 'apps/desktop/src', 'apps/desktop/test', 'scripts/agent']) seal(dir);
for (const file of ['package.json', 'package-lock.json']) inputs[file] = hash(fs.readFileSync(path.join(root, file)));
write('source-before.json', { sha: git('rev-parse', 'HEAD'), status: git('status', '--porcelain=v1'), inputs, node: process.version });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-critical-risk-'));
const bundle = path.join(scratch, 'package');
const env = { ...process.env, PI_SCRATCH_DIR: scratch, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH };
for (const name of ['CI', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) delete env[name];
const steps = [];
function run(name, args, { tests = false, timeout = 600000, command = process.execPath } = {}) {
  console.log('Running ' + name);
  const log = name + '.log', fd = fs.openSync(path.join(out, log), 'wx', 0o600);
  let result;
  const startedAt = new Date().toISOString();
  try { result = spawnSync(command, args, { cwd: root, env, stdio: ['ignore', fd, fd], timeout }); }
  finally { fs.closeSync(fd); }
  const bytes = fs.readFileSync(path.join(out, log));
  const step = { name, command, args, startedAt, finishedAt: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message, log: { path: log, sha256: hash(bytes) } };
  steps.push(step);
  assert.equal(result.status, 0, name + ': inspect ' + log);
  if (tests) {
    for (const label of ['fail', 'cancelled', 'skipped', 'todo']) assert.match(bytes.toString(), new RegExp('# ' + label + ' 0(?:\\n|$)'));
    step.tests = Number(bytes.toString().match(/# tests (\d+)/)?.[1]);
    assert(step.tests > 0);
  }
  console.log('Passed ' + name);
}
try {
  run('build', ['node_modules/typescript/bin/tsc', '-b', 'packages/domain', 'packages/protocol', 'packages/agent-client', 'packages/agent', '--force']);
  // The distribution runtime intentionally omits headers. The local Node has
  // headers for the N-API v8 addon; execute all acceptance tests with Node 22.
  const nativeNode = execFileSync('which', ['node'], { encoding: 'utf8' }).trim();
  run('native-build', ['packages/agent/scripts/native-secrets.mjs'], { command: nativeNode });
  run('writes-terminals-migration-boundaries', ['--test', '--test-concurrency=2', '--test-reporter=tap',
    ...['repository-writes', 'task-journal', 'terminals', 'p0-terminal-migration', 'legacy-import', 'legacy-cli', 'recovery', 'recovery-cli', 'recovery-platform', 'hosts', 'file-access', 'relayed-file-write', 'p0-account-migration'].map(n => 'packages/agent/tests/' + n + '.test.cjs')], { tests: true });
  run('update-rollback', ['--test', '--test-concurrency=1', '--test-reporter=tap', 'apps/desktop/test/mac-installer.test.cjs', 'apps/desktop/test/updater.test.cjs'], { tests: true });
  run('package', ['scripts/agent/package.mjs', '--output', bundle]);
  fs.copyFileSync(path.join(bundle, 'manifest.json'), path.join(out, 'package-manifest.json'));
  run('packaged-agent', ['scripts/agent/test-packaged.mjs', bundle]);
  run('encrypted-ssh', ['scripts/agent/test-ssh-isolated.mjs', bundle]);
  for (const [file, expected] of Object.entries(inputs)) assert.equal(hash(fs.readFileSync(path.join(root, file))), expected, 'Source changed: ' + file);
  write('result.json', { result: 'passed', scope: 'Current dirty working-source risk regression, isolated repositories and credentials; two Agents over encrypted loopback SSH. Native updater fixture staging/replacement/open is separate from released-app upgrade and live update.', policy: 'mac-arm64-local-2026-11-08', sha: git('rev-parse', 'HEAD'), steps, p0Deductions: 0, releaseEligible: false });
} finally {
  write('execution.json', steps);
  fs.rmSync(scratch, { recursive: true, force: true });
}
