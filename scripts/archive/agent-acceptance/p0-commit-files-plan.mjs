export const batch = 'docs/acceptance/issue-257-258/batch-39-commit-files-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-38-change-classification-20261116/replay-02';
export const testFile = 'packages/agent/tests/p0-commit-files.test.cjs';
export const implementation = [
  "packages/agent/src/modules/git/git-commands.ts",
  "packages/agent/src/modules/git/repository-transport.ts",
  "packages/agent/src/modules/git/git-shell.ts",
  "packages/agent/src/modules/git/repository-path.ts",
  "packages/agent/src/adapters/git/native.ts",
  "packages/agent/src/adapters/ssh/connection-manager.ts",
  "packages/agent/src/modules/repositories/reads.ts",
  "packages/protocol/src/repositories.ts",
  "packages/agent-client/src/client.ts"
];
export const expectedChanges = [];
export const blockedScenarios = [];
export const names = {
  "names": "P0 commit files name-status parser preserves NUL paths rename copy fallback and truncation semantics",
  "stats": "P0 commit files numstat parser preserves numeric binary rename and malformed row semantics",
  "commands": "P0 commit files command orchestration validates refs exact argv errors no retries and connection cancellation",
  "native": "P0 commit files frozen and current native read real commits parent ranges binary and literal paths without writes",
  "ssh": "P0 commit files frozen and current SSH read real commits parent ranges binary and literal paths without writes",
  "sdk": "P0 commit files actual SDK enforces owning resource typed query cancellation and helper isolation"
};
export const limitations = "Local darwin-arm64 scoped working-tree acceptance; releaseEligible=false. Exactly original GitCommands.commitFiles, _parseCommitNameStatus and _parseCommitNumstat methods credited; no source/class/other helpers. Twelve whole frozen modules verified against Git objects execute; unused legacy connection-manager import maps only CommandOutputLimitError to current port, not a frozen SSH manager claim. Type imports erased; shared runtime maps current domain. Exact NUL parser matrices include existing permissive malformed-input fallbacks; parsers are not public validation. Real native and encrypted local-loopback SSH read root/empty/ordinary commits and explicit parent ranges with actual rename/binary/Unicode/tab/newline/shell-looking paths; snapshot repository/Git file bytes and symlink targets unchanged. No external-host or other-platform pass. commitFiles has no explicit AbortSignal parameter: connection signal governs dispatch, preabort and between-command cancellation; a final transport completion may return despite late cancellation. SDK rejects preaborted requests, foreign resource and extra argv/path/helper RPC. No unconditional cancellation, atomic multi-command snapshot or write rollback claim. Companion journal/write tests are safety regression, not crash injection in read helper. Historical apps/server/.DS_Store missing and original failure retained; fullPreservationVerified=false. Independent retirement gate packages/shared still fails. Full P0/current Mac install/upgrade/native update/rollback/actual full migration backup/recovery/applicable SSH/performance/final release remain independent; diagnostics 1943/1944 require actual client. No reset/clean/project commit/push/merge/publication/issue closure/hosted-only bypass; stop after batch.";
export const modules = [
  {
    "scenarioId": "P0-CHANGES-2537",
    "tests": [
      "P0 commit files command orchestration validates refs exact argv errors no retries and connection cancellation",
      "P0 commit files frozen and current native read real commits parent ranges binary and literal paths without writes",
      "P0 commit files frozen and current SSH read real commits parent ranges binary and literal paths without writes",
      "P0 commit files actual SDK enforces owning resource typed query cancellation and helper isolation"
    ],
    "assertion": "Whole frozen/current commitFiles validates refs before dispatch, exact show/diff argv and parent ordering, empty fast path, name-status/numstat errors and transport error identity, no normal retries, connection cancellation boundaries. Real native/SSH root, ordinary, empty and range results match independent path/status/stat facts; SDK ownership and typed-query rejection; repository bytes unchanged. No atomic snapshot or explicit signal parameter claim."
  },
  {
    "scenarioId": "P0-CHANGES-2542",
    "tests": [
      "P0 commit files name-status parser preserves NUL paths rename copy fallback and truncation semantics",
      "P0 commit files frozen and current native read real commits parent ranges binary and literal paths without writes",
      "P0 commit files frozen and current SSH read real commits parent ranges binary and literal paths without writes",
      "P0 commit files actual SDK enforces owning resource typed query cancellation and helper isolation"
    ],
    "assertion": "Frozen/current NUL name-status parser preserves A/M/D/R/C, similarity suffix, unknown fallback, empty tokens, truncated ordinary/rename paths and literal Unicode/tab/newline/quotes/backslash/shell-looking paths. Real Git and SDK outputs include rename oldPath and status; malformed tolerance is internal contract, not public validator."
  },
  {
    "scenarioId": "P0-CHANGES-2543",
    "tests": [
      "P0 commit files numstat parser preserves numeric binary rename and malformed row semantics",
      "P0 commit files frozen and current native read real commits parent ranges binary and literal paths without writes",
      "P0 commit files frozen and current SSH read real commits parent ranges binary and literal paths without writes",
      "P0 commit files actual SDK enforces owning resource typed query cancellation and helper isolation"
    ],
    "assertion": "Frozen/current numstat preserves decimal numbers and undefined binary/non-digit counts, zero and leading zeros, first two tab separators, rename/copy path-token consumption and malformed/truncated-row behavior. Real native/SSH/SDK results assert exact additions/deletions per path and undefined binary counts; no separate file joining by name is claimed."
  }
];
export const testFiles = [
  "packages/agent/tests/p0-commit-files.test.cjs",
  "packages/agent/tests/git-change-entries.test.cjs",
  "packages/agent/tests/repository-writes.test.cjs",
  "packages/agent/tests/task-journal.test.cjs",
  "scripts/archive/agent-acceptance/p0-test-receipts.test.mjs"
];
export const requiredCompanionNames = [
  'Agent drives refs, stash, remote pushes, linked worktree catalog and conflict recovery with real Git',
  'Agent checks file bytes, index and shared refs and never replays a committed operation after restart',
  'crashed mutations become unknown and an identical request is never executed again',
  'disconnect during a real commit hook leaves a queryable unknown receipt and cannot replay',
  'failed durable finalization is immediately reported as unknown instead of stale running state',
];
