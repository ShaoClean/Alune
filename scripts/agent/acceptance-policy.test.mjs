import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readPolicy, validProof, supportedTargets } from './acceptance-policy.mjs';

test('platform deferral is explicit; default acceptance still requires all platforms', () => {
  assert.deepEqual(readPolicy().requiredTargets, supportedTargets);
  assert.equal(readPolicy().localProofs, false);
  const policy = readPolicy(new URL('./acceptance-mac-arm64.json', import.meta.url));
  assert.deepEqual(policy.requiredTargets, ['darwin-arm64']);
});

test('local evidence requires exact bytes, containment, and explicit policy', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'proofs'));
  fs.writeFileSync(path.join(root, 'proofs', 'run.log'), 'assertions passed\n');
  fs.writeFileSync(path.join(root, 'outside.log'), 'outside');
  const evidence = path.join(root, 'proofs', 'receipts.json');
  const policy = { localProofs: true };
  const proof = {
    path: 'run.log',
    sha256: createHash('sha256').update('assertions passed\n').digest('hex'),
  };
  assert.equal(validProof(proof, evidence, policy), true);
  assert.equal(validProof(proof, evidence, readPolicy()), false);
  assert.equal(validProof({ ...proof, path: '../outside.log' }, evidence, policy), false);
  fs.symlinkSync(path.join(root, 'outside.log'), path.join(root, 'proofs', 'link'));
  assert.equal(validProof({ ...proof, path: 'link' }, evidence, policy), false);
  assert.equal(validProof({ ...proof, path: '/etc/passwd' }, evidence, policy), false);
  assert.equal(validProof({ ...proof, path: 'absent.log' }, evidence, policy), false);
  fs.appendFileSync(path.join(root, 'proofs', 'run.log'), 'changed');
  assert.equal(validProof(proof, evidence, policy), false);
  assert.equal(
    validProof('https://github.com/ShaoClean/Alune/actions/runs/123', evidence, policy),
    true,
  );
  assert.equal(validProof('https://github.com.example.org/fake', evidence, policy), false);
});

test('empty, unknown and duplicate platform policies cannot pass', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'policy.json');
  for (const requiredTargets of [[], ['made-up'], ['darwin-arm64', 'darwin-arm64']]) {
    fs.writeFileSync(
      file,
      JSON.stringify({ schemaVersion: 1, id: 'invalid', requiredTargets, localProofs: true }),
    );
    assert.throws(() => readPolicy(file), /Invalid acceptance policy/);
  }
});
