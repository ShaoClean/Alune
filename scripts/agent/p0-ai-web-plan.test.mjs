import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiWebPlan } from './p0-ai-web-plan.mjs';
const ledger = JSON.parse(fs.readFileSync(new URL('../../docs/acceptance/issue-257-258/8f30e6b/ledger.json', import.meta.url)));
const progress = JSON.parse(fs.readFileSync(new URL('../../docs/acceptance/issue-257-258/continuation-20261112-terminal-accounts/aggregate/missing-progress.json', import.meta.url)));
test('AI/web assertions identify exact disjoint remaining rows and real test declarations', () => {
  const plans = ['ai', 'web', 'reviews'].map(group => aiWebPlan(ledger, progress, group));
  const ids = plans.flatMap(p => p.bindings.flatMap(b => b.entries));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 61);
  for (const p of plans) for (const b of p.bindings) for (const ref of b.tests)
    assert(fs.readFileSync(new URL('../../' + ref.file, import.meta.url), 'utf8').split('\n')[ref.line - 1].includes("test('" + ref.name + "'"));
});
test('AI/web review rejects stale progress, shortened ledgers and previously credited identities', () => {
  assert.throws(() => aiWebPlan(ledger, { ...progress, currentSha: '0'.repeat(40) }, 'ai'), /progress SHA/);
  assert.throws(() => aiWebPlan({ ...ledger, entries: ledger.entries.slice(1) }, progress, 'ai'), /complete reviewed/);
  const altered = structuredClone(progress), id = aiWebPlan(ledger, progress, 'ai').bindings[0].entries[0];
  altered.rows.find(r => r.id === id).status = 'current-scoped-assertion';
  assert.throws(() => aiWebPlan(ledger, altered, 'ai'), /unasserted ID/);
});
