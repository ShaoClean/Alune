// Explicit, reviewed non-UI assertion bindings. No import/name/coverage inference.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';
import { readPolicy } from './acceptance-policy.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const baselineSha = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const baselineIds = 'd449b4d464ce6347c18b7f9b8a4ffd1de22dd22dabcd57479dfbc8fbe81d6e7a';

export function validateLedger(ledger) {
  if (ledger.sha !== baselineSha || !Array.isArray(ledger.entries) ||
      new Set(ledger.entries.map((row) => row.id)).size !== ledger.entries.length ||
      digest(ledger.entries.map((row) => row.id).sort().join('\n')) !== baselineIds)
    throw Error('Expected the complete reviewed Issue-249 P0 ID set');
}

export function validateBindings(ledger, plan) {
  const entries = new Map(ledger.entries.map((row) => [row.id, row]));
  if (plan.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(plan.sha ?? '') ||
      !Array.isArray(plan.bindings) || !plan.bindings.length)
    throw Error('Invalid assertion binding plan');
  if (plan.nodeImports && (JSON.stringify(plan.nodeImports) !==
      JSON.stringify(['apps/web/tests/resolve-ts.mjs']))) throw Error('Unsupported test loader');
  const testFiles = new Set(plan.bindings.flatMap((binding) => (binding.tests ?? []).map((test) => test.file)));
  for (const [file, hash] of Object.entries(plan.reviewedTooling ?? {}))
    if (!testFiles.has(file) || !/^[a-f0-9]{64}$/.test(hash))
      throw Error('Reviewed tooling must identify an exact test file and SHA-256');
  const seen = new Set();
  for (const binding of plan.bindings) {
    if (!binding.assertion?.trim() || !binding.limitations?.trim() ||
        !Array.isArray(binding.entries) || !binding.entries.length ||
        new Set(binding.entries).size !== binding.entries.length ||
        !Array.isArray(binding.tests) || !binding.tests.length ||
        !Array.isArray(binding.implementation) || !binding.implementation.length)
      throw Error('Incomplete assertion binding');
    for (const id of binding.entries) {
      if (!entries.has(id) || entries.get(id).uiBehavior)
        throw Error('Unknown or UI P0 binding: ' + id);
      if (seen.has(id)) throw Error('Duplicate P0 binding: ' + id);
      seen.add(id);
    }
    for (const test of binding.tests) {
      if (!test.name?.trim() || !/\.test\.(cjs|mjs)$/.test(test.file ?? '') ||
          !Number.isInteger(test.line) || test.line < 1)
        throw Error('Invalid exact test reference');
    }
  }
}

export function assertedRuns(plan, events, root, target, proof) {
  const summary = events.findLast((event) => event.type === 'test:summary' && !event.data.file);
  if (!summary?.data.success || !summary.data.counts?.tests ||
      summary.data.counts.failed || summary.data.counts.cancelled ||
      events.some((event) => event.type === 'test:fail'))
    throw Error('Test batch did not complete successfully');
  return plan.bindings.map((binding) => {
    for (const test of binding.tests) {
      const matches = events.filter((event) => event.type === 'test:pass' &&
        event.data.details?.type === 'test' && event.data.name === test.name &&
        event.data.file === path.resolve(root, test.file) && event.data.line === test.line &&
        !event.data.skip && !event.data.todo);
      if (matches.length !== 1) throw Error('Missing, skipped or ambiguous assertion: ' + test.name);
    }
    return { sha: plan.sha, target, scenario: binding.tests.map((test) => test.name).join('; '),
      assertion: binding.assertion, limitations: binding.limitations,
      tests: binding.tests, implementation: binding.implementation,
      result: 'passed', entries: binding.entries, proof };
  });
}

export function missingProgress(ledger, previous, receipts) {
  const known = new Set(ledger.entries.map((row) => row.id));
  if (previous.baseline !== ledger.sha || !/^[a-f0-9]{40}$/.test(previous.sha ?? '') ||
      !Array.isArray(previous.runs)) throw Error('Invalid historical receipts');
  const before = new Set();
  for (const receipt of previous.runs) {
    if (receipt.sha !== previous.sha || !Array.isArray(receipt.entries))
      throw Error('Mixed historical source');
    for (const id of receipt.entries) {
      if (!known.has(id)) throw Error('Unknown historical P0 ID: ' + id);
      if (receipt.result === 'passed') before.add(id);
    }
  }
  const current = new Set(), nonPassing = new Set();
  if (receipts.baseline !== ledger.sha || !/^[a-f0-9]{40}$/.test(receipts.sha ?? '') || !Array.isArray(receipts.runs))
    throw Error('Invalid current receipts');
  for (const receipt of receipts.runs) {
    if (receipt.sha !== receipts.sha || !Array.isArray(receipt.entries))
      throw Error('Mixed current source');
    for (const id of receipt.entries) {
      if (!known.has(id)) throw Error('Unknown current P0 ID: ' + id);
      if (receipt.result === 'passed') current.add(id);
      else nonPassing.add(id);
    }
  }
  const missing = ledger.entries.filter((row) => !before.has(row.id));
  for (const id of nonPassing) current.delete(id);
  const count = (key) => Object.fromEntries([...new Set(missing.map((row) => row[key]))].sort()
    .map((value) => [value, missing.filter((row) => row[key] === value).length]));
  return { baseline: ledger.sha, previousSha: previous.sha, currentSha: receipts.sha,
    releaseEligible: false,
    limitations: [
      'Historical and current receipts retain their actual SHAs; they are NOT merged for release.',
      'A scoped assertion association is not complete feature, branch, installation or platform acceptance.',
      'All original IDs are preserved; remaining rows still require explicit assertions and replay.',
    ],
    summary: { total: ledger.entries.length, previouslyAssociated: before.size,
      previousMissing: missing.length, previousMissingByKind: count('kind'),
      previousMissingByAssignment: count('assignment'),
      newlyAssertedAmongPreviousMissing: missing.filter((row) => current.has(row.id)).length,
      remainingFromPreviousMissing: missing.filter((row) => !current.has(row.id)).length,
      nonPassingCurrentIds: nonPassing.size },
    rows: missing.map((row) => ({ ...row,
      status: nonPassing.has(row.id) ? 'nonpassing-current-assertion'
        : current.has(row.id) ? 'current-scoped-assertion' : 'needs-explicit-assertion',
      assertions: receipts.runs.filter((receipt) => receipt.entries.includes(row.id))
        .map(({ entries, ...receipt }) => receipt) })),
  };
}

export function verifyInput(file, bytes, committed, plan) {
  const implementation = new Set(plan.bindings.flatMap((binding) => binding.implementation));
  const reviewed = plan.reviewedTooling?.[file];
  if (reviewed && !implementation.has(file)) {
    if (digest(bytes) !== reviewed) throw Error('Reviewed test tooling changed: ' + file);
  } else if (!committed || !bytes.equals(committed)) {
    throw Error('Assertion input changed since review: ' + file);
  }
}

export async function runCLI(args) {
  const [ledgerFile, previousFile, planFile, output, policyFile] = args;
  if (!policyFile) throw Error('Usage: p0-test-receipts.mjs LEDGER PREVIOUS_RECEIPTS PLAN NEW_OUTPUT_DIRECTORY POLICY');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const ledger = readJSON(ledgerFile), previous = readJSON(previousFile), plan = readJSON(planFile);
  validateLedger(ledger);
  validateBindings(ledger, plan);
  const policy = readPolicy(policyFile), target = process.platform + '-' + process.arch;
  if (!policy.localProofs || !policy.requiredTargets.includes(target)) throw Error('Unsupported local acceptance target');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git('rev-parse', 'HEAD') !== plan.sha) throw Error('Binding plan needs review at the actual HEAD');
  const inputs = new Map();
  for (const file of [...new Set(plan.bindings.flatMap((binding) =>
    [...binding.implementation, ...binding.tests.map((test) => test.file)])), ...(plan.nodeImports ?? [])]) {
    const full = fs.realpathSync(path.resolve(root, file));
    if (full !== path.resolve(root, file) || !full.startsWith(root) || file.startsWith('-') || file.includes(':'))
      throw Error('Invalid assertion input path: ' + file);
    const bytes = fs.readFileSync(full);
    const reviewed = plan.reviewedTooling?.[file] &&
      !plan.bindings.some((binding) => binding.implementation.includes(file));
    const committed = reviewed ? undefined : execFileSync('git', ['show', plan.sha + ':' + file], { cwd: root });
    verifyInput(file, bytes, committed, plan);
    inputs.set(file, digest(bytes));
  }
  // No stale successful receipt may survive an interrupted or failed replay.
  const directory = path.resolve(output);
  fs.mkdirSync(directory, { recursive: false });
  const provenance = { sha: plan.sha, target, node: process.version, policy: policy.id,
    status: git('status', '--porcelain=v1'), inputs: Object.fromEntries(inputs),
    planSha256: digest(fs.readFileSync(planFile)), reviewedTooling: plan.reviewedTooling ?? {},
    runnerSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))) };
  fs.writeFileSync(path.join(directory, 'source-state.json'), JSON.stringify(provenance, null, 2) + '\n');
  const events = [];
  const stream = run({ files: [...new Set(plan.bindings.flatMap((binding) =>
    binding.tests.map((test) => path.resolve(root, test.file))))], timeout: 120000,
    execArgv: (plan.nodeImports ?? []).flatMap((file) => ['--import', path.resolve(root, file)]) });
  for await (const event of stream) events.push(event);
  const bytes = JSON.stringify(events, (key, value) => value instanceof Error
    ? { name: value.name, message: value.message, stack: value.stack } : value, 2) + '\n';
  fs.writeFileSync(path.join(directory, 'test-events.json'), bytes);
  for (const [file, hash] of inputs)
    if (digest(fs.readFileSync(path.join(root, file))) !== hash) throw Error('Assertion input changed during replay');
  if (git('rev-parse', 'HEAD') !== plan.sha) throw Error('Source HEAD changed during replay');
  const runs = assertedRuns(plan, events, root, target, { path: 'test-events.json', sha256: digest(bytes) });
  const receipts = { stage: 'after-retirement', policy: policy.id, sha: plan.sha, baseline: ledger.sha, runs };
  const progress = missingProgress(ledger, previous, receipts);
  fs.writeFileSync(path.join(directory, 'receipts.json'), JSON.stringify(receipts, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'missing-progress.json'), JSON.stringify(progress, null, 2) + '\n');
  console.log(JSON.stringify(progress.summary));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runCLI(process.argv.slice(2));
