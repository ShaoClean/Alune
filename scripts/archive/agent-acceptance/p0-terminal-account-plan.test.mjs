import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { terminalAccountPlan } from './p0-terminal-account-plan.mjs';

const ledger = JSON.parse(fs.readFileSync(new URL("../../../docs/acceptance/issue-257-258/8f30e6b/ledger.json", import.meta.url)));
const progress = JSON.parse(fs.readFileSync(new URL("../../../docs/acceptance/issue-257-258/continuation-1794193456-migration-67/aggregate/missing-progress.json", import.meta.url)));
test('terminal and account bindings preserve exactly 48 reviewed unasserted identities', () => {
  const plan = terminalAccountPlan(ledger, progress), entries = plan.bindings.flatMap(row => row.entries);
  assert.equal(plan.bindings.length, 9);
  assert.equal(entries.length, 48);
  assert.equal(new Set(entries).size, 48);
  assert.equal(entries.some(id => id.startsWith('source:')), false);
  for (const row of plan.bindings) {
    assert(row.assertion.length > 30 && row.limitations.length > 30);
    for (const { file, name, line } of row.tests) {
      assert(fs.readFileSync(new URL("../../../" + file, import.meta.url), 'utf8').split('\n')[line - 1].includes(`test('${name}'`));
      assert.match(plan.reviewedTooling[file], /^[a-f0-9]{64}$/);
    }
    for (const file of row.implementation) assert(fs.statSync(new URL("../../../" + file, import.meta.url)).isFile());
  }
});
test('terminal and account bindings reject shortened ledgers and previously asserted rows', () => {
  const shortened = structuredClone(ledger); shortened.entries.pop();
  assert.throws(() => terminalAccountPlan(shortened, progress), /complete reviewed/);
  const id = terminalAccountPlan(ledger, progress).bindings[0].entries[0];
  const other = structuredClone(progress);
  other.rows.find(row => row.id === id).status = 'current-scoped-assertion';
  assert.throws(() => terminalAccountPlan(ledger, other), /unasserted/);
});
test('terminal and account bindings require the actual reviewed progress source', () => {
  assert.throws(() => terminalAccountPlan(ledger, { ...progress, currentSha: '0'.repeat(40) }), /progress SHA/);
});
