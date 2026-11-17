export const batch = 'docs/acceptance/issue-257-258/batch-31-git-transport-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-30-file-module-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-git-transport.test.cjs';
export const implementation = [
  'packages/agent/src/modules/git/repository-transport.ts',
  'packages/agent/src/modules/git/git-shell.ts',
  'packages/agent/src/ports/process.ts',
  'packages/agent/src/ports/repository-files.ts',
  'packages/agent/src/adapters/git/native.ts',
];
export const expectedChanges = ['packages/agent/src/modules/git/repository-transport.ts'];
export const names = {
  types:
    'P0 Git transport complete frozen source exports and typed ports preserve valid and reject invalid contracts',
  dispatch:
    'P0 Git transport both routes preserve exact args options result errors and stash LFS pathspec policy',
  fallback:
    'P0 Git transport retries only missing LFS read status diff once and never retries writes or thrown failures',
  cancel:
    'P0 Git transport cancellation combines both owners rejects before dispatch and prevents cancelled fallback',
  native:
    'P0 Git transport real native and POSIX fallback preserve literal bytes stdin environment callbacks and index',
  missingLfs:
    'P0 Git transport actual missing LFS filters allow read fallback but never retry a failed add',
  sdk: 'P0 Git transport SDK stdio keeps repository owner identity and forbids arbitrary Git execution',
};
export const blockedScenarios = [];
export const limitations =
  'Local dirty darwin-arm64 scoped acceptance, releaseEligible=false. Exact frozen repository-transport and git-shell execute; connection-manager is archived and its exact CommandResult and execCommand/withSftp signatures are extracted for type checking, not claimed whole-class accepted. Original options fields and all required/optional transport members compile; fourteen invalid examples fail against frozen and production declarations. Current optional observe/close/gitDirectory extensions are not old-field equivalence. Recording transport matrix asserts both dispatch routes, arguments/options/result/error identity, combined owner cancellation, stash/LFS flag and one status/diff missing-LFS fallback only. Current helper intentionally strengthens cancellation by checking before fallback dispatch; frozen source late-completion behavior is recorded as different. Actual native Git and POSIX /bin/sh preserve binary bytes/stdin/callbacks/literal environment/index; shell port is an explicit test adapter, no real remote SSH or Windows execution claim. Actual missing-LFS required-filter status/diff fallback and failed add no-retry use only disposable local repositories. The dedicated real SDK/stdio test checks Agent/resource ownership, status/text reads, forbidden arbitrary command RPC, traversal refusal and index/HEAD preservation; real native process cancellation is tested by companion. Journal companion verifies generic unknown/no-replay, not a crash injected into this specific Git command. No new helper RPC, no automatic write retries, no cancellation rollback promise. UI diagnostics 1943/1944 remain unselected. Independent retirement gate fails because apps/server exists; full P0/current Mac installation/upgrade/native update/rollback/actual full migration backup/recovery/applicable SSH/performance/final release gates remain independent. No reset/clean/commit/push/merge/publication/issue closure/hosted-only bypass; stop after batch.';
const runtime = [
  names.dispatch,
  names.fallback,
  names.cancel,
  names.native,
  names.missingLfs,
  names.sdk,
];
export const modules = [
  {
    scenarioId: 'P0-PROTOCOL-2657',
    tests: [names.types, ...runtime],
    assertion:
      'Entire exact frozen repository-transport source, imports, exported two type aliases and sole runGit function execute/compile. Every dispatch/cancellation/fallback branch exercised alongside production successor; real native/POSIX commands and required missing-LFS filters preserve index and never replay failed add. Dependency signature extraction is explicit; no whole SSHConnection equivalence claimed.',
  },
  {
    scenarioId: 'P0-PROTOCOL-2658',
    tests: [names.types, names.dispatch, names.native],
    assertion:
      'Exact original CommandOptions seven optional members compile valid Buffer/text stdin, callbacks, byte bound, UTF8/binary and environment; invalid examples individually rejected against frozen and production declarations. Both routes forward same options object and real commands prove binary/stdin/callback/environment behavior; native limit and invalid-UTF8 errors execute. Internal type shape does not authorize RPC argv.',
  },
  {
    scenarioId: 'P0-PROTOCOL-2659',
    tests: [names.types, ...runtime],
    assertion:
      'Original RepositoryTransport exact Pick SSHConnection execCommand/withSftp plus signal/hasAnyPath/execGit contract compiles and malformed shapes fail. Current structural ports retain fields and add optional lifecycle helpers. Runtime both execution routes, exact combined owner signal, real native execution and Agent-owned resource RPC companions execute; no direct remote SSH equivalence claim.',
  },
  {
    scenarioId: 'P0-PROTOCOL-2660',
    tests: runtime,
    assertion:
      'Exact full frozen and production runGit invoke structured execGit preferentially or shell fallback with exact quoting/options/signal; preserve results/errors/argv, stash/LFS internal wildcard opt-out, only one missing-LFS status/diff retry including -c verb scan, no write/thrown-error retry. Before/after regression proves cancelled late first read no longer dispatches fallback; actual native and POSIX Git plus real missing-filter tests validate read/write boundaries.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/git-local-connection.test.cjs',
  'packages/agent/tests/git-lfs-status.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'scripts/agent/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'cancellation stops a real commit hook and leaves staged data available',
  'crashed mutations become unknown and an identical request is never executed again',
  'failed durable finalization is immediately reported as unknown instead of stale running state',
];
