export const batch = 'docs/acceptance/issue-257-258/batch-35-git-ref-lists-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-34-git-tag-helpers-20261116/replay-02';
export const testFile = 'packages/agent/tests/p0-git-ref-lists.test.cjs';
export const implementation = [
  'packages/agent/src/modules/git/git-commands.ts',
  'packages/agent/src/modules/git/git-commands-writes.ts',
  'packages/agent/src/modules/git/repository-transport.ts',
  'packages/agent/src/modules/git/git-shell.ts',
  'packages/agent/src/adapters/git/native.ts',
  'packages/agent/src/adapters/ssh/connection-manager.ts',
  'packages/agent/src/modules/repositories/reads.ts',
];
export const expectedChanges = [];
export const blockedScenarios = [];
export const names = {
  branches: 'P0 ref lists branchList preserves ordered output exact argv errors and cancellation',
  stashes: 'P0 ref lists stashList preserves reflog indices fallback lines errors and cancellation',
  branchParser:
    'P0 ref lists branch parser preserves current remote upstream and symbolic filtering',
  stashParser: 'P0 ref lists stash parser preserves WIP On Unicode colons and literal fallback',
  local:
    'P0 ref lists frozen and current native read real branches stashes worktrees and detached HEAD without side effects',
  ssh: 'P0 ref lists frozen and current SSH read real branches stashes worktrees and detached HEAD without side effects',
  sdk: 'P0 ref lists actual SDK stdio enforces resource ownership query validation cancellation and helper isolation',
};
export const limitations =
  'Local darwin-arm64 dirty working tree scoped acceptance; releaseEligible=false. Exactly GitCommands branchList/stashList/_parseBranchLine/_parseStashLine, no entire class/source/ref mutation credit. Full frozen commands module and real frozen transport/shell execute against byte-verified Git baseline. Unused frozen imports are fail-closed guards; no other command behavior is credited. Native and encrypted loopback SSH use isolated real temporary Git repositories, linked worktrees, detached and unborn states; no external host or other platform execution claimed. Actual SDK stdio reads branches/stashes, checks resource ownership, query validation and pre-aborted cancellation; helpers remain private implementation, no new RPC. Companion write lost-ack and generic task-journal crash unknown/no-replay are not crashes injected inside these read helpers; cancellation is not rollback. Parser tolerances are historical behavior, not a general Git ref validation boundary. Independent retirement gate fails while apps/server exists. Full P0/current Mac installation/upgrade/native update/rollback/actual migration backup/recovery/applicable SSH/performance/final release remain independent. Diagnostics 1943/1944 unselected awaiting actual client. Preserve all prior evidence; no reset/clean/commit/project remote push/merge/publication/issue closure or hosted-only bypass. Stop after batch.';
export const modules = [
  {
    scenarioId: 'P0-REFS-2538',
    tests: [names.branches, names.branchParser, names.local, names.ssh, names.sdk],
    assertion:
      'Frozen/current branchList awaits one exact for-each-ref command, preserves Git order and literal names/upstreams, omits blank and symbolic refs, retains local/remote current flags, returns empty for unborn, propagates exact nonzero/transport/cancel errors without retry. Native/SSH include linked and detached worktrees; SDK owning resource reads the same lists without mutation.',
  },
  {
    scenarioId: 'P0-REFS-2539',
    tests: [names.stashes, names.stashParser, names.local, names.ssh, names.sdk],
    assertion:
      'Frozen/current stashList invokes exact stash list with transport --no-literal-pathspecs, filters only empty lines, preserves parsed reflog index and fallback filtered-line ordinal, literal Unicode/colons, empty results, exact errors and predispatch cancellation without retry. Native/SSH share real stash between worktrees and detached reads; SDK reads without mutation.',
  },
  {
    scenarioId: 'P0-REFS-2544',
    tests: [names.branchParser, names.branches, names.local, names.ssh, names.sdk],
    assertion:
      'Frozen/current whole branch parser maps local and remote names, current marker and upstream prefixes exactly, drops symbolic and unrelated refs; unusual/incomplete inputs retain historical behavior without inventing ref validation. Real native/SSH refs and SDK exercise public owning query, preserve HEAD refs index bytes and worktree content.',
  },
  {
    scenarioId: 'P0-REFS-2545',
    tests: [names.stashParser, names.stashes, names.local, names.ssh, names.sdk],
    assertion:
      'Frozen/current whole stash parser recognizes WIP on and On, parses actual reflog number independent of ordinal, preserves message colons/Unicode and literal fallback for unsupported/empty/malformed lines. Real stash lists and SDK execute inherited parser; no stash writes occur during accepted read snapshots.',
  },
];
export const testFiles = [
  testFile,
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
