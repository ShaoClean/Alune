import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateLedger, validateBindings, assertedRuns, missingProgress, verifyInput } from './p0-test-receipts.mjs';

const sha = '1'.repeat(40), old = '2'.repeat(40), baseline = '3'.repeat(40);
const root = '/fixture';
const ledger = { sha: baseline, entries: [
  { id: 'source:a', kind: 'source', assignment: 'shell' },
  { id: 'method:a', kind: 'method', assignment: 'shell' },
  { id: 'ui:a', uiBehavior: 'UI-001', kind: 'ui-handler', assignment: 'workspace' },
] };
const binding = { entries: ['source:a'], implementation: ['src/a.cjs'],
  tests: [{ file: 'a.test.cjs', line: 7, name: 'denies untrusted input' }],
  assertion: 'Untrusted inputs do not reach opener', limitations: 'Injected opener only' };
const plan = { schemaVersion: 1, sha, bindings: [binding] };
const passed = { type: 'test:pass', data: { file: path.resolve(root, 'a.test.cjs'),
  line: 7, name: binding.tests[0].name, details: { type: 'test' } } };
const summary = { type: 'test:summary', data: { success: true,
  counts: { tests: 1, passed: 1, failed: 0, cancelled: 0 } } };
const proof = { path: 'test-events.json', sha256: '0'.repeat(64) };
const historical = { baseline, sha: old, runs: [
  { sha: old, entries: ['ui:a'], result: 'passed' },
] };
const receipts = { baseline, sha, runs: [{ sha, entries: ['source:a'], result: 'passed' }] };

test('shortened, duplicate or different baseline ID sets cannot produce receipts', () => {
  assert.throws(() => validateLedger(ledger), /complete reviewed/);
  assert.throws(() => validateLedger({ ...ledger, entries: [...ledger.entries, ledger.entries[0]] }), /complete reviewed/);
  assert.throws(() => validateLedger({ sha: '3c05f640fcc1a04c864e47bfc2880483ad48c984', entries: [] }), /complete reviewed/);
});

test('bindings require explicit assertions, limitations, IDs and exact test references', () => {
  validateBindings(ledger, plan);
  for (const extra of [
    { assertion: '' }, { limitations: '' }, { entries: [] }, { tests: [] }, { implementation: [] },
    { entries: ['unknown'] }, { entries: ['ui:a'] }, { entries: ['source:a', 'source:a'] },
    { tests: [{ ...binding.tests[0], line: 0 }] },
  ]) assert.throws(() => validateBindings(ledger, { ...plan, bindings: [{ ...binding, ...extra }] }));
  assert.throws(() => validateBindings(ledger, { ...plan, bindings: [binding, binding] }), /Duplicate/);
});

test('only the exact successful test file, name and declaration line can earn association', () => {
  const runs = assertedRuns(plan, [passed, summary], root, 'darwin-arm64', proof);
  assert.deepEqual(runs[0].entries, ['source:a']);
  assert.equal(runs[0].sha, sha);
  assert.equal(runs[0].limitations, binding.limitations);
  assert.deepEqual(runs[0].proof, proof);
  for (const extra of [
    { skip: true }, { todo: true }, { name: 'similar test' }, { file: '/other/a.test.cjs' },
    { line: 8 }, { details: { type: 'suite' } },
  ]) assert.throws(() => assertedRuns(plan, [{ ...passed, data: { ...passed.data, ...extra } }, summary], root), /Missing/);
  assert.throws(() => assertedRuns(plan, [passed, passed, summary], root), /ambiguous/);
});

test('failed, cancelled, missing and empty batches never mint passed receipts', () => {
  for (const events of [
    [passed], [passed, { ...summary, data: { ...summary.data, success: false } }],
    [passed, { ...summary, data: { success: true, counts: { tests: 0 } } }],
    [passed, { ...summary, data: { success: true, counts: { tests: 1, failed: 1 } } }],
    [passed, { ...summary, data: { success: true, counts: { tests: 1, cancelled: 1 } } }],
    [passed, { type: 'test:fail', data: {} }, summary],
  ]) assert.throws(() => assertedRuns(plan, events, root), /did not complete/);
});

test('progress preserves all old missing IDs and never merges historical SHA for release', () => {
  const report = missingProgress(ledger, historical, receipts);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.previousSha, old);
  assert.equal(report.currentSha, sha);
  assert.equal(report.summary.previousMissing, 2);
  assert.equal(report.summary.newlyAssertedAmongPreviousMissing, 1);
  assert.equal(report.summary.remainingFromPreviousMissing, 1);
  assert.deepEqual(report.rows.map((row) => row.id), ['source:a', 'method:a']);
  assert.equal(report.rows[0].status, 'current-scoped-assertion');
  assert.equal(report.rows[1].status, 'needs-explicit-assertion');
  const failed = missingProgress(ledger, historical, { ...receipts,
    runs: [{ ...receipts.runs[0], result: 'failed' }] });
  assert.equal(failed.summary.newlyAssertedAmongPreviousMissing, 0);
});

test('unknown IDs or mixed-source receipts are rejected, including failed runs', () => {
  for (const result of ['failed', 'passed']) {
    assert.throws(() => missingProgress(ledger, historical, { ...receipts,
      runs: [{ sha, entries: ['unknown'], result }] }), /Unknown current/);
    assert.throws(() => missingProgress(ledger, { ...historical,
      runs: [{ sha: old, entries: ['unknown'], result }] }, receipts), /Unknown historical/);
  }
  assert.throws(() => missingProgress(ledger, historical, { ...receipts,
    runs: [{ sha: old, entries: ['source:a'], result: 'passed' }] }), /Mixed current/);
  assert.throws(() => missingProgress(ledger, { ...historical,
    runs: [{ sha, entries: ['source:a'], result: 'passed' }] }, receipts), /Mixed historical/);
});

test('nonpassing current assertions remain visible and override a passed result for the same ID', () => {
  const report = missingProgress(ledger, historical, { ...receipts,
    runs: [...receipts.runs, { ...receipts.runs[0], result: 'failed' }] });
  assert.equal(report.summary.newlyAssertedAmongPreviousMissing, 0);
  assert.equal(report.summary.nonPassingCurrentIds, 1);
  assert.equal(report.rows[0].status, 'nonpassing-current-assertion');
  assert.equal(report.rows[0].assertions.length, 2);
  assert.equal(report.rows[0].assertions[1].result, 'failed');
});

test('new test tooling requires an exact reviewed hash but cannot override committed implementation', () => {
  const file = 'new.test.mjs', bytes = Buffer.from('isolated reviewed test');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const reviewed = { ...plan, reviewedTooling: { [file]: hash },
    bindings: [{ ...binding, tests: [{ ...binding.tests[0], file }] }] };
  validateBindings(ledger, reviewed);
  verifyInput(file, bytes, undefined, reviewed);
  assert.throws(() => verifyInput(file, Buffer.from('changed'), undefined, reviewed), /tooling changed/);
  assert.throws(() => verifyInput('src/a.cjs', bytes, Buffer.from('committed'),
    { ...reviewed, reviewedTooling: { 'src/a.cjs': hash } }), /input changed/);
  assert.throws(() => verifyInput(file, bytes, undefined, plan), /input changed/);
  verifyInput('src/a.cjs', bytes, bytes, plan);
  for (const reviewedTooling of [{ 'unknown.test.mjs': hash }, { [file]: 'bad hash' }])
    assert.throws(() => validateBindings(ledger, { ...reviewed, reviewedTooling }), /Reviewed tooling/);
});

test('only the repository TypeScript test resolver is accepted as a loader', () => {
  validateBindings(ledger, { ...plan, nodeImports: ['apps/web/tests/resolve-ts.mjs'] });
  for (const nodeImports of [['elsewhere.mjs'], ['apps/web/tests/resolve-ts.mjs', 'extra.mjs'], 'loader'])
    assert.throws(() => validateBindings(ledger, { ...plan, nodeImports }), /Unsupported test loader/);
});
