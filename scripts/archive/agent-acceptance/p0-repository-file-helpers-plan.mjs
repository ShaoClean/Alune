export const batch = 'docs/acceptance/issue-257-258/batch-32-repository-file-helpers-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-31-git-transport-20261116/replay-03';
export const testFile = 'packages/agent/tests/p0-repository-file-helpers.test.cjs';
export const implementation = [
  'packages/agent/src/modules/git/repository-files.ts',
  'packages/agent/src/modules/git/repository-path.ts',
  'packages/agent/src/modules/git/sftp-file.ts',
  'packages/agent/src/ports/repository-files.ts',
  'packages/agent/src/adapters/git/native.ts',
  'packages/agent/src/adapters/ssh/connection-manager.ts',
  'packages/agent/src/modules/repositories/reads.ts',
];
export const expectedChanges = [];
export const names = {
  resolve:
    'P0 repository helpers frozen and current resolve preserve exact canonical roots Windows comparison and error identity',
  bytes:
    'P0 repository helpers readCapped returns exact bytes at zero and boundary with bounded sequential reads',
  lifecycle:
    'P0 repository helpers readCapped awaits close on overflow and propagates open read close failures',
  errors:
    'P0 repository helpers sftp preserves operation identity completion and every error mapping without retries',
  ssh: 'P0 repository helpers real loopback SSH canonical symlink refusal capped bytes and permission mapping preserve files',
  sdk: 'P0 repository helpers actual SDK stdio preserves preview ownership paths bytes and index',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped acceptance only, releaseEligible=false. Exactly four original repository file helpers, no whole-class/source/list/read acceptance. Complete frozen repository-files source executes with exact archived shell/path/chunk dependencies; unused LFS/Git operations have explicit throwing recording ports and shared runtime constants use current domain. Both original and current helper methods execute exact root/child paths, POSIX case sensitivity, Windows/UNC comparison via recording ports, byte caps, closure ordering and error identity/mapping. Helpers rely on caller validation; they do not independently authorize arbitrary paths. Real loopback SSH/SFTP uses temporary local files; no remote installation or Windows host claim. Real SDK/stdio repository read validates owning Agent and resource, tree/text/link previews, traversal/.git/absolute/symlink-ancestor refusal, no arbitrary Git RPC and index/HEAD preservation. Native cancellation and generic task-journal unknown/no-replay are companions; no interrupted write is injected into these read helpers, no rollback promise. Independent retirement gate still fails because apps/server exists. Full P0/current Mac installation/upgrade/native update/rollback/actual full migration backup/recovery/applicable SSH/performance/final release remain independent. Diagnostics 1943/1944 await real client interaction and are unselected. No reset/clean/commit/push/merge/publication/issue closure or hosted-only bypass; stop after batch.';
export const modules = [
  {
    scenarioId: 'P0-FILES-2647',
    tests: [names.resolve, names.ssh, names.sdk],
    assertion:
      'Exact frozen and production resolveRepositoryDirectory canonicalize root then child, preserve literal names and requested display errors, reject changed realpath including internal/external symlink ancestors and POSIX case changes, compare Windows/UNC separators/case, preserve raw realpath errors and call count. Actual loopback SFTP plus SDK resource/path policy execute; caller validation boundary explicit.',
  },
  {
    scenarioId: 'P0-FILES-2651',
    tests: [names.resolve, names.ssh, names.sdk],
    assertion:
      'Frozen and production private resolve delegate exact SFTP receiver/repository/relative/requested inputs, output and rejection. Canonical root alias permitted; child symlink ancestors refused. Real SDK preview confines access to owning registered resource, validates paths and preserves HEAD/index. No helper RPC added.',
  },
  {
    scenarioId: 'P0-FILES-2652',
    tests: [names.bytes, names.lifecycle, names.ssh, names.sdk],
    assertion:
      'Frozen and production readCapped preserve exact binary bytes including empty/zero cap and exact limit over multiple 64KiB reads, sequential offsets, EOF and one close; overflow stops after first excess chunk and awaits CLOSE. Open/read/close errors preserve identity; close failure supersedes read failure per existing finally semantics. Actual loopback bytes and production public previews/lifecycle execute.',
  },
  {
    scenarioId: 'P0-FILES-2653',
    tests: [names.errors, names.ssh, names.sdk],
    assertion:
      'Frozen and production private sftp invoke withSftp once with exact operation, await completion and preserve result/RepositoryFileError identity; numeric/string not-found and permission codes map to exact 404/403 Chinese messages, unknown/null/non-Error/empty Error to exact 400. Connection and operation failures both tested; no retry. Actual SFTP permission/missing errors and owner-bound SDK refuse invalid resources.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/git-repository-files.test.cjs',
  'packages/agent/tests/git-repository-files-lifecycle.test.cjs',
  'packages/agent/tests/git-local-connection.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'scripts/archive/agent-acceptance/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'previews wait for the file handle CLOSE reply before ending the SFTP channel',
  'a file growing past the preview limit still closes its handle before returning',
  'disconnecting during a preview rejects it and reconnecting restores browsing',
  'a stalled read times out without a late exception and retry opens a usable channel',
  'cancellation stops a real commit hook and leaves staged data available',
  'crashed mutations become unknown and an identical request is never executed again',
  'failed durable finalization is immediately reported as unknown instead of stale running state',
];
