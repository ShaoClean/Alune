// Archive native assertion receipts without pretending that a local run is CI.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readPolicy } from './acceptance-policy.mjs';

const [input, ledgerFile, output, policyFile] = process.argv.slice(2);
if (!input || !ledgerFile || !output || !policyFile)
  throw Error('Usage: local-ui-receipts.mjs RAW_UI_DIRECTORY LEDGER OUTPUT_DIRECTORY POLICY');
const policy = readPolicy(policyFile);
if (!policy.localProofs) throw Error('Selected policy does not allow local evidence');
const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
const entries = new Map(ledger.entries.map((entry) => [entry.id, entry]));
const root = path.resolve(output);
if (path.resolve(input) === root) throw Error('Use separate raw input and archive directories');
fs.mkdirSync(path.join(root, 'raw'), { recursive: true });
let sha;
const runs = [];
for (const name of ['workbench.json', 'scenarios-write.jsonl', 'scenarios-restore.jsonl']) {
  const bytes = fs.readFileSync(path.join(input, name));
  const records = name.endsWith('.jsonl')
    ? bytes.toString().trim().split('\n').filter(Boolean).map(JSON.parse)
    : JSON.parse(bytes);
  fs.writeFileSync(path.join(root, 'raw', name), bytes);
  const proof = { path: 'raw/' + name, sha256: createHash('sha256').update(bytes).digest('hex') };
  for (const record of records) {
    const target = record.platform + '-' + record.arch;
    if (
      !/^[0-9a-f]{40}$/.test(record.sha) ||
      (sha && sha !== record.sha) ||
      !policy.requiredTargets.includes(target) ||
      !record.scenario?.trim() ||
      !Array.isArray(record.ui) ||
      !Array.isArray(record.executed)
    )
      throw Error('Invalid or mixed-source native assertion receipt in ' + name);
    sha = record.sha;
    const selected = record.executed.filter((id) => {
      const entry = entries.get(id);
      if (!entry) throw Error('Unknown P0 trace ID: ' + id);
      return record.ui.includes(entry.uiBehavior);
    });
    runs.push({
      sha,
      target,
      scenario: record.scenario,
      assertion: record.scenario,
      proof,
      result: 'passed',
      entries: selected,
    });
  }
}
if (!runs.length) throw Error('No asserted scenarios found');
for (const phase of ['write', 'restore']) {
  const file = 'complete-' + phase + '.json';
  const bytes = fs.readFileSync(path.join(input, file));
  const complete = JSON.parse(bytes);
  if (complete.result !== 'passed' || complete.sha !== sha || complete.phase !== phase || complete.focus !== null)
    throw Error('Incomplete native write/restore acceptance: ' + phase);
  fs.writeFileSync(path.join(root, 'raw', file), bytes);
}
const evidence = { stage: 'before-retirement', policy: policy.id, sha, baseline: ledger.sha, runs };
fs.writeFileSync(path.join(root, 'receipts.json'), JSON.stringify(evidence, null, 2) + '\n');
const covered = new Set(runs.flatMap((run) => run.entries));
const groups = new Map();
for (const entry of ledger.entries.filter((entry) => entry.uiBehavior)) {
  const group = groups.get(entry.file) ?? {
    file: entry.file,
    associated: 0,
    total: 0,
    missing: [],
  };
  group.total++;
  if (covered.has(entry.id)) group.associated++;
  else group.missing.push(entry.id);
  groups.set(entry.file, group);
}
const summary = {
  sha,
  policy: policy.id,
  scenarioReceipts: runs.length,
  associated: covered.size,
  groups: [...groups.values()],
  notProjectCompletionRate: true,
};
fs.writeFileSync(path.join(root, 'ui-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ sha, scenarioReceipts: runs.length, associated: covered.size }));
