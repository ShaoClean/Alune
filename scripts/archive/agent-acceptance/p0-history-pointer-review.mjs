// Review an individually asserted native scenario, never mint release receipts from a failed batch.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateLedger } from './p0-test-receipts.mjs';
import { loadNativeObservation, reconcileUIEvidence } from './reconcile-ui-evidence.mjs';
export const pointerScenario = 'native pointer capture moves the real graph/detail boundary, releases cleanly and retains the selected commit and file';
export const pointerIds = [
  'ui-handler:apps/web/src/components/HistoryWorkspace.tsx:div.onPointerDown:212',
  'ui-handler:apps/web/src/components/HistoryWorkspace.tsx:div.onPointerMove:219',
  'ui-handler:apps/web/src/components/HistoryWorkspace.tsx:div.onPointerUp:228',
  'ui-handler:apps/web/src/components/HistoryWorkspace.tsx:div.onLostPointerCapture:232',
];
export function validatePointerObservation(observation) {
  assert.equal(observation.sha, '8f30e6bcc0a4b7706c192896a73b87dc1a915ed9');
  assert.equal(observation.provenance.head, observation.sha);
  assert.equal(observation.provenance.dirty, false);
  assert.ok(observation.provenance.files?.length > 0, 'Missing source hashes');
  assert.ok(observation.provenance.assets?.length > 0, 'Missing build asset hashes');
  const matches = observation.records.filter((row) => row.scenario === pointerScenario);
  assert.equal(matches.length, 1, 'Expected one exact native pointer assertion');
  const record = matches[0];
  assert.equal(record.sha, observation.sha);
  assert.equal(record.platform, 'darwin');
  assert.equal(record.arch, 'arm64');
  assert.deepEqual(record.ui, ['UI-022']);
  assert.equal(record.facts?.input, 'native Electron pointer');
  assert.match(record.facts?.commit ?? '', /^[a-f0-9]{40}$/);
  for (const field of ['graph', 'detail'])
    for (const phase of ['before', 'after']) assert.ok(Number.isFinite(record.facts[phase][field]));
  assert.ok(record.facts.after.graph > record.facts.before.graph + 10);
  assert.ok(record.facts.after.detail < record.facts.before.detail - 10);
  for (const id of pointerIds) assert.ok(record.executed.includes(id), 'Missing exact callback: ' + id);
  return record;
}
export function reviewPointer(ledger, previous, observation) {
  validateLedger(ledger);
  const record = validatePointerObservation(observation);
  const report = reconcileUIEvidence({ ledger, baseline: previous, currentSha: observation.sha,
    observations: [observation], associations: pointerIds.map((id) => ({
      id, observation: 0, scenario: pointerScenario,
      reason: 'Native down/move/up captured and released the pointer; graph height grew, detail height shrank, and the exact selected historical commit and file remained unchanged. Only these four directly exercised callbacks are reviewed; unrelated listener traces earn nothing.',
      references: [{ file: 'apps/desktop/src/candidate-history-actions.cjs', line: 429 },
        { file: 'apps/desktop/src/candidate-history-actions.cjs', line: 449 },
        { file: 'apps/desktop/src/candidate-history-actions.cjs', line: 451 }],
    })) });
  report.nativeBatch = { complete: observation.complete, exitCode: observation.provenance.exitCode,
    failure: observation.provenance.failure, pointerFacts: record.facts };
  report.driverSha256 = createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [ledger, previous, native, output] = process.argv.slice(2);
  if (!output) throw Error('Usage: p0-history-pointer-review.mjs LEDGER PREVIOUS NATIVE_DIRECTORY REPORT');
  const observation = loadNativeObservation(native, '8f30e6bcc0a4b7706c192896a73b87dc1a915ed9');
  const report = reviewPointer(JSON.parse(fs.readFileSync(ledger)), JSON.parse(fs.readFileSync(previous)), observation);
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report.summary));
}
