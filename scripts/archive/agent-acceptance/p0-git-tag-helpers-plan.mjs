export const batch = 'docs/acceptance/issue-257-258/batch-34-git-tag-helpers-20261116';
export const prior =
  'docs/acceptance/issue-257-258/batch-33-workspace-file-helpers-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-git-tag-helpers.test.cjs';
export const implementation = [
  'packages/agent/src/modules/git/git-tags.ts',
  'packages/agent/src/modules/git/git-tags-writes.ts',
  'packages/agent/src/modules/git/git-signing.ts',
  'packages/agent/src/modules/git/git-signing-writes.ts',
  'packages/agent/src/modules/git/repository-transport.ts',
  'packages/agent/src/modules/git/git-shell.ts',
  'packages/agent/src/adapters/git/native.ts',
  'packages/agent/src/adapters/ssh/connection-manager.ts',
  'packages/agent/src/modules/repositories/reads.ts',
  'packages/agent/src/bootstrap/repository-writes.ts',
];
export const expectedChanges = [];
export const blockedScenarios = [];
export const names = {
  checked:
    'P0 tag helpers checked preserves argv output error selection identity and cancellation without retries',
  ref: 'P0 tag helpers ref rejects invalid inputs before IO and preserves exact full literal ref',
  snapshot:
    'P0 tag helpers snapshot requires exact object identity and ordered validation without mutation',
  remote:
    'P0 tag helpers remoteUrl selects exactly one configured push URL and refuses unsafe remotes',
  local:
    'P0 tag helpers frozen and current real native validate stale tags and distinct push URL without side effects',
  ssh: 'P0 tag helpers frozen and current real SSH validate stale tags and distinct push URL without side effects',
  sdk: 'P0 tag helpers actual SDK stdio binds owning resources and refuses stale deletion and duplicate tag writes',
};
export const limitations =
  'Local darwin-arm64 dirty working tree scoped acceptance; releaseEligible=false. Exactly GitTags checked/ref/snapshot/remoteUrl entries, no whole source/class or signing credit. Full frozen Git tags/signing/transport/shell execute against byte-verified Git baseline; current split production reads/writes execute. Recording ports assert literal argv, errors, validation, cancellation and no retries. Actual local native and encrypted loopback SSH/Git fixtures use isolated temporary repositories and local bare remotes, not external deployment or Windows execution. Actual SDK stdio runs create/read/push/delete, stale confirmation, resource ownership, revision and duplicate operation refusal; helper methods are not new public RPCs. Companion task-journal crash unknown/no-replay and repository write lost acknowledgement are not a crash injected in these read helpers, and no rollback is promised. No real user repositories or credentials. Independent retirement gate fails while apps/server exists. Full P0/current Mac install/upgrade/native update/rollback/actual full migration backup/recovery/applicable SSH/performance/final release remain independent. Diagnostics 1943/1944 unselected awaiting actual client. No reset/clean/commit/push to project remote/merge/publication/issue closure or hosted-only bypass. Stop after batch.';
export const modules = [
  {
    scenarioId: 'P0-REFS-2567',
    tests: [names.checked, names.local, names.ssh, names.sdk],
    assertion:
      'Frozen/current checked awaits exact root and argv, preserves raw stdout and selected stderr/stdout/fallback signing error, thrown identity; cancellation prevents dispatch and no retry. Real native/SSH and SDK exercise inherited read/write helper through tags operations.',
  },
  {
    scenarioId: 'P0-REFS-2568',
    tests: [names.ref, names.local, names.ssh, names.sdk],
    assertion:
      'Frozen/current ref rejects non-string/empty/leading-option/NUL before IO; check-ref-format receives exact refs/tags/name with Unicode quotes shell characters, Git invalid names and transport failures; native/SSH and SDK create exercise validation and do not permit arbitrary helper RPC.',
  },
  {
    scenarioId: 'P0-REFS-2569',
    tests: [names.snapshot, names.local, names.ssh, names.sdk],
    assertion:
      'Frozen/current snapshot validates ref then exact show-ref --verify --hash, trims actual hash only, compares expected type and exact bytes; missing/stale objects stop before mutation, errors/cancel propagate. Native/SSH stale delete/checkout preserve refs HEAD/index; SDK fresh revision with stale tag identity refuses deletion and duplicate operation cannot execute twice.',
  },
  {
    scenarioId: 'P0-REFS-2571',
    tests: [names.remote, names.local, names.ssh, names.sdk],
    assertion:
      'Frozen/current remoteUrl rejects malformed remote before IO, reads exact configured names then remote get-url --push --all, selects single push URL without fetch fallback, refuses missing/multiple URLs and stops on errors/cancel. Native/SSH distinct fetch/push bare repositories and SDK read/push verify URL selection and side effects are restricted to isolated fixture.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/git-tags.test.cjs',
  'packages/agent/tests/repository-writes.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'scripts/archive/agent-acceptance/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'changed references, different push URLs, rejection and offline reads preserve local tags',
  'unborn repositories stay empty; non-commit tags stay visible and cannot be checked out',
  'Agent checks file bytes, index and shared refs and never replays a committed operation after restart',
  'crashed mutations become unknown and an identical request is never executed again',
  'disconnect during a real commit hook leaves a queryable unknown receipt and cannot replay',
  'failed durable finalization is immediately reported as unknown instead of stale running state',
];
