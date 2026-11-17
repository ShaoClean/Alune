import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserBindings, reviewedBrowserRuns } from './p0-layout-browser-receipts.mjs';
const ledger = JSON.parse(fs.readFileSync(new URL("../../../docs/acceptance/issue-257-258/8f30e6b/ledger.json", import.meta.url)));
const progress = JSON.parse(fs.readFileSync(new URL("../../../docs/acceptance/issue-257-258/continuation-20261112-terminal-accounts/aggregate/missing-progress.json", import.meta.url)));
function fixture() {
  return { status: 'passed', limitations: 'Synthetic validator input only; never an execution receipt.', records: [
    ...browserBindings.map(b => ({ name: b.prefix, facts: b.prefix === 'Markdown external image' ? { failed: true, automaticExternalRequest: false } : { fixture: true }, executed: [...b.entries, 'unrelated-observed-callback'] })),
    { name: 'Diff navigation unmount', facts: { index: -1, listenersAfterUnmount: 0, listenersAfterRemount: 1 }, executed: [] },
  ] };
}
const proof = { path: 'fixture.json', sha256: 'a'.repeat(64) };
test('browser review associates only the 24 exact IDs and ignores incidental traces', () => {
  const runs = reviewedBrowserRuns(ledger, progress, fixture(), progress.currentSha, proof);
  const ids = runs.flatMap(r => r.entries);
  assert.equal(ids.length, 24); assert.equal(new Set(ids).size, 24);
  assert.equal(ids.some(id => id === 'unrelated-observed-callback'), false);
  assert.equal(ids.filter(id => /^ui-/.test(id)).length, 13);
  assert(runs.every(run => !run.assertion.includes('automaticExternalRequest')));
});
test('browser review rejects failed or incomplete batches, missing callbacks and leaked listeners', () => {
  for (const mutate of [r => { r.status = 'failed'; }, r => { r.records.pop(); }, r => { r.records[0].executed.pop(); r.records[0].executed.pop(); }, r => { r.records.at(-1).facts.listenersAfterUnmount = 1; }]) {
    const result = fixture(); mutate(result);
    assert.throws(() => reviewedBrowserRuns(ledger, progress, result, progress.currentSha, proof));
  }
});
