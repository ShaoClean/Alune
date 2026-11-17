export const batch = "docs/acceptance/issue-257-258/batch-40-preview-guards-20261116";
export const prior = "docs/acceptance/issue-257-258/batch-39-commit-files-20261116/replay-02";
export const testFile = "packages/agent/tests/p0-preview-guards.test.cjs";
export const implementation = [
  "packages/agent/src/modules/git/git-commands.ts",
  "packages/agent/src/modules/git/repository-path.ts",
  "packages/agent/src/modules/git/repository-transport.ts",
  "packages/agent/src/adapters/git/native.ts",
  "packages/agent/src/adapters/ssh/connection-manager.ts",
  "packages/agent/src/modules/repositories/reads.ts",
  "packages/protocol/src/repositories.ts",
  "packages/agent-client/src/client.ts"
];
export const expectedChanges = [];
export const blockedScenarios = [];
export const names = {
  "paths": "P0 preview guards frozen and current path validation rejects forbidden segments before any transport",
  "files": "P0 preview guards frozen and current file checks enforce lstat type size read-only handle and exact error semantics",
  "native": "P0 preview guards frozen and current native reject oversize directories missing unreadable files and read literal untracked diff without writes",
  "ssh": "P0 preview guards frozen and current SSH reject oversize directories missing unreadable files and read literal untracked diff without writes",
  "cancel": "P0 preview guards native cancellation rejects before file access and preserves abort reason",
  "sdk": "P0 preview guards actual SDK enforces repository ownership path rejection typed diff cancellation and no helper RPC"
};
export const limitations = "Local darwin-arm64 scoped working-tree acceptance; releaseEligible=false. Exactly original _checkPreviewFile and _validateFilePath only; no source/class/whole diff re-credit. Twelve whole frozen modules verified against Git objects execute. Unused legacy connection-manager maps CommandOutputLimitError to current port; type imports erased and shared runtime maps current domain. _validateFilePath accepts strings and checks POSIX segments only; Windows extra restriction is in diff, not a standalone authorization or symlink containment claim. _checkPreviewFile assumes caller path validation; uses realpath/lstat/read-only open-close, accepts symlink itself without target reads, exact 1 MiB boundary; no download, retries, TOCTOU atomicity or close-error recovery guarantee. Callback fixtures cover every stage numeric/SFTP and Node missing/permission error mapping plus unknown identity. Actual native/encrypted loopback SSH/SFTP exercise helper and untracked diff against literal Unicode/tab/newline/quote/backslash/shell-looking paths and denied files. Snapshots cover repository/Git bytes, modes and links plus outside target; unreadable fixture contents checked independently after interval, no in-interval byte hash claim. No external host/other OS pass. Native preabort reason and SDK preabort tested; helpers have no signal argument, transport controls cancellation, no unconditional remote interruption. SDK resource ownership and strict typed params enforced, no helper RPC. Companion write/journal crash tests are safety regression, not read-helper crash injection or write rollback claim. Historical apps/server/.DS_Store missing/failure retained; fullPreservationVerified=false. Retirement packages/shared gate still fails; full P0, current Mac installation/upgrade/native update/rollback, actual full migration backup/recovery, applicable SSH/performance/final release remain independent. Diagnostics 1943/1944 require actual client. No reset/clean/project commit/push/merge/publication/issue closure/hosted-only bypass. Stop after batch.";
export const modules = [
  {
    "scenarioId": "P0-CHANGES-2531",
    "tests": [
      "P0 preview guards frozen and current file checks enforce lstat type size read-only handle and exact error semantics",
      "P0 preview guards frozen and current native reject oversize directories missing unreadable files and read literal untracked diff without writes",
      "P0 preview guards frozen and current SSH reject oversize directories missing unreadable files and read literal untracked diff without writes",
      "P0 preview guards native cancellation rejects before file access and preserves abort reason",
      "P0 preview guards actual SDK enforces repository ownership path rejection typed diff cancellation and no helper RPC"
    ],
    "assertion": "Frozen/current whole-module helper enforces realpath then lstat; link never follows target; regular files at exactly 1 MiB accepted, larger/non-file rejected before open; r-only open and matching handle close once; exact missing/permission mapping at each stage and unknown errors preserved. Actual native/SSH helper and untracked public diff, permission/size errors, link text, SDK ownership, preabort and no helper RPC. No standalone path authorization/TOCTOU claim."
  },
  {
    "scenarioId": "P0-CHANGES-2532",
    "tests": [
      "P0 preview guards frozen and current path validation rejects forbidden segments before any transport",
      "P0 preview guards frozen and current native reject oversize directories missing unreadable files and read literal untracked diff without writes",
      "P0 preview guards frozen and current SSH reject oversize directories missing unreadable files and read literal untracked diff without writes",
      "P0 preview guards native cancellation rejects before file access and preserves abort reason",
      "P0 preview guards actual SDK enforces repository ownership path rejection typed diff cancellation and no helper RPC"
    ],
    "assertion": "Frozen/current string path validator rejects empty/absolute/NUL/empty-dot-dotdot-case-insensitive .git components before Git/SFTP dispatch; permits literal Unicode/tab/newline/quotes/backslash/shell appearance on POSIX. Extra Windows diff restriction tested with scripted inputs only, not Windows execution. Real native/SSH untracked diff and current SDK preserve literal paths, resource ownership and typed rejection; no new public helper RPC."
  }
];
export const testFiles = [
  "packages/agent/tests/p0-preview-guards.test.cjs",
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
