import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { certify, validateInputs, validateHead, verifyHashes, outputDirectory, main, hash, root } from './p0-client-runner.mjs';
import { normalizeOperation } from './p0-client-oracle.mjs';
import { baseline, cases } from './p0-client-cases.mjs';
import { regressionNames as names } from './p0-client-regressions.mjs';
import { validProof } from './acceptance-policy.mjs';
const inheritedScratch = process.env.PI_SCRATCH_DIR;
const testScratch = fs.mkdtempSync(path.join(inheritedScratch || os.tmpdir(), 'alune-client-tools-'));
process.env.PI_SCRATCH_DIR = testScratch;
after(() => {
  if (inheritedScratch === undefined) delete process.env.PI_SCRATCH_DIR;
  else process.env.PI_SCRATCH_DIR = inheritedScratch;
  fs.rmSync(testScratch, { recursive: true, force: true });
});
const expected = [{ file: 'scripts/agent/p0-client-contract.test.mjs', name: 'fixture assertion' }];
const green = () => [
  { type: 'test:pass', data: { name: 'fixture assertion', file: path.join(root, expected[0].file), line: 51, details: { type: 'test' } } },
  { type: 'test:summary', data: { success: true, counts: { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 } } },
];
const ledger = fs.readFileSync(path.join(root, baseline.ledger)), progress = fs.readFileSync(path.join(root, baseline.progress));
test(names[0], () => assert.equal(certify(green(), expected).passed, 1));
test(names[1], () => {
  assert.throws(() => certify([...green(), { type: 'test:fail', data: {} }], expected));
  for (const field of ['failed', 'cancelled']) { const e = green(); e[1].data.counts[field] = 1; assert.throws(() => certify(e, expected)); }
  const e = green(); e[1].data.success = false; assert.throws(() => certify(e, expected));
});
test(names[2], () => {
  for (const field of ['skip', 'todo']) { const e = green(); e[0].data[field] = true; assert.throws(() => certify(e, expected)); }
  for (const field of ['skipped', 'todo']) { const e = green(); e[1].data.counts[field] = 1; assert.throws(() => certify(e, expected)); }
});
test(names[3], () => {
  const e = green(); assert.throws(() => certify([...e, e[0]], expected));
  assert.throws(() => certify(e, [...expected, ...expected]));
  const two = [...expected, { ...expected[0], name: 'other' }];
  e[1].data.counts.tests = 2; e[1].data.counts.passed = 2;
  assert.throws(() => certify([e[0], e[0], e[1]], two));
});
test(names[4], () => {
  assert.throws(() => certify(green().slice(0,1), expected));
  assert.throws(() => certify(green().slice(1), expected));
  const e = green(); e[0].data.file = '/wrong/test.mjs'; assert.throws(() => certify(e, expected));
  const other = green(); other[0].data.line = 0; assert.throws(() => certify(other, expected));
  const duplicateSummary = green(); duplicateSummary.push(duplicateSummary[1]); assert.throws(() => certify(duplicateSummary, expected));
});
test(names[5], () => {
  const e = green(); e[1].data.counts.tests = 2; assert.throws(() => certify(e, expected));
  const extra = green(); extra.push({ ...extra[0], data: { ...extra[0].data, name: 'unexpected' } });
  assert.throws(() => certify(extra, expected));
  assert.throws(() => certify(green(), []));
});
test(names[6], () => {
  assert.equal(validateInputs(ledger, progress).scope.length, 125);
  const shortened = JSON.parse(ledger); shortened.entries.pop();
  assert.throws(() => validateInputs(Buffer.from(JSON.stringify(shortened)), progress));
  assert.throws(() => validateInputs(Buffer.concat([ledger, Buffer.from(' ')]), progress));
  assert.throws(() => validateInputs(ledger, Buffer.concat([progress, Buffer.from(' ')])));
});
test(names[7], () => {
  for (const replacement of [cases[1], { ...cases[0], entryId: 'unknown' },
    { ...cases[0], entryId: 'client-api:apps/web/src/api/index.ts:gitTimeout.timeout' },
    { ...cases[0], invoke: null }, { ...cases[0], requests: [] },
    { ...cases[0], testName: cases[1].testName }]) assert.throws(() => validateInputs(ledger, progress, [replacement, ...cases.slice(1)]));
});
test(names[8], () => {
  validateHead(baseline.head);
  for (const sha of [undefined, '', '8f30e6b', '0'.repeat(40), 'c81cbdf84cfebf49b33e60deefe2236c265712e1', baseline.head.toUpperCase()])
    assert.throws(() => validateHead(sha));
});
test(names[9], () => {
  const scratch = process.env.PI_SCRATCH_DIR;
  assert.ok(scratch, 'PI_SCRATCH_DIR is required for isolated tool tests');
  const dir = fs.mkdtempSync(path.join(scratch, 'p0-client-proof-'));
  try {
    const f = path.join(dir, 'proof.json'); fs.writeFileSync(f, '{}\n');
    const digest = hash(fs.readFileSync(f));
    const proof = { path: 'proof.json', sha256: digest }, policy = { localProofs: true };
    verifyHashes({ [f]: digest });
    assert.equal(validProof(proof, path.join(dir, 'receipts.json'), policy), true);
    assert.equal(validProof({ ...proof, sha256: '0'.repeat(64) }, path.join(dir, 'receipts.json'), policy), false);
    assert.equal(validProof(proof, path.join(dir, 'receipts.json'), { localProofs: false }), false);
    assert.equal(validProof({ ...proof, path: f }, path.join(dir, 'receipts.json'), policy), false);
    fs.writeFileSync(f, 'tampered');
    assert.throws(() => verifyHashes({ [f]: digest }));
    assert.equal(validProof(proof, path.join(dir, 'receipts.json'), policy), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test(names[10], async () => {
  await assert.rejects(main(['scripts/agent']), /Output must be a NEW/);
  await assert.rejects(main(['../p0-client-evidence-outside']), /Output must be a NEW/);
  await assert.rejects(main([root]), /Output must be a NEW/);
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.PI_SCRATCH_DIR), 'p0-client-evidence-regression-'));
  try { await assert.rejects(main([dir]), /Output must be a NEW/); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.equal(outputDirectory(dir), dir);
  assert.throws(() => outputDirectory(path.join(dir, 'nested')));
});
test(names[11], () => {
  const operationId = '11111111-1111-4111-8111-111111111111', state = {};
  const frozen = { operationId: '$operationId', kind: 'stage', args: [['a.ts']] };
  assert.deepEqual(normalizeOperation({ operationId, kind: 'stage', args: [['a.ts']] }, frozen, state), frozen);
  assert.deepEqual(normalizeOperation({ taskId: operationId }, { taskId: '$operationId' }, state), { taskId: '$operationId' });
  for (const bad of ['not-a-uuid', '11111111-1111-1111-8111-111111111111', '11111111-1111-4111-7111-111111111111'])
    assert.throws(() => normalizeOperation({ operationId: bad }, { operationId: '$operationId' }, {}));
  assert.throws(() => normalizeOperation({ taskId: '22222222-2222-4222-8222-222222222222' }, { taskId: '$operationId' }, state));
  assert.throws(() => normalizeOperation({ operationId: '22222222-2222-4222-8222-222222222222' }, { operationId: '$operationId' }, state));
  assert.throws(() => assert.deepEqual(normalizeOperation({ operationId, kind: 'push', args: [['a.ts']] }, frozen, state), frozen));
  assert.throws(() => assert.deepEqual(normalizeOperation({ operationId, kind: 'stage', args: [['wrong.ts']] }, frozen, state), frozen));
  assert.deepEqual(normalizeOperation({ id: 'untouched' }, { id: 'literal' }, {}), { id: 'untouched' });
});
test(names[12], () => {
  assert.throws(() => validateInputs(ledger, progress, cases.slice(1)));
  const foreign = { ...cases[0], requests: [{ ...cases[0].requests[0], host: 'unreviewed-agent' }] };
  assert.throws(() => validateInputs(ledger, progress, [foreign, ...cases.slice(1)]));
});
