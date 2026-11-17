// P0 IDs and execution receipts live in the Wiki. A mapping or a screenshot
// without a recorded assertion is not an execution receipt. Missing rows are
// emitted for the next acceptance pass, never silently considered covered.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readPolicy, supportedTargets, validProof } from './acceptance-policy.mjs';
const [ledgerFile, evidenceFile, out, policyFile] = process.argv.slice(2);
const policy = readPolicy(policyFile);
if (!ledgerFile || !evidenceFile)
  throw Error('Usage: check-release-evidence.mjs P0_LEDGER RECEIPTS [REPORT] [POLICY]');
const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')),
  evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
if (
  !Array.isArray(ledger.entries) ||
  !ledger.entries.length ||
  !['before-retirement', 'after-retirement'].includes(evidence.stage) ||
  !/^[0-9a-f]{40}$/.test(evidence.sha) ||
  evidence.baseline !== ledger.sha
)
  throw Error('Invalid evidence header or P0 baseline');
if (policyFile && evidence.policy !== policy.id)
  throw Error('Evidence must declare the selected acceptance policy');
const ids = new Map(ledger.entries.map((row) => [row.id, row]));
if (ids.size !== ledger.entries.length) throw Error('Duplicate P0 identity');
// A shortened export of the ledger must not be able to produce a green gate.
const baselineIds = createHash('sha256')
  .update([...ids.keys()].sort().join('\n'))
  .digest('hex');
if (
  ledger.sha !== '3c05f640fcc1a04c864e47bfc2880483ad48c984' ||
  baselineIds !== 'd449b4d464ce6347c18b7f9b8a4ffd1de22dd22dabcd57479dfbc8fbe81d6e7a'
)
  throw Error('Expected the complete reviewed Issue-249 P0 ID set');
const covered = new Set(),
  platforms = new Set(),
  gates = new Set(),
  platformGates = new Set(),
  nonPassing = [];
const supported = supportedTargets;
const requiredTargets = policy.requiredTargets;
const required = [
  'protocol-compat',
  'local-remote-parity',
  'reconnect-and-tasks',
  'migration-and-recovery',
  'performance',
];
const perPlatform = ['native-update', 'clean-checkout', 'packaged-agent'];
for (const receipt of evidence.runs) {
  if (
    receipt.sha !== evidence.sha ||
    !supported.includes(receipt.target) ||
    typeof receipt.scenario !== 'string' ||
    !receipt.scenario.trim() ||
    typeof receipt.assertion !== 'string' ||
    !receipt.assertion.trim() ||
    !Array.isArray(receipt.entries) ||
    !validProof(receipt.proof, evidenceFile, policy)
  )
    throw Error('Incomplete execution receipt: ' + receipt.scenario);
  for (const id of receipt.entries) if (!ids.has(id)) throw Error('Unknown P0 ID: ' + id);
  if (receipt.result !== 'passed') {
    nonPassing.push([receipt.target, receipt.scenario, receipt.result]);
    continue;
  }
  receipt.entries.forEach((id) => covered.add(id));
  if (receipt.gate === 'installed-upgrade-rollback') platforms.add(receipt.target);
  else if (perPlatform.includes(receipt.gate))
    platformGates.add(receipt.target + ':' + receipt.gate);
  else if (receipt.gate) gates.add(receipt.gate);
}
const missing = ledger.entries.filter((row) => !covered.has(row.id));
const report = {
  policy: policy.id,
  requiredTargets,
  deferredTargets: supported.filter((target) => !requiredTargets.includes(target)),
  stage: evidence.stage,
  sha: evidence.sha,
  total: ids.size,
  passed: covered.size,
  missingPlatforms: requiredTargets.filter((p) => !platforms.has(p)),
  missingGates: [
    ...required.filter((g) => !gates.has(g)),
    ...requiredTargets.flatMap((p) =>
      perPlatform.filter((g) => !platformGates.has(p + ':' + g)).map((g) => p + ':' + g),
    ),
  ],
  nonPassing,
  missing: missing.map(({ id, assignment, acceptanceCaseId }) => ({
    id,
    assignment,
    ...(acceptanceCaseId ? { acceptanceCaseId } : {}),
  })),
};
if (out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ...report, missing: missing.length }));
if (
  nonPassing.length ||
  missing.length ||
  report.missingPlatforms.length ||
  report.missingGates.length
)
  process.exitCode = 1;
