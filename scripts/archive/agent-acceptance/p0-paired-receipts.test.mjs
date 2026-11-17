import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairedRuns } from './p0-paired-receipts.mjs';

const sha = '1'.repeat(40), baseline = '2'.repeat(40), target = 'darwin-arm64';
const endpoint = { id: 'http-id', kind: 'http', file: 'controller.ts', name: 'POST /stage', handler: 'Controller.stage', line: 10 };
const method = { id: 'method-id', kind: 'method', file: 'controller.ts', name: 'Controller.stage' };
const ledger = { sha: baseline, entries: [endpoint, method,
  { id: 'incidental-helper', kind: 'method', file: 'helper.ts', name: 'stage' }] };
const report = { baseline, candidate: sha, target, rows: [
  { scenario: 'stage literal path', route: 'POST /stage', result: 'equal', observedFrozenMethods: ['incidental-helper'] },
] };
const spec = { expectedCases: 1, assertion: 'Index, refs and worktree match', limitations: 'Declared fixture only' };
const run = (extra = {}) => pairedRuns(ledger, { ...report, ...extra }, spec, sha, target, {});

test('exact endpoint and direct controller handler are associated, incidental traces are not', () => {
  const [receipt] = run();
  assert.deepEqual(receipt.entries, ['http-id', 'method-id']);
  assert.deepEqual(receipt.observedOnly, ['incidental-helper']);
  assert.equal(receipt.result, 'passed');
  assert.equal(receipt.limitations, spec.limitations);
});

test('failed scenarios remain failed and incomplete or mixed-source reports are rejected', () => {
  const [failed] = run({ rows: [{ ...report.rows[0], result: 'not-equal' }] });
  assert.equal(failed.result, 'failed');
  for (const extra of [
    { candidate: baseline }, { baseline: sha }, { target: 'linux-x64' }, { outcome: 'failed' },
    { rows: [] }, { rows: [{ ...report.rows[0], result: 'skipped' }] },
  ]) assert.throws(() => run(extra));
  assert.throws(() => pairedRuns(ledger, report, { ...spec, limitations: '' }, sha, target, {}));
});

test('unknown, ambiguous or wrong-file controller mappings cannot earn associations', () => {
  assert.throws(() => run({ rows: [{ ...report.rows[0], route: 'POST /unstage' }] }), /Unknown/);
  assert.throws(() => pairedRuns({ ...ledger, entries: [endpoint] }, report, spec, sha, target, {}), /controller/);
  assert.throws(() => pairedRuns({ ...ledger, entries: [endpoint, { ...method, file: 'other.ts' }] }, report, spec, sha, target, {}), /controller/);
  assert.throws(() => pairedRuns({ ...ledger, entries: [...ledger.entries, { ...endpoint, id: 'duplicate' }] }, report, spec, sha, target, {}), /ambiguous HTTP/);
  assert.throws(() => pairedRuns(ledger, { ...report, rows: [report.rows[0], report.rows[0]] },
    { ...spec, expectedCases: 2 }, sha, target, {}), /duplicate/);
});
