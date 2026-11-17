export const batch = 'docs/acceptance/issue-257-258/batch-36-blame-execution-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-35-git-ref-lists-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-blame-execution.test.cjs';
export const implementation = [
  'packages/agent/src/modules/git/git-blame.ts',
  'packages/agent/src/modules/git/repository-files.ts',
  'packages/agent/src/modules/git/repository-transport.ts',
  'packages/agent/src/modules/git/git-shell.ts',
  'packages/agent/src/adapters/git/native.ts',
  'packages/agent/src/adapters/ssh/connection-manager.ts',
  'packages/agent/src/modules/repositories/reads.ts',
];
export const expectedChanges = [];
export const blockedScenarios = [];
export const names = {
  settle: 'P0 blame deadline preserves success rejection sync throw and final signal cleanup',
  cancel: 'P0 blame deadline propagates cooperative cancellation and records noncooperative limits',
  timeout:
    'P0 blame deadline uses real production timeout and aborts pending operation with exact error',
  git: 'P0 blame git preserves argv output identity limits exact errors transport cancellation and shell fallback',
  local:
    'P0 blame frozen and current real native commit reads preserve repository and linked worktree bytes',
  ssh: 'P0 blame frozen and current real SSH commit reads preserve repository and linked worktree bytes',
  sdk: 'P0 blame actual SDK stdio enforces ownership query validation cancellation and helper isolation',
};
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped acceptance, releaseEligible=false. Exactly GitBlame.deadline and GitBlame.git only. Full frozen blame/repository-files/transport/shell execute from verified baseline; other repository-files imports fail closed if used. Actual current compiled GitBlame executes. Real 15000ms production timer tested without shortening or substitution. Cancellation relies on operation observing its signal; noncooperative completion is documented, not silently treated as cancelled. Timeout does not roll back side effects. Real native and encrypted loopback SSH commit reads on isolated repositories/worktrees; no external host or other platform claim. Actual SDK stdio blameCommit query exercises both helpers and rejects foreign identity/arbitrary query/helper RPC; commit/read/readVersion or whole source/class not credited. Companion generic task journal crash/commit lost acknowledgement/no replay are not crashes injected inside these read helpers. Independent retirement gate fails while apps/server exists. Complete P0/current Mac install/upgrade/native update/rollback/actual migration backup/recovery/applicable SSH/performance/final release remain independent. Diagnostics 1943/1944 unselected pending actual client. No reset/clean/commit/project remote push/merge/publication/issue closure/hosted-only bypass. Stop after batch.';
export const modules = [
  {
    scenarioId: 'P0-HISTORY-2519',
    tests: [names.settle, names.cancel, names.timeout, names.local, names.ssh, names.sdk],
    assertion:
      'Frozen/current full deadline preserves exact value/error identity, cleans up internal signal after success/failure/synchronous throw, propagates cooperative caller abort without mutating caller, uses real BLAME_TIMEOUT_MS and passes exact timeout error to operation signal. Noncooperative work can complete after caller cancellation; timeout is not rollback. Native/SSH commit reads and SDK owning query exercise real helper with unchanged repository bytes.',
  },
  {
    scenarioId: 'P0-HISTORY-2520',
    tests: [names.git, names.local, names.ssh, names.sdk],
    assertion:
      'Frozen/current git delegates exactly once for show/cat-file/blame, preserves literal argv/signal/result including binary bytes, forwards 8MiB text/256KiB binary cap, raises exact trimmed RepositoryFileError on nonzero exit, preserves transport error identity, refuses dispatch after operation/connection abort, and exercises shell fallback. Real native/SSH commit and cat-file reads preserve main/linked Git/worktree bytes. Actual SDK stdio enforces owning resources and typed queries; no helper RPC.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/git-blame.test.cjs',
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
