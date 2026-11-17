import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateReceiptInput, archiveReceipts } from './p0-followup-archive.mjs';
import { preloadPlan, webPlan } from './p0-followup-plans.mjs';
import { validateLedger, validateBindings } from './p0-test-receipts.mjs';
const root = new URL('../../', import.meta.url);
const ledgerFile = new URL('docs/acceptance/issue-257-258/8f30e6b/ledger.json', root);
const previousFile = new URL('docs/acceptance/issue-257-258/8f30e6b/historical-ui-input.json', root);
const policyFile = new URL('scripts/agent/acceptance-mac-arm64.json', root);
const ledger = JSON.parse(fs.readFileSync(ledgerFile)), policy = JSON.parse(fs.readFileSync(policyFile));
const sha = '8f30e6bcc0a4b7706c192896a73b87dc1a915ed9';
const id = 'channel:apps/desktop/src/preload.cjs:ipcRenderer.invoke:updates:state:14';
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'p0-archive-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = '{"asserted":true}\n';
  fs.writeFileSync(path.join(directory, 'proof.json'), bytes);
  const run = { sha, target: 'darwin-arm64', scenario: 'exact fixture', assertion: 'Exact value equal',
    limitations: 'Isolated fixture only', entries: [id], result: 'passed',
    proof: { path: 'proof.json', sha256: createHash('sha256').update(bytes).digest('hex') } };
  const evidence = { stage: 'after-retirement', sha, baseline: ledger.sha, policy: policy.id, runs: [run] };
  const input = path.join(directory, 'receipts.json');
  fs.writeFileSync(input, JSON.stringify(evidence));
  return { directory, input, run, evidence };
}

test('both authored plans bind exact non-UI identities and existing declaration lines', () => {
  validateLedger(ledger);
  for (const plan of [preloadPlan(), webPlan()]) validateBindings(ledger, plan);
  assert.equal(preloadPlan().bindings.flatMap((row) => row.entries).length, 19);
  assert.equal(webPlan().bindings.flatMap((row) => row.entries).length, 78);
});

test('receipt archive validation rejects wrong SHA, policy, IDs, target, duplicate IDs and unverified proofs', (t) => {
  const f = fixture(t);
  validateReceiptInput(ledger, f.evidence, f.input, policy, sha);
  for (const extra of [{ sha: '1'.repeat(40) }, { baseline: '1'.repeat(40) }, { policy: 'other' }, { runs: [] }])
    assert.throws(() => validateReceiptInput(ledger, { ...f.evidence, ...extra }, f.input, policy, sha));
  for (const extra of [{ sha: '1'.repeat(40) }, { target: 'linux-x64' }, { entries: [id, id] },
    { entries: ['unknown'] }, { result: 'skipped' }, { result: 'todo' }, { assertion: '' },
    { limitations: '' }, { proof: { ...f.run.proof, sha256: '0'.repeat(64) } },
    { proof: { ...f.run.proof, path: '../outside.json' } }])
    assert.throws(() => validateReceiptInput(ledger, { ...f.evidence, runs: [{ ...f.run, ...extra }] }, f.input, policy, sha));
});

test('archive preserves failed same-ID runs, full historical gap and prevents output reuse', (t) => {
  const f = fixture(t), output = path.join(f.directory, 'archive');
  fs.writeFileSync(f.input, JSON.stringify({ ...f.evidence, runs: [f.run, { ...f.run, result: 'failed' }] }));
  const args = [ledgerFile, previousFile, output, policyFile, [f.input]];
  const summary = archiveReceipts(...args);
  assert.equal(summary.previousMissing, 2112);
  assert.equal(summary.newlyAssertedAmongPreviousMissing, 0);
  assert.equal(summary.remainingFromPreviousMissing, 2112);
  assert.equal(summary.nonPassingCurrentIds, 1);
  assert.equal(summary.releaseEligible, false);
  const receipts = JSON.parse(fs.readFileSync(path.join(output, 'receipts.json')));
  assert.deepEqual(receipts.runs.map((row) => row.result), ['passed', 'failed']);
  validateReceiptInput(ledger, receipts, path.join(output, 'receipts.json'), policy, sha);
  assert.throws(() => archiveReceipts(...args), /EEXIST/);
  assert.throws(() => archiveReceipts(ledgerFile, previousFile, path.join(f.directory, 'duplicate'), policyFile,
    [f.input, f.input]), /Duplicate receipt input/);
});

test('archive copies referenced raw test events and rejects a changed nested attachment', (t) => {
  const f = fixture(t), events = '[{"type":"test:pass"}]\n';
  fs.writeFileSync(path.join(f.directory, 'events.json'), events);
  const proof = JSON.stringify({ events: { path: 'events.json', sha256: createHash('sha256').update(events).digest('hex') } });
  fs.writeFileSync(path.join(f.directory, 'proof.json'), proof);
  const evidence = { ...f.evidence, runs: [{ ...f.run,
    proof: { path: 'proof.json', sha256: createHash('sha256').update(proof).digest('hex') } }] };
  fs.writeFileSync(f.input, JSON.stringify(evidence));
  const output = path.join(f.directory, 'nested-archive');
  archiveReceipts(ledgerFile, previousFile, output, policyFile, [f.input]);
  assert.equal(fs.readFileSync(path.join(output, 'proofs/0/events.json'), 'utf8'), events);
  fs.writeFileSync(path.join(f.directory, 'events.json'), 'changed');
  const invalid = path.join(f.directory, 'tampered-archive');
  assert.throws(() => archiveReceipts(ledgerFile, previousFile, invalid, policyFile, [f.input]), /nested test-events proof/);
  assert.equal(fs.existsSync(path.join(invalid, 'receipts.json')), false);
});

test('archive retains engineering command logs and refuses tampering or escaped log references', t => {
  const f = fixture(t), log = 'Real command fixture passed\n';
  fs.writeFileSync(path.join(f.directory, 'command.log'), log);
  const store = reference => {
    const bytes = JSON.stringify({ results: [{ name: 'command', status: 0, log: reference }] });
    fs.writeFileSync(path.join(f.directory, 'proof.json'), bytes);
    fs.writeFileSync(f.input, JSON.stringify({ ...f.evidence, runs: [{ ...f.run, proof: { path: 'proof.json', sha256: createHash('sha256').update(bytes).digest('hex') } }] }));
  };
  store({ path: 'command.log', sha256: createHash('sha256').update(log).digest('hex') });
  const output = path.join(f.directory, 'commands');
  archiveReceipts(ledgerFile, previousFile, output, policyFile, [f.input]);
  assert.equal(fs.readFileSync(path.join(output, 'proofs/0/command.log'), 'utf8'), log);
  fs.writeFileSync(path.join(f.directory, 'command.log'), 'tampered');
  assert.throws(() => archiveReceipts(ledgerFile, previousFile, path.join(f.directory, 'tampered'), policyFile, [f.input]), /command log/);
  store({ path: '../command.log', sha256: createHash('sha256').update(log).digest('hex') });
  assert.throws(() => archiveReceipts(ledgerFile, previousFile, path.join(f.directory, 'escaped'), policyFile, [f.input]), /command log/);
});
