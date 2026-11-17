import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL("../../../", import.meta.url));
const sha = '8f30e6bcc0a4b7706c192896a73b87dc1a915ed9';
const ledgerPath = 'docs/acceptance/issue-257-258/8f30e6b/ledger.json';
const progressPath = 'docs/acceptance/issue-257-258/continuation-1794193456-migration-67/aggregate/missing-progress.json';
const indexPath = 'apps/web/tests/p0-ui-index.json';

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const ledger = readJson(ledgerPath);
const progress = readJson(progressPath);
const index = readJson(indexPath);
if (progress.currentSha !== sha || ledger.sha !== '3c05f640fcc1a04c864e47bfc2880483ad48c984')
  throw Error('Unexpected reviewed ledger/progress SHA');

const remaining = progress.rows.filter((row) => row.status === 'needs-explicit-assertion' && row.kind === 'ui-handler');
if (remaining.length !== 220) throw Error(`Expected 220 remaining UI handlers, got ${remaining.length}`);
const indexed = new Map(Object.values(index.callbacks).flat().map((id) => [id, true]));
const ledgerIds = new Set(ledger.entries.map((row) => row.id));
const bindings = remaining.map((row) => {
  if (!ledgerIds.has(row.id) || !indexed.has(row.id)) throw Error('Missing exact UI index entry: ' + row.id);
  const source = path.join(root, row.file);
  if (!fs.existsSync(source)) throw Error('Missing current UI source: ' + row.file);
  return {
    id: row.id,
    file: row.file,
    line: row.line,
    callback: row.callback,
    acceptanceCaseId: row.acceptanceCaseId,
    status: 'bound-static-only',
    replay: 'not-run',
    sourceSha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
  };
});
const output = process.argv[2];
if (!output) throw Error('Usage: p0-remaining-ui-plan.mjs NEW_PLAN');
fs.writeFileSync(output, JSON.stringify({
  schemaVersion: 1,
  sha,
  source: { ledger: ledgerPath, progress: progressPath, index: indexPath },
  summary: { remainingUiHandlers: bindings.length, boundStaticOnly: bindings.length, replayed: 0 },
  bindings,
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ bindings: bindings.length, replayed: 0, output }));
