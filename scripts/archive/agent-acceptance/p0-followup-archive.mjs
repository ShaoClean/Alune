// Merge only verified, same-SHA receipt inputs. Never upgrades traces or old SHAs.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateLedger, missingProgress } from './p0-test-receipts.mjs';
import { readPolicy, validProof } from './acceptance-policy.mjs';
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function validateReceiptInput(ledger, evidence, input, policy, expectedSha) {
  if (evidence.stage !== 'after-retirement' || evidence.baseline !== ledger.sha ||
      evidence.policy !== policy.id || evidence.sha !== expectedSha ||
      !/^[a-f0-9]{40}$/.test(expectedSha ?? '') || !Array.isArray(evidence.runs) || !evidence.runs.length)
    throw Error('Mixed or incomplete receipt header: ' + input);
  const known = new Set(ledger.entries.map((row) => row.id));
  for (const run of evidence.runs) {
    if (run.sha !== expectedSha || !policy.requiredTargets.includes(run.target) ||
        !run.scenario?.trim() || !run.assertion?.trim() || !run.limitations?.trim() ||
        !['passed', 'failed'].includes(run.result) || !Array.isArray(run.entries) ||
        new Set(run.entries).size !== run.entries.length || run.entries.some((id) => !known.has(id)) ||
        typeof run.proof !== 'object' || !validProof(run.proof, input, policy))
      throw Error('Unverified, mixed or incomplete execution receipt: ' + run.scenario);
  }
}

export function archiveReceipts(ledgerFile, previousFile, output, policyFile, inputs) {
  const ledger = readJSON(ledgerFile), previous = readJSON(previousFile), policy = readPolicy(policyFile);
  validateLedger(ledger);
  if (!policy.localProofs || !inputs.length) throw Error('Expected local proof policy and receipt inputs');
  const parsed = inputs.map((file) => ({ file: path.resolve(file), value: readJSON(file) }));
  if (new Set(parsed.map(({ file }) => file)).size !== parsed.length) throw Error('Duplicate receipt input');
  const sha = parsed[0].value.sha;
  for (const { file, value } of parsed) validateReceiptInput(ledger, value, file, policy, sha);
  // Validation completes before creating output; an old archive is never overwritten.
  fs.mkdirSync(output, { recursive: false });
  fs.mkdirSync(path.join(output, 'proofs'));
  const runs = [], sources = [];
  for (const [index, { file, value }] of parsed.entries()) {
    sources.push({ file, sha256: hash(fs.readFileSync(file)), sha: value.sha, runs: value.runs.length });
    for (const run of value.runs) {
      const source = path.resolve(path.dirname(file), run.proof.path);
      const bytes = fs.readFileSync(source);
      const name = path.join('proofs', String(index), run.proof.path);
      if (hash(bytes) !== run.proof.sha256) throw Error('Proof changed during archive');
      fs.mkdirSync(path.dirname(path.join(output, name)), { recursive: true });
      fs.writeFileSync(path.join(output, name), bytes);
      const document = JSON.parse(bytes);
      const attachments = [document.events, ...(document.results ?? []).map(result => result.log)].filter(item => item?.path);
      for (const nested of attachments) {
        if (!validProof(nested, source, policy)) throw Error('Invalid nested test-events proof or command log');
        const child = fs.readFileSync(path.resolve(path.dirname(source), nested.path));
        if (hash(child) !== nested.sha256) throw Error('Nested proof changed during archive');
        const destination = path.resolve(output, path.dirname(name), nested.path);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, child);
      }
      runs.push({ ...run, proof: { path: name, sha256: run.proof.sha256 } });
    }
  }
  const receipts = { stage: 'after-retirement', policy: policy.id, sha, baseline: ledger.sha, runs };
  const progress = missingProgress(ledger, previous, receipts);
  const remaining = progress.rows.filter((row) => row.status !== 'current-scoped-assertion');
  const by = (key) => Object.fromEntries([...new Set(remaining.map((row) => row[key]))].sort()
    .map((value) => [value, remaining.filter((row) => row[key] === value).length]));
  const summary = { ...progress.summary, remainingByKind: by('kind'), remainingByAssignment: by('assignment'),
    releaseEligible: false, sourceSha: sha,
    limitations: 'Same-SHA scoped associations only, with original proof hashes preserved. Fresh native reassertions are distinct from historical execution records. Association counts are not full feature, branch or release completion.' };
  const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
  write('receipts.json', receipts);
  write('missing-progress.json', progress);
  write('summary.json', summary);
  write('inputs.json', { ledger: { path: ledgerFile, sha256: hash(fs.readFileSync(ledgerFile)) },
    historical: { path: previousFile, sha256: hash(fs.readFileSync(previousFile)) }, sources,
    driverSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))) });
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [ledger, previous, output, policy, ...inputs] = process.argv.slice(2);
  if (!policy || !inputs.length) throw Error('Usage: p0-followup-archive.mjs LEDGER PREVIOUS NEW_OUTPUT POLICY RECEIPTS...');
  console.log(JSON.stringify(archiveReceipts(ledger, previous, output, policy, inputs)));
}
