import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { run } from 'node:test';
import { baseline, cases, limitations } from './p0-client-cases.mjs';
import { readPolicy, validProof } from './acceptance-policy.mjs';
export const root = fileURLToPath(new URL('../../', import.meta.url));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const contractFile = 'scripts/agent/p0-client-contract.test.mjs';
export const regressionFile = 'scripts/agent/p0-client-runner.test.mjs';
export const supplemental = [
  'client API error helpers do not expose arbitrary transport or secret errors',
  'client live read cancellation reaches the request boundary',
  'client collaboration unknown write outcome queries task and forbids blind resubmit',
  'client Git unknown outcome reports succeeded task receipt without executing twice',
];
export function validateHead(actual, expected = baseline.head) {
  if (!/^[a-f0-9]{40}$/.test(actual ?? '') || actual !== expected) throw Error('Reviewed HEAD mismatch');
}
export function validateInputs(ledgerBytes, progressBytes, plan = cases) {
  if (hash(ledgerBytes) !== baseline.ledgerSha256 || hash(progressBytes) !== baseline.progressSha256)
    throw Error('Frozen complete ledger/progress hash mismatch');
  const ledger = JSON.parse(ledgerBytes), progress = JSON.parse(progressBytes);
  const ids = new Set(ledger.entries.map(r => r.id));
  if (ids.size !== 2758 || ledger.entries.length !== 2758 ||
      hash([...ids].sort().join('\n')) !== 'd449b4d464ce6347c18b7f9b8a4ffd1de22dd22dabcd57479dfbc8fbe81d6e7a')
    throw Error('Incomplete frozen P0 ID set');
  const scope = ledger.entries.filter(r => r.kind === 'client-api' && /^apps\/web\/src\/api\/(index|ai|logging|proxy)\.ts$/.test(r.file));
  if (scope.length !== 125 || !Array.isArray(plan) || plan.length !== 124) throw Error('Expected all 124 live client bindings');
  const scopedIds = new Set(scope.map(r => r.id)), seen = new Set(), names = new Set();
  for (const c of plan) {
    if (!scopedIds.has(c.entryId) || !progress.rows.some(r => r.id === c.entryId && r.status === 'needs-explicit-assertion') ||
        c.entryId.endsWith(':gitTimeout.timeout') || seen.has(c.entryId) || names.has(c.testName) ||
        !c.testName?.trim() || typeof c.invoke !== 'function' || !c.requests?.length ||
        c.requests.some(r => !r.method || !['local-agent', 'remote-agent'].includes(r.host))) throw Error('Invalid, retired or duplicate client binding');
    seen.add(c.entryId); names.add(c.testName);
  }
  return { ledger, progress, scope };
}
// Reject an entire batch on failure: never salvage green rows from a red replay.
export function certify(events, expected) {
  if (!expected.length || new Set(expected.map(t => t.file + ':' + t.name)).size !== expected.length)
    throw Error('Duplicate or empty expected test set');
  const summaries = events.filter(e => e.type === 'test:summary' && !e.data.file);
  const summary = summaries[0]?.data;
  if (summaries.length !== 1 || summary?.success !== true || summary.counts?.tests !== expected.length ||
      summary.counts.passed !== expected.length || summary.counts.failed !== 0 ||
      summary.counts.cancelled !== 0 || summary.counts.skipped !== 0 || summary.counts.todo !== 0 ||
      events.some(e => e.type === 'test:fail' || (e.type === 'test:pass' && (e.data.skip || e.data.todo))))
    throw Error('Test batch failed, skipped, incomplete or ambiguous');
  const passes = events.filter(e => e.type === 'test:pass' && e.data.details?.type === 'test');
  if (passes.length !== expected.length) throw Error('Unexpected test pass count');
  for (const t of expected) {
    const matches = passes.filter(e => e.data.name === t.name && e.data.file === path.resolve(root, t.file) &&
      Number.isInteger(e.data.line) && e.data.line > 0);
    if (matches.length !== 1) throw Error('Missing or duplicate exact assertion: ' + t.name);
  }
  return summary.counts;
}
export function verifyHashes(inputs) {
  for (const [file, digest] of Object.entries(inputs))
    if (hash(fs.readFileSync(file)) !== digest) throw Error('Source/tool changed during replay: ' + file);
}
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const json = value => JSON.stringify(value, (k,v) => v instanceof Error ? { name: v.name, message: v.message, stack: v.stack, cause: v.cause } : v, 2) + '\n';
export function outputDirectory(out, scratch = process.env.PI_SCRATCH_DIR) {
  if (!scratch) throw Error('PI_SCRATCH_DIR is required');
  const parent = fs.realpathSync(scratch), directory = path.resolve(out ?? '');
  if (path.dirname(directory) !== parent || !path.basename(directory).startsWith('p0-client-evidence-') || fs.existsSync(directory))
    throw Error('Output must be a NEW p0-client-evidence-* directory directly inside PI_SCRATCH_DIR');
  return directory;
}
export async function main(args) {
  const [out, policyFile = 'scripts/agent/acceptance-mac-arm64.json'] = args;
  if (!out || args.length > 2) throw Error('Usage: node scripts/agent/p0-client-runner.mjs NEW_OUTPUT_DIRECTORY [POLICY]');
  const directory = outputDirectory(out);
  const relative = directory;
  validateHead(git('rev-parse', 'HEAD'));
  const ledgerBytes = fs.readFileSync(path.join(root, baseline.ledger)), progressBytes = fs.readFileSync(path.join(root, baseline.progress));
  const { ledger, progress, scope } = validateInputs(ledgerBytes, progressBytes);
  const target = process.platform + '-' + process.arch;
  const policyPath = path.resolve(root, policyFile), policy = readPolicy(policyPath);
  if (!policy.localProofs || !policy.requiredTargets.includes(target)) throw Error('Local proof policy/target mismatch');
  // Snapshot ALL first-party sources that can be imported, plus the tools. Dirty
  // business sources cannot be certified as HEAD; new assertion tools may be untracked.
  const tracked = git('ls-files', '-z').split('\0');
  const sourceFiles = tracked.filter(f => /^(apps\/web\/src\/|packages\/(agent-client|protocol|domain|ui)\/src\/)/.test(f) && /\.(ts|tsx)$/.test(f));
  const tools = fs.readdirSync(path.join(root, 'scripts/agent')).filter(f => /^p0-client-.*\.(mjs|md|json)$/.test(f)).map(f => 'scripts/agent/' + f);
  const files = [...sourceFiles, ...tools, baseline.ledger, baseline.progress,
    'apps/web/tests/resolve-ts.mjs', 'packages/ui/tests/resolve-ts.mjs',
    'scripts/agent/acceptance-policy.mjs', 'scripts/agent/check-release-evidence.mjs', policyFile];
  const inputs = {};
  for (const f of new Set(files)) {
    const full = fs.realpathSync(path.resolve(root, f)), bytes = fs.readFileSync(full);
    inputs[full] = hash(bytes);
    if (sourceFiles.includes(f)) {
      const committed = execFileSync('git', ['show', baseline.head + ':' + f], { cwd: root });
      if (!bytes.equals(committed)) throw Error('Business source differs from reviewed HEAD: ' + f);
    }
  }
  const require = createRequire(import.meta.url);
  inputs[process.execPath] = hash(fs.readFileSync(process.execPath));
  const compiler = require.resolve('typescript');
  inputs[compiler] = hash(fs.readFileSync(compiler));
  const compilerDir = path.dirname(compiler);
  for (const f of fs.readdirSync(compilerDir).filter(f => /\.js$/.test(f))) {
    const full = path.join(compilerDir, f); inputs[full] = hash(fs.readFileSync(full));
  }
  fs.mkdirSync(directory); // exclusive creation prevents stale green receipts
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), json(value), { flag: 'wx' });
  const traceFile = path.join(directory, 'loaded-inputs.jsonl');
  fs.writeFileSync(traceFile, '', { flag: 'wx' });
  const sourceState = { head: baseline.head, baseline: ledger.sha, target, node: process.version,
    status: git('status', '--porcelain=v1'), releaseEligible: false, limitations,
    compiler, inputs, policy: policy.id, createdAt: new Date().toISOString() };
  write('source-state.json', sourceState);
  const events = [];
  const oldTrace = process.env.P0_CLIENT_TRACE;
  try {
    process.env.P0_CLIENT_TRACE = traceFile;
    const stream = run({ files: [contractFile, regressionFile].map(f => path.join(root, f)),
      execArgv: ['--import', path.join(root, 'scripts/agent/p0-client-loader.mjs')], timeout: 120000 });
    for await (const event of stream) events.push(event);
  } finally {
    if (oldTrace === undefined) delete process.env.P0_CLIENT_TRACE; else process.env.P0_CLIENT_TRACE = oldTrace;
    write('test-events.json', events);
  }
  verifyHashes(inputs);
  const loaded = {};
  for (const line of fs.readFileSync(traceFile, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    if (loaded[row.path] && loaded[row.path] !== row.sha256) throw Error('Mixed loaded source versions');
    if (inputs[row.path] && inputs[row.path] !== row.sha256) throw Error('Loaded source differs from snapshot');
    loaded[row.path] = row.sha256;
  }
  verifyHashes(loaded);
  validateHead(git('rev-parse', 'HEAD'));
  const { regressionNames } = await import('./p0-client-regressions.mjs');
  const expected = [...cases.map(c => ({ file: contractFile, name: c.testName })),
    ...supplemental.map(name => ({ file: contractFile, name })),
    ...regressionNames.map(name => ({ file: regressionFile, name }))];
  const counts = certify(events, expected);
  const proof = { sourceState, loadedInputs: loaded, counts, expectedTests: expected,
    events: { path: 'test-events.json', sha256: hash(fs.readFileSync(path.join(directory, 'test-events.json'))) } };
  write('proof.json', proof);
  const proofRef = { path: 'proof.json', sha256: hash(fs.readFileSync(path.join(directory, 'proof.json'))) };
  if (!validProof(proofRef, path.join(directory, 'receipts.json'), policy)) throw Error('Invalid local proof');
  const runs = cases.map(c => ({ sha: baseline.head, target, scenario: c.testName,
    assertion: 'Explicit public invocation, exact ordered host/RPC method/params/options/resource, decoded return projection, uninstalled rejection, and error identity/projection (analytics returns per-ID errors). Writes additionally assert prepare revision, execution UUID correlation, prepare failure and unknown-outcome non-retry/task behavior.',
    limitations, result: 'passed', entries: [c.entryId], proof: proofRef }));
  const passed = new Set(cases.map(c => c.entryId));
  write('receipts.json', { stage: 'after-retirement', policy: policy.id, sha: baseline.head, baseline: ledger.sha, releaseEligible: false, runs });
  const remaining = scope.filter(r => !passed.has(r.id));
  write('client-progress.json', { sha: baseline.head, baseline: ledger.sha, releaseEligible: false, limitations,
    summary: { frozenTotal: ledger.entries.length, originalMissing: 2112, priorRemaining: progress.summary.remainingFromPreviousMissing,
      clientScope: scope.length, newlyAsserted: passed.size, clientRemaining: remaining.length,
      remainingFromPreviousMissing: progress.summary.remainingFromPreviousMissing - passed.size },
    rows: scope.map(r => ({ ...r, status: passed.has(r.id) ? 'current-scoped-assertion' : 'needs-explicit-assertion',
      ...(r.name === 'gitTimeout.timeout' ? { reason: 'Retired API; intentionally not covered' } : {}) })),
    uncovered: remaining });
  console.log(json({ directory: relative, tests: counts, newlyAsserted: passed.size, clientRemaining: remaining.length, releaseEligible: false }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
