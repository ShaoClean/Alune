export const batch = 'docs/acceptance/issue-257-258/batch-38-change-classification-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-37-blame-version-20261116/replay-03';
export const testFile = 'packages/agent/tests/p0-change-classification.test.cjs';
export const implementation = [
  'packages/agent/src/modules/git/change-entries.ts',
  'packages/agent/src/modules/git/git-status.ts',
  'packages/agent/src/modules/git/worktrees.ts',
  'packages/agent/src/modules/git/repository-files.ts',
  'packages/agent/src/modules/git/repository-path.ts',
  'packages/agent/src/modules/git/repository-transport.ts',
  'packages/agent/src/modules/git/git-shell.ts',
  'packages/agent/src/modules/git/sftp-file.ts',
  'packages/agent/src/modules/git/lfs.ts',
  'packages/agent/src/adapters/git/native.ts',
  'packages/agent/src/adapters/ssh/connection-manager.ts',
  'packages/agent/src/modules/repositories/reads.ts',
];
export const expectedChanges = [];
export const blockedScenarios = [];
export const names = {
  reasons:
    'P0 change classification special reasons preserve exact directory submodule and ordinary record semantics',
  matrix:
    'P0 change classification candidates types missing files aliases and literal paths match frozen baseline',
  errors:
    'P0 change classification errors malformed lists path validation and partial mutation never retry',
  cancel:
    'P0 change classification cancellation preserves cooperative Git and uncancellable SFTP boundaries',
  native:
    'P0 change classification frozen and current native classify actual dirty repositories linked aliases and submodules without writes',
  ssh: 'P0 change classification frozen and current SSH classify actual dirty repositories linked aliases and submodules without writes',
  sdk: 'P0 change classification actual SDK status enforces owning resource typed query cancellation and helper isolation',
};
export const limitations =
  'Local darwin-arm64 scoped working-tree acceptance only, releaseEligible=false. Exactly original specialChangeReason and classifyChanges credited, not source/class/other exports. Nine full frozen modules execute from verified original Git objects with current domain runtime dependency if used. Real native and encrypted loopback SSH SFTP/Git dirty repository classification covers nested repository, alias/detached linked worktree, missing sibling, gitlink submodule and directory replacement; no external host/other OS claim. Windows string fixture only. Direct helper has progressive in-memory mutation and SFTP APIs without AbortSignal: empty and late non-directory paths may succeed after cancellation, root realpath precedes candidate signal check, connection signal reaches Git rather than every stat. Cooperative Git/alias cancellation, no rollback claim. SDK status enforces owning resource typed query and pre-abort; no helper RPC. Companion write/journal safety is separate regression, not crash injection in read helper. Historical apps/server/.DS_Store missing and original verifier failure retained; new current-state baseline does not repair historical full preservation. Independent retirement gate still fails on packages/shared. Full P0/current Mac install/upgrade/native update/rollback/actual full migration backup/recovery/applicable SSH/performance/final release remain independent. Diagnostics 1943/1944 remain unselected pending actual client. No reset/clean/commit/project push/merge/publication/issue closure/hosted-only bypass. Stop after batch.';
export const modules = [
  {
    scenarioId: 'P0-CHANGES-2436',
    tests: [
      'P0 change classification special reasons preserve exact directory submodule and ordinary record semantics',
      'P0 change classification frozen and current native classify actual dirty repositories linked aliases and submodules without writes',
      'P0 change classification frozen and current SSH classify actual dirty repositories linked aliases and submodules without writes',
    ],
    assertion:
      'Frozen/current specialChangeReason produces exact directory/submodule messages and ordinary undefined output, directory precedence, mode-field positions, untracked bypass and immutable parsed input. Real native/SSH original porcelain records include gitlink and linked/nested directories; no independent input validator or helper RPC.',
  },
  {
    scenarioId: 'P0-CHANGES-2437',
    tests: [
      'P0 change classification candidates types missing files aliases and literal paths match frozen baseline',
      'P0 change classification errors malformed lists path validation and partial mutation never retry',
      'P0 change classification cancellation preserves cooperative Git and uncancellable SFTP boundaries',
      'P0 change classification frozen and current native classify actual dirty repositories linked aliases and submodules without writes',
      'P0 change classification frozen and current SSH classify actual dirty repositories linked aliases and submodules without writes',
      'P0 change classification actual SDK status enforces owning resource typed query cancellation and helper isolation',
    ],
    assertion:
      'Frozen/current classifyChanges filters exact candidates, mutates original records in order, handles plain directories/repositories/gitlinks/symlinks/deleted replacements/missing paths, canonical aliases with missing/prunable/bare siblings, case-normalized Windows string paths. Exact worktree argv, malformed-list/transport/stat/path errors, no retry, progressive in-memory mutation and cancellation boundaries. Real native and encrypted loopback SSH classifications match independent filesystem/Git facts without byte changes. SDK status enforces ownership typed query and helper isolation.',
  },
];
export const testFiles = [
  'packages/agent/tests/p0-change-classification.test.cjs',
  'packages/agent/tests/git-change-entries.test.cjs',
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
