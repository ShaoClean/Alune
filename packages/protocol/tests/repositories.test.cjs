const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateRepositoryQuery,
  validateRepositoryReceipt,
  validateRepositoryValue,
} = require('../dist');
const resource = { agentId: 'agent', resourceId: 'repository' };
test('repository RPC rejects wrong target shapes, write verbs and extra command parameters', () => {
  for (const value of [
    { resource, kind: 'execute', params: { args: ['reset', '--hard'] } },
    { resource, kind: 'status', params: { refreshIndex: true } },
    { resource, kind: 'diff', params: { file: 'a', fullFile: 'true' } },
    { resource, kind: 'file', params: {} },
    { resource: { ...resource, host: 'other' }, kind: 'status', params: {} },
    { resource, kind: 'signatures', params: { hashes: ['--all'] } },
  ])
    assert.throws(
      () => validateRepositoryQuery(value),
      (e) => e.kind === 'invalid-params',
    );
});
test('malformed typed results and oversized snapshot allocations fail before reaching the UI', () => {
  for (const [kind, value] of [
    ['file', { path: 'a', kind: 'text', size: 1, encoding: 'utf-8' }],
    ['blame', { path: 'a', kind: 'future' }],
    ['lfs', {}],
    ['status', { branch: 'main', files: [{}], ahead: 0, behind: 0 }],
  ])
    assert.throws(
      () => validateRepositoryValue(kind, value),
      (e) => e.kind === 'invalid-request',
    );
  assert.throws(() =>
    validateRepositoryReceipt({
      resource,
      kind: 'file',
      generation: 0,
      snapshotId: 'snapshot',
      bytes: 2 ** 31,
      chunks: 65536,
    }),
  );
  assert.throws(() =>
    validateRepositoryReceipt({
      resource,
      kind: 'file',
      generation: 0,
      snapshotId: 'snapshot',
      bytes: 1,
      chunks: 1,
      value: 'ambiguous',
    }),
  );
});
