export const batch = 'docs/acceptance/issue-257-258/batch-33-workspace-file-helpers-20261116';
export const prior =
  'docs/acceptance/issue-257-258/batch-32-repository-file-helpers-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-workspace-file-helpers.test.cjs';
export const implementation = [
  'packages/agent/src/modules/git/workspace-file-actions.ts',
  'packages/agent/src/modules/git/repository-files.ts',
  'packages/agent/src/modules/git/repository-path.ts',
  'packages/agent/src/modules/git/repository-transport.ts',
  'packages/agent/src/modules/git/sftp-file.ts',
  'packages/agent/src/adapters/git/native.ts',
  'packages/agent/src/adapters/ssh/connection-manager.ts',
  'packages/agent/src/modules/repositories/reads.ts',
];
export const expectedChanges = [];
export const blockedScenarios = [];
export const names = {
  git: 'P0 workspace helpers git preserves exact argv timeout stdout errors and predispatch cancellation',
  parent:
    'P0 workspace helpers parent validates canonical ancestors nested metadata and error identity',
  inspect:
    'P0 workspace helpers inspect preserves exact index staged bytes attributes token and refusals',
  guard:
    'P0 workspace helpers guard preserves completion identity maps all failures and never retries',
  local:
    'P0 workspace helpers frozen and current real native previews preserve index bytes and canonical boundaries',
  ssh: 'P0 workspace helpers frozen and current real SSH previews preserve index bytes and canonical boundaries',
  sdk: 'P0 workspace helpers actual SDK stdio enforces preview ownership resource paths and preserves index',
};
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped acceptance; releaseEligible=false. Four exact WorkspaceFileActions git/parent/inspect/guard entries only, no source/class/mutate credit. Full frozen workspace-file-actions and dependencies execute; unused LFS throws, runtime shared constants use current domain. Recording ports assert timeout=15000, argv, tokens, errors, cancellation and path ordering; Windows/UNC are string rules only. Current intentionally rejects metadata aliases and preserves typed StaleWorkspaceFilePreview, unlike baseline. Real native and loopback SSH/SFTP use isolated local temporary repositories, no arbitrary remote deployment claim. Actual SDK/stdio previews are bound to registered owning Agent/resource; no new helper or mutation RPC added. Existing native/SSH mutations and lost acknowledgements are companion tests, generic task-journal unknown/no-replay is not a crash inside these helpers and implies no rollback. No UI interaction claim. Retirement gate fails while apps/server exists; full P0/current Mac install/upgrade/native update/rollback/actual full migration backup/recovery/applicable SSH/performance/final release remain independent. Diagnostics 1943/1944 unselected awaiting actual client. No reset/clean/commit/push/merge/publication/issue closure or hosted-only bypass; stop after batch.';
export const modules = [
  {
    scenarioId: 'P0-FILES-2681',
    tests: [names.git, names.local, names.ssh, names.sdk],
    assertion:
      'Execute frozen and production git helper with exact receiver/root/literal argv, 15000ms signal, raw stdout, trimmed stderr/fallback error and rejection identity; aborted connection dispatches zero commands. Real native and SSH preview commands plus SDK owning resource run without changing Git index.',
  },
  {
    scenarioId: 'P0-FILES-2682',
    tests: [names.parent, names.local, names.ssh, names.sdk],
    assertion:
      'Execute frozen and production parent with root alias canonicalization and every ancestor lstat, .git nested guard, final realpath and exact target; refuse traversal/metadata/symlink/non-directory/nested worktree/submodule and changed parent; missing-code/error identity and Windows case comparison. Current metadata alias restrictions explicitly differ. Real native/SSH and SDK execute canonical path boundaries.',
  },
  {
    scenarioId: 'P0-FILES-2683',
    tests: [names.inspect, names.local, names.ssh, names.sdk],
    assertion:
      'Execute frozen and production inspect exact rev-parse/index/diff argv, prefix and gitlink refusal, missing/directory/link/file cases; staged NUL output, SHA256 token bound to root/path/index/staged/attrs/content, sequential read/close, same-attrs changed bytes, read-time attribute race, abort and errors. Real native/SSH and SDK preview preserve index and HEAD.',
  },
  {
    scenarioId: 'P0-FILES-2684',
    tests: [names.guard, names.local, names.ssh, names.sdk],
    assertion:
      'Execute frozen and production guard with awaited completion and exact success/error identity, missing 2/ENOENT, permission 3/EACCES/EPERM, unknown code, empty Error and non-Error/null errors; exact 502 Chinese warning and one invocation. Current StaleWorkspaceFilePreview identity intentional; actual SDK/stdio and local/SSH public previews enforce refusals, companion mutation lost acknowledgements retain index and never claim rollback.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/git-workspace-file-actions.test.cjs',
  'packages/agent/tests/git-local-connection.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'scripts/archive/agent-acceptance/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'rejects stale confirmations, overwrite, unsafe boundaries and invalid names',
  'rejects files inside uninitialized gitlinks and edits with unchanged size/mtime',
  'does not report success when the connection fails after unlink',
  'reports all possible paths when case-only rename loses its completion acknowledgement',
  'cancellation stops a real commit hook and leaves staged data available',
  'crashed mutations become unknown and an identical request is never executed again',
  'failed durable finalization is immediately reported as unknown instead of stale running state',
];
