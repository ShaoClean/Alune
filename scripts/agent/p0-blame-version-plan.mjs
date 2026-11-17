export const batch = 'docs/acceptance/issue-257-258/batch-37-blame-version-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-36-blame-execution-20261116/replay-02';
export const testFile = 'packages/agent/tests/p0-blame-version.test.cjs';
export const implementation = [
  'packages/agent/src/modules/git/git-blame.ts',
  'packages/agent/src/modules/git/repository-files.ts',
  'packages/agent/src/modules/git/repository-transport.ts',
  'packages/agent/src/modules/git/git-shell.ts',
  'packages/agent/src/modules/git/repository-path.ts',
  'packages/agent/src/modules/git/sftp-file.ts',
  'packages/agent/src/modules/git/lfs.ts',
  'packages/agent/src/adapters/git/native.ts',
  'packages/agent/src/adapters/ssh/connection-manager.ts',
  'packages/agent/src/modules/repositories/reads.ts',
];
export const expectedChanges = [];
export const blockedScenarios = [];
export const names = {
  revision:
    'P0 blame version historical modes byte and line limits encodings and exact argv match frozen baseline',
  working:
    'P0 blame version working previews reject unsupported files and preserve exact unavailable reasons',
  failures:
    'P0 blame version rejects read races malformed porcelain HEAD failures and invalid ignore files',
  cancel:
    'P0 blame version cancellation propagates through Git and documents uncancellable file preview boundary',
  unborn:
    'P0 blame version unborn untracked staged and tracked lines preserve content and version semantics',
  native:
    'P0 blame version frozen and current real native reads match Git and preserve main linked repository bytes',
  ssh: 'P0 blame version frozen and current real SSH reads match Git and preserve main linked repository bytes',
  sdk: 'P0 blame version actual SDK stdio enforces resource ownership typed query and private helper isolation',
};
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped acceptance, releaseEligible=false. Exactly GitBlame.readVersion credited; seven full frozen modules including file/LFS/transport execute from verified original Git objects, with shared domain constants bound to current domain. No re-credit for read/deadline/git or whole class. Real native and encrypted loopback SSH working/historical blame reads on isolated main and linked worktrees; no external host or other platform claim. Exact byte/line limits, UTF-8-only behavior, special paths, ignore-revs flags, uncommitted lines, race and version digest, cooperative Git cancellation. File preview uses an API without AbortSignal and may finish before cancellation is observed; no rollback claim. Actual SDK stdio owner query, foreign identity/path/hash/extra-field rejection, no helper RPC. Companion journal lost-ack/crash safety is not crash injection inside this read helper. Prior apps/server/.DS_Store missing and failed full preservation remain recorded, new batch uses current-state baseline. Independent retirement gate fails on packages/shared. Complete P0/current Mac install/upgrade/native update/rollback/actual migration backup/recovery/applicable SSH/performance/final release remain independent. Diagnostics 1943/1944 unselected pending actual client. No reset/clean/commit/project push/merge/publication/issue closure/hosted-only bypass. Stop after batch.';
export const modules = [
  {
    scenarioId: 'P0-HISTORY-2523',
    tests: Object.values(names),
    assertion:
      'Full frozen/current readVersion executes historical tree/type/size/blob decoding and real working file preview, byte/line/encoding/CR/empty restrictions, exact blame argv with whitespace and ignore-revs controls, unborn/untracked synthesis, tracked HEAD errors, parse/content race rejection, stable SHA256 version inputs and Git cancellation. Real native/SSH reads on main/linked worktrees match independent Git and preserve repository bytes. Actual SDK stdio routes owning resource and rejects foreign identity, malformed queries and private helper RPC; no mutation or automatic replay.',
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
