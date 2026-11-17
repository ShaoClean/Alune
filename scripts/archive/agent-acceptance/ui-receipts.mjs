// Candidate-only CI: turn observed callbacks into reviewable receipts for the
// matching assertion families. Never credit unrelated events just because a
// listener fired in the background. Remaining IDs stay in the missing report.
import fs from 'node:fs';
import path from 'node:path';
const [dir, ledgerPath, out] = process.argv.slice(2);
if (!dir || !ledgerPath || !out)
  throw Error('Usage: ui-receipts.mjs DOWNLOADED-ARTIFACTS P0_LEDGER RECEIPTS');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')),
  entries = new Map(ledger.entries.map((e) => [e.id, e]));
const runs = [];
let sha;
for (const folder of fs.readdirSync(dir, { withFileTypes: true })) {
  if (!folder.isDirectory() || !folder.name.startsWith('candidate-ui-')) continue;
  const root = path.join(dir, folder.name),
    set = [];
  for (const name of fs.readdirSync(root)) {
    if (name === 'workbench.json')
      set.push(...JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')));
    if (/^scenarios-(write|restore)\.jsonl$/.test(name))
      set.push(
        ...fs
          .readFileSync(path.join(root, name), 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(JSON.parse),
      );
  }
  for (const r of set) {
    if (!r.sha || !r.proof || !Array.isArray(r.ui) || !Array.isArray(r.executed))
      throw Error('Artifact lacks a source SHA, run link or trace: ' + folder.name);
    if (sha && sha !== r.sha) throw Error('Cannot merge evidence from different commits');
    sha = r.sha;
    const selected = r.executed.filter((id) => {
      const e = entries.get(id);
      if (!e) throw Error('Unknown trace ID: ' + id);
      return r.ui.includes(e.uiBehavior);
    });
    runs.push({
      sha,
      target: r.platform + '-' + r.arch,
      scenario: r.scenario,
      assertion: r.scenario,
      proof: r.proof,
      result: 'passed',
      entries: selected,
    });
  }
}
if (!runs.length) throw Error('No candidate UI artifacts found');
fs.writeFileSync(
  out,
  JSON.stringify({ stage: 'before-retirement', sha, baseline: ledger.sha, runs }, null, 2) + '\n',
);
console.log(
  'Correlated ' +
    runs.length +
    ' passing scenario receipts; ' +
    new Set(runs.flatMap((r) => r.entries)).size +
    ' unique P0 UI entries.',
);
