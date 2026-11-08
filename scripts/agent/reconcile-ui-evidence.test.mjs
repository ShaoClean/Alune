import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reconcileUIEvidence, loadNativeObservation, assertionCandidates } from './reconcile-ui-evidence.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const p0 = '0'.repeat(40), old = '1'.repeat(40), current = '2'.repeat(40);
const ledger = { sha: p0, entries: [
  { id: 'first', file: 'First.tsx', line: 1, uiBehavior: 'UI-001' },
  { id: 'second', file: 'Second.tsx', line: 2, uiBehavior: 'UI-001' },
  { id: 'background', file: 'Background.tsx', line: 3, uiBehavior: 'UI-002' },
] };
const baseline = { sha: old, baseline: p0, runs: [
  { sha: old, result: 'passed', scenario: 'historical', entries: ['first'] },
] };
const record = (sha = current, executed = ['second', 'background']) => ({
  sha, scenario: 'asserted state and preserved Git bytes', ui: ['UI-001'], executed,
  platform: 'darwin', arch: 'arm64',
});
const reconcile = (extra = {}) => reconcileUIEvidence({ ledger, baseline, currentSha: current, ...extra });

test('historical associations and source references are never current execution', () => {
  const report = reconcile({ candidates: [{ ui: ['UI-001'], file: 'test.cjs', line: 4, evidence: false }] });
  assert.equal(report.releaseEligible, false);
  assert.equal(report.summary.previouslyAssociated, 1);
  assert.equal(report.summary.priorMissing, 2);
  assert.equal(report.rows[0].status, 'needs-assertion-review');
  assert.equal(report.rows[1].candidateAssertions.length, 1);
  assert.equal(report.rows[1].assertions.length, 0);
});

test('focused or incomplete execution credits only fired callbacks in asserted families', () => {
  const report = reconcile({ observations: [{ sha: current, complete: false, records: [record()] }] });
  assert.equal(report.rows[1].status, 'current-partial-trace-needs-review');
  assert.equal(report.rows[0].status, 'needs-assertion-review');
  assert.equal(report.rows[2].assertions.length, 0);
  assert.equal(report.summary.priorMissingStatuses['current-partial-trace-needs-review'], 1);
});

test('reviewed associations require the exact observed ID and scenario, and remain partial', () => {
  const observation = { sha: current, complete: false, records: [record()] };
  const association = { id: 'second', observation: 0, scenario: record().scenario,
    reason: 'Actual retry restores this selected file and its bytes', references: [{ file: 'test.cjs', line: 1 }] };
  const report = reconcile({ observations: [observation], associations: [association] });
  assert.equal(report.rows[1].status, 'reviewed-current-partial-assertion');
  assert.equal(report.rows[1].reviewedAssertions.length, 1);
  assert.equal(report.rows[0].reviewedAssertions.length, 0);
  assert.equal(report.releaseEligible, false);
  const invalid = (extra) => reconcile({ observations: [observation], associations: [{ ...association, ...extra }] });
  assert.throws(() => invalid({ id: 'first' }), /Invalid.*association/);
  assert.throws(() => invalid({ id: 'background' }), /Invalid.*association/);
  assert.throws(() => invalid({ scenario: 'unexecuted scenario' }), /Invalid.*association/);
  assert.throws(() => invalid({ references: [] }), /Invalid.*association/);
  assert.throws(() => reconcile({ observations: [observation], associations: [association, association] }), /duplicate/);
  const historical = reconcile({ observations: [{ ...observation, sha: old, records: [record(old)] }], associations: [association] });
  assert.equal(historical.rows[1].status, 'needs-assertion-review');
  assert.equal(historical.rows[1].reviewedAssertions[0].sha, old);
});

test('old partial observations retain their actual SHA and cannot fill current gaps', () => {
  const report = reconcile({ observations: [{ sha: old, complete: false, records: [record(old)] }] });
  assert.equal(report.rows[1].status, 'needs-assertion-review');
  assert.equal(report.rows[1].assertions[0].sha, old);
});

test('unknown IDs, mixed-source records and failed historical receipts fail closed', () => {
  assert.throws(() => reconcile({ observations: [{ sha: current, records: [record(old)] }] }), /Mixed-source/);
  assert.throws(() => reconcile({ observations: [{ sha: current, records: [record(current, ['unknown'])] }] }), /Unknown P0/);
  assert.throws(() => reconcile({ baseline: { ...baseline, baseline: current } }), /Invalid reconciliation/);
  assert.throws(() => reconcile({ baseline: { ...baseline, runs: [{ ...baseline.runs[0], sha: current }] } }), /Mixed baseline/);
  const report = reconcile({ baseline: { ...baseline, runs: [{ ...baseline.runs[0], result: 'failed' }] } });
  assert.equal(report.summary.previouslyAssociated, 0);
});

test('manual unwired dispositions preserve the entry and require a reason and references', () => {
  const review = { id: 'second', disposition: 'unwired', reason: 'No production importer',
    references: [{ file: 'Second.tsx', line: 2 }] };
  const report = reconcile({ reviews: [review] });
  assert.equal(report.summary.total, 3);
  assert.equal(report.rows[1].status, 'unwired');
  assert.equal(report.rows[1].assertions.length, 0);
  assert.throws(() => reconcile({ reviews: [{ ...review, references: [] }] }), /Incomplete/);
  assert.throws(() => reconcile({ reviews: [review, review] }), /duplicate/);
  assert.throws(() => reconcile({ reviews: [{ ...review, references: [null] }] }), /Incomplete/);
  assert.throws(() => reconcile({ reviews: [{ ...review, references: [{ file: 'Second.tsx', line: 0 }] }] }), /Incomplete/);
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-ui-reconcile-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (name, value) => fs.writeFileSync(path.join(directory, name),
    name.endsWith('.jsonl') ? JSON.stringify(value) + '\n' : JSON.stringify(value));
  write('workbench.json', [record()]);
  return { directory, write };
}

test('missing restore and focused completion remain partial; complete phases are independently required', (t) => {
  const { directory, write } = fixture(t);
  assert.equal(loadNativeObservation(directory, current).complete, false);
  write('scenarios-write.jsonl', record());
  write('complete-write.json', { sha: current, phase: 'write', focus: null, result: 'passed' });
  assert.equal(loadNativeObservation(directory, current).complete, false);
  write('scenarios-restore.jsonl', record());
  write('complete-restore.json', { sha: current, phase: 'restore', focus: 'files', result: 'passed' });
  assert.equal(loadNativeObservation(directory, current).complete, false);
  write('complete-restore.json', { sha: current, phase: 'restore', focus: null, result: 'passed' });
  const full = loadNativeObservation(directory, current);
  assert.equal(full.complete, true);
  assert.equal(full.artifacts.length, 5);
  assert.match(full.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  const report = reconcile({ observations: [full] });
  assert.equal(report.rows[1].status, 'current-complete-trace-needs-review');
  assert.equal(report.releaseEligible, false);
});

test('focused measure-only suites retain their JSONL without inventing a workbench or full acceptance', (t) => {
  const { directory, write } = fixture(t);
  fs.unlinkSync(path.join(directory, 'workbench.json'));
  assert.throws(() => loadNativeObservation(directory, current), /Missing native scenario/);
  write('scenarios-write.jsonl', record());
  write('complete-write.json', { sha: current, phase: 'write', focus: 'updates', result: 'passed' });
  const run = loadNativeObservation(directory, current);
  assert.equal(run.records.length, 1);
  assert.equal(run.complete, false);
  assert.equal(run.provenance.dirty, null);
});

test('source patch provenance is retained and mismatched snapshots fail closed', (t) => {
  const { directory, write } = fixture(t);
  const patch = 'isolated test-only patch\n';
  fs.writeFileSync(path.join(directory, 'native-driver.patch'), patch);
  const source = { head: current, dirty: true, patch: { name: 'native-driver.patch',
    sha256: createHash('sha256').update(patch).digest('hex') } };
  write('source-state.json', source);
  assert.equal(loadNativeObservation(directory, current).provenance.dirty, true);
  fs.mkdirSync(path.join(directory, 'source-copies'));
  fs.writeFileSync(path.join(directory, 'source-copies/new.cjs'), patch);
  write('source-state.json', { ...source, files: [{ file: 'new.cjs', copy: 'source-copies/new.cjs', sha256: source.patch.sha256 }] });
  assert.equal(loadNativeObservation(directory, current).provenance.files.length, 1);
  fs.appendFileSync(path.join(directory, 'source-copies/new.cjs'), 'changed');
  assert.throws(() => loadNativeObservation(directory, current), /Invalid native source copy/);
  write('source-state.json', source);
  fs.appendFileSync(path.join(directory, 'native-driver.patch'), 'modified');
  assert.throws(() => loadNativeObservation(directory, current), /Invalid native source patch/);
  write('source-state.json', { ...source, head: old });
  assert.throws(() => loadNativeObservation(directory, current), /Invalid native source provenance/);
  write('source-state.json', { ...source, patch: { name: '../outside', sha256: source.patch.sha256 } });
  assert.throws(() => loadNativeObservation(directory, current), /Invalid native source patch/);
});

test('new untracked acceptance assertions are candidates, never evidence', (t) => {
  const { directory } = fixture(t);
  execFileSync('git', ['init', '--quiet', directory]);
  const source = path.join(directory, 'apps/desktop/src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'new.cjs'), "pass(); pass(['UI-001'], 'explicit bytes assertion');\n");
  const found = assertionCandidates(directory);
  assert.equal(found.length, 1);
  assert.equal(found[0].evidence, false);
  assert.deepEqual(found[0].ui, ['UI-001']);
  assert.match(found[0].sourceSha256, /^[a-f0-9]{64}$/);
});

test('forged completion markers and empty phases are rejected', (t) => {
  const { directory, write } = fixture(t);
  write('complete-write.json', { sha: old, phase: 'write', focus: null, result: 'passed' });
  assert.throws(() => loadNativeObservation(directory, current), /Invalid native completion/);
  write('complete-write.json', { sha: current, phase: 'write', focus: null, result: 'passed' });
  write('complete-restore.json', { sha: current, phase: 'restore', focus: null, result: 'passed' });
  write('scenarios-restore.jsonl', record());
  fs.writeFileSync(path.join(directory, 'scenarios-write.jsonl'), '\n');
  assert.throws(() => loadNativeObservation(directory, current), /Empty native/);
});
