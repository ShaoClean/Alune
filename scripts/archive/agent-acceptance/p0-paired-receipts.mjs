// Export exact endpoint + direct handler associations, never incidental traces.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateLedger, missingProgress } from './p0-test-receipts.mjs';
import { readPolicy } from './acceptance-policy.mjs';

const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function pairedRuns(ledger, report, spec, sha, target, proof) {
  const rows = report.rows ?? report.results;
  if (report.baseline !== ledger.sha || report.candidate !== sha ||
      (report.target ?? report.platform) !== target || report.outcome === 'failed' ||
      !Number.isInteger(spec.expectedCases) || spec.expectedCases < 1 ||
      !Array.isArray(rows) || rows.length !== spec.expectedCases ||
      !spec.assertion?.trim() || !spec.limitations?.trim())
    throw Error('Incomplete or mixed-source paired report');
  const seen = new Set();
  return rows.map((row) => {
    if (!row.scenario?.trim() || !row.route?.trim() || !['equal', 'not-equal'].includes(row.result) ||
        seen.has(row.scenario)) throw Error('Incomplete or duplicate paired scenario');
    seen.add(row.scenario);
    const routes = ledger.entries.filter((entry) => entry.kind === 'http' && entry.name === row.route);
    if (routes.length !== 1) throw Error('Unknown or ambiguous HTTP endpoint: ' + row.route);
    const endpoint = routes[0];
    const methods = ledger.entries.filter((entry) => entry.kind === 'method' &&
      entry.file === endpoint.file && entry.name === endpoint.handler);
    if (methods.length !== 1) throw Error('Unknown or ambiguous direct controller method: ' + row.route);
    return { sha, target, scenario: row.scenario, assertion: spec.assertion,
      limitations: spec.limitations, result: row.result === 'equal' ? 'passed' : 'failed',
      entries: [endpoint.id, methods[0].id], proof,
      baselineHandler: { file: endpoint.file, line: endpoint.line, name: endpoint.handler },
      // Retained as a search index, NEVER included in entries.
      observedOnly: row.observedFrozenMethods ?? [] };
  });
}

export function runCLI(args) {
  const [ledgerFile, previousFile, manifestFile, output, policyFile] = args;
  if (!policyFile) throw Error('Usage: p0-paired-receipts.mjs LEDGER PREVIOUS_RECEIPTS MANIFEST NEW_OUTPUT_DIRECTORY POLICY');
  const ledger = readJSON(ledgerFile), previous = readJSON(previousFile), manifest = readJSON(manifestFile);
  validateLedger(ledger);
  const policy = readPolicy(policyFile), target = process.platform + '-' + process.arch;
  if (!policy.localProofs || !policy.requiredTargets.includes(target)) throw Error('Unsupported local acceptance target');
  if (!/^[a-f0-9]{40}$/.test(manifest.sha ?? '') || !Array.isArray(manifest.reports) || !manifest.reports.length)
    throw Error('Invalid paired report manifest');
  const base = path.dirname(path.resolve(manifestFile)), directory = path.resolve(output);
  fs.mkdirSync(directory, { recursive: false });
  const runs = [], labels = new Set();
  for (const spec of manifest.reports) {
    if (!/^[a-z0-9-]+$/.test(spec.label ?? '') || labels.has(spec.label) || typeof spec.file !== 'string')
      throw Error('Invalid or duplicate paired report label');
    labels.add(spec.label);
    const bytes = fs.readFileSync(path.resolve(base, spec.file)), name = spec.label + '.json';
    runs.push(...pairedRuns(ledger, JSON.parse(bytes), spec, manifest.sha, target,
      { path: name, sha256: digest(bytes) }));
    fs.writeFileSync(path.join(directory, name), bytes);
  }
  const receipts = { stage: 'after-retirement', sha: manifest.sha, baseline: ledger.sha, policy: policy.id, runs };
  const progress = missingProgress(ledger, previous, receipts);
  const archivedManifest = { ...manifest, reports: manifest.reports.map((spec) => ({ ...spec, file: spec.label + '.json' })) };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(archivedManifest, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'receipts.json'), JSON.stringify(receipts, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'missing-progress.json'), JSON.stringify(progress, null, 2) + '\n');
  console.log(JSON.stringify({ scenarios: runs.length,
    associated: new Set(runs.filter((run) => run.result === 'passed').flatMap((run) => run.entries)).size,
    failed: runs.filter((run) => run.result !== 'passed').map((run) => run.scenario) }));
  if (runs.some((run) => run.result !== 'passed')) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runCLI(process.argv.slice(2));
