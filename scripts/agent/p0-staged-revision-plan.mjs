export const batch = 'docs/acceptance/issue-257-258/batch-41-staged-revision-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-40-preview-guards-20261116/replay-03';
export const testFile = 'packages/agent/tests/p0-staged-revision.test.cjs';
export const implementation = [
  'packages/agent/src/modules/git/staged-changes.ts',
  'packages/agent/src/modules/git/repository-transport.ts',
  'packages/agent/src/adapters/git/native.ts',
  'packages/agent/src/adapters/ssh/connection-manager.ts',
  'packages/agent/src/modules/ai/service.ts',
  'packages/agent/src/modules/repositories/reads.ts',
  'packages/protocol/src/repositories.ts',
  'packages/agent-client/src/client.ts',
];
export const expectedChanges = [];
export const blockedScenarios = [];
export const names = {
  matrix: 'P0 staged revision frozen and current hash exact raw bytes with precise argv limits errors and signal propagation',
  native: 'P0 staged revision frozen and current real native match independent Git fingerprints without repository writes',
  ssh: 'P0 staged revision frozen and current real SSH match independent Git fingerprints without repository writes',
  cancel: 'P0 staged revision frozen and current transport cancellation preserves reason with zero fallback dispatch',
  ai: 'P0 staged revision real staged AI integration returns fingerprints rejects changed index and isolates repositories',
  sdk: 'P0 staged revision actual SDK isolates owning staged diffs rejects foreign resources and exposes no revision RPC',
};
export const limitations = 'Local darwin-arm64 working-tree scoped acceptance; releaseEligible=false. Exactly StagedChanges.revision original method only. Three whole frozen modules execute verified Git objects. Legacy runtime CommandOutputLimitError maps to current port class so instanceof behavior can be compared; not old SSH manager execution. Hashes exact decoded raw UTF-8 cached diff with full object IDs via --no-abbrev; scoped fingerprint is not a full repository snapshot or concurrency lock. 256 KiB raw bound uses existing 96 KiB error text. Scripted exact byte boundary, conflict pattern, error identity and signal forwarding; actual native/encrypted loopback SSH exercise empty/unborn/staged Unicode/newline/binary/mode/link/rename/delete/conflict and excessive raw output. Snapshots cover HEAD/refs/index and ordinary repo/Git bytes/modes/links; fixture preparation occurs before each measured interval. Current AI service integration uses real staged readers but synthetic provider/settings and injected fetch, no external provider claims. SDK typed staged diff ownership/strict params/preabort/no helper RPC is current only. Cancellation preabort on real transports plus controlled in-flight signal rejection, no unconditional remote interruption/rollback guarantee. Companion journal/writes tests cover unknown receipts/no replay separately, no crash injection claimed for read helper. Historical .DS_Store missing and original failure retained, fullPreservationVerified=false. Retirement gate packages/shared remains; complete P0, current Mac installation/upgrade/native update/rollback, actual migration backup/recovery, applicable SSH/performance/final release remain independent. Diagnostics 1943/1944 need actual client. No reset/clean/project commit/push/merge/release/issue closure/hosted-only bypass. Stop after batch.';
export const modules = [{
  scenarioId: 'P0-CHANGES-2668',
  tests: Object.values(names),
  assertion: 'Execute full frozen/current StagedChanges modules; exact cached raw argv and 256 KiB UTF-8 bound; known SHA256 vectors and independent real Git raw digests; empty/conflict/status and output-limit errors, unknown/abort reason identity, signal composition, no read writes; staged-only repository identity and AI consumer integration with documented raw-diff fingerprint boundary, typed SDK ownership and no helper RPC.',
}];
export const testFiles = [
  testFile,
  'packages/agent/tests/p0-ai-service-migration.test.cjs',
  'packages/agent/tests/repository-writes.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'scripts/agent/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'Agent drives refs, stash, remote pushes, linked worktree catalog and conflict recovery with real Git',
  'Agent checks file bytes, index and shared refs and never replays a committed operation after restart',
  'crashed mutations become unknown and an identical request is never executed again',
  'disconnect during a real commit hook leaves a queryable unknown receipt and cannot replay',
  'failed durable finalization is immediately reported as unknown instead of stale running state',
];
