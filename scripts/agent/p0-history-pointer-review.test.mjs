import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pointerScenario, pointerIds, validatePointerObservation, reviewPointer } from './p0-history-pointer-review.mjs';
const sha = '8f30e6bcc0a4b7706c192896a73b87dc1a915ed9';
const record = { sha, scenario: pointerScenario, ui: ['UI-022'], platform: 'darwin', arch: 'arm64',
  executed: [...pointerIds], facts: { input: 'native Electron pointer', commit: 'a'.repeat(40),
    before: { graph: 180, detail: 567 }, after: { graph: 240, detail: 507 } } };
const observation = { sha, complete: false, phases: {}, artifacts: [], records: [record],
  provenance: { head: sha, dirty: false, files: [{ file: 'fixture', sha256: '0'.repeat(64) }],
    assets: [{ file: 'fixture', sha256: '0'.repeat(64) }], exitCode: 1, failure: 'Later scenario failed' } };

test('pointer review requires exact SHA, clean source provenance, build hashes, callback trace and geometry', () => {
  assert.equal(validatePointerObservation(observation), record);
  for (const patch of [{ sha: '1'.repeat(40) }, { records: [] }, { records: [record, record] },
    { provenance: { ...observation.provenance, dirty: true } },
    { provenance: { ...observation.provenance, files: [] } },
    { provenance: { ...observation.provenance, assets: [] } }])
    assert.throws(() => validatePointerObservation({ ...observation, ...patch }));
  for (const patch of [{ sha: '1'.repeat(40) }, { platform: 'linux' }, { ui: ['UI-021'] },
    { executed: pointerIds.slice(1) }, { facts: { ...record.facts, commit: '' } },
    { facts: { ...record.facts, after: record.facts.before } },
    { facts: { ...record.facts, after: { graph: NaN, detail: 507 } } }])
    assert.throws(() => validatePointerObservation({ ...observation, records: [{ ...record, ...patch }] }));
});

test('four pointer assertions from an incomplete batch stay partial and never become release evidence', () => {
  const root = new URL('../../docs/acceptance/issue-257-258/8f30e6b/', import.meta.url);
  const report = reviewPointer(JSON.parse(fs.readFileSync(new URL('ledger.json', root))),
    JSON.parse(fs.readFileSync(new URL('historical-ui-input.json', root))), observation);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.nativeBatch.complete, false);
  assert.equal(report.nativeBatch.exitCode, 1);
  assert.equal(report.summary.priorMissingWithReviewedCurrentAssertion, 4);
  assert.equal(report.summary.priorMissingStatuses['reviewed-current-partial-assertion'], 4);
  assert.equal(report.summary.priorMissingStatuses['reviewed-current-complete-assertion'], undefined);
  assert.equal(report.runs, undefined);
});
