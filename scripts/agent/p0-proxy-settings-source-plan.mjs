export const batch = 'docs/acceptance/issue-257-258/batch-27-proxy-settings-source-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-26-proxy-module-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-proxy-settings-source.test.cjs';
export const implementation = [
  'packages/agent/src/modules/settings/proxy.ts',
  'packages/agent/src/bootstrap/settings-kernel.ts',
  'packages/agent/src/bootstrap/state-kernel.ts',
  'packages/agent/src/adapters/sqlite/state.ts',
  'packages/agent/src/adapters/secrets/protected.ts',
  'packages/agent/src/ports/settings-errors.ts',
  'packages/agent/src/server/session.ts',
];
export const names = {
  inventory:
    'P0 complete proxy settings source inventory defaults and damaged configuration fail closed in frozen and successor',
  inputs:
    'P0 complete proxy settings source validates every input family and credential action without mutation on rejection',
  snapshots:
    'P0 complete proxy settings source snapshots bind credentials and contain all malformed decrypted payloads',
  persistence:
    'P0 complete proxy settings source records atomic cleanup document CAS and ambiguous write outcomes',
  owners:
    'P0 complete proxy settings successor real owners isolate cancellation CAS encryption and restart',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped migrated-responsibility acceptance only; releaseEligible=false. Entire exact frozen proxy-settings.ts executes, including defaults/validate/full constructor/read/assertRevision/snapshot/save. Legacy fs/Nest exceptions and deterministic synthetic cipher are explicit recording doubles; no live Nest or actual legacy JSON filesystem permission/durability guarantee. Successor class runs production dist against recorded document/cipher faults, with separate actual SQLite/kernel/file-cipher and SDK stdio tests for encrypted persistence, CAS, owner isolation, pre-execution cancellation and restart. Frozen fs contract checks private modes, exclusive flushed temp writes, rename order and finally cleanup under mkdir/write/rename failure; opaque successor writes intentionally report unknown and require reconciliation, including injected persisted-then-thrown outcome. CAS reload refreshes peer data or fails closed on damaged peer document. Actual process crash receipt companion proves unknown mutations are not replayed; no cancellation rollback or general exactly-once claim. Only complete source P0-PROXY-0461 credited; no repeated method/source/class/module/UI credit. No live Electron install/update/rollback, successful SSH, remote host, actual complete pre-migration backup/recovery, performance or final release evidence. UI 1943/1944 remain pending; independent apps/server retirement gate remains failed. Hosted-only restrictions unchanged.';
export const modules = [
  {
    scenarioId: 'P0-PROXY-0461',
    tests: Object.values(names),
    assertion:
      'Complete exact frozen source inventory and executed responsibility matrix: absent/default/damaged loads, read redaction, revision conflicts, input validation and byte/control boundaries, keep/replace/clear, crypto unavailable/encrypt/decrypt failures, endpoint-bound snapshots, atomic temp file ordering/cleanup and state retention. Paired production successor checks same input families plus document CAS refresh/damaged reload and unknown pre/post-write outcomes. Actual kernels and SDK stdio establish encrypted owner-local persistence, cancellation before mutation, single notification per CAS winner, restart preservation and no public snapshot RPC; durable receipt tests cover non-replay after crash. Legacy JSON storage is intentionally replaced by SQLite document port, not asserted to share filesystem lifecycle.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/settings.test.cjs',
  'packages/agent/tests/settings-rpc.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'scripts/agent/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'proxy authentication remains bound to destination and failure never becomes direct access',
  'JSON null is damaged settings, distinct from an absent document',
  'settings RPC persists revisions, encrypts credentials and exposes no credential read capability',
  'mutation receipts survive process restart without storing parameters or operation results',
  'crashed mutations become unknown and an identical request is never executed again',
];
