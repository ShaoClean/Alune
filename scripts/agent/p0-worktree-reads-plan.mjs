export const batch = 'docs/acceptance/issue-257-258/batch-43-worktree-reads-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-42-staged-diff-20261116/replay-02';
export const testFile = 'packages/agent/tests/p0-worktree-reads.test.cjs';
export const implementation = [
  'packages/agent/src/modules/git/worktrees.ts',
  'packages/agent/src/modules/git/repository-transport.ts',
  'packages/agent/src/modules/git/repository-path.ts',
  'packages/agent/src/modules/git/git-shell.ts',
  'packages/agent/src/adapters/git/native.ts',
  'packages/agent/src/adapters/ssh/connection-manager.ts',
  'packages/agent/src/modules/repositories/reads.ts',
  'packages/protocol/src/repositories.ts',
  'packages/agent-client/src/client.ts',
];
export const expectedChanges = [];
export const blockedScenarios = [];
export const names = {
  read: 'P0 worktree reads frozen and current preserve exact argv output limits errors and signals',
  root: 'P0 worktree root frozen and current resolve bare nonbare literal and drive paths and errors',
  cancel: 'P0 worktree read and root cancel before dispatch after reads and during canonicalization',
  native: 'P0 worktree helpers frozen and current real native match independent Git roots without writes',
  ssh: 'P0 worktree helpers frozen and current real SSH match independent Git roots without writes',
  sdk: 'P0 worktree helpers current SDK isolates catalogs rejects foreign resources and exposes no helper RPC',
};
export const limitations = 'Local current darwin-arm64 working-tree scoped acceptance, releaseEligible=false. Exactly original private GitWorktrees.read/root only; full frozen worktrees/repository-path/repository-transport/git-shell modules execute verified Git objects, type-only shared import erased, current built modules execute. Scripted exact argv/output/strictUtf8/1MiB limits/error identity/realpath errors/Windows spelling and controlled cancellation; private args are trusted internal inputs. Real native and encrypted loopback SSH cover main linked detached bare unborn aliases subdirectories literal newline paths, independent Git roots/raw catalogs and whole temporary-root byte/mode/link snapshots, actual 1MiB byte boundary and malformed UTF8. Windows spelling is synthetic, no Windows or external SSH deployment claim. Caller cancellation is pre/post and controlled transport/SFTP, real preabort only; no claim of remote in-flight process-tree termination. Current owning SDK worktrees query resource isolation/strict params/no helper RPC; durable mutation unknown/no replay covered by separate companions, not helper crash injection. No extra credit for kind/list/resolve/canonicalPath/SDK. Historical apps/server/.DS_Store missing/original failure retained; current baseline separate, fullPreservationVerified=false. Retirement packages/shared still fails. Full P0/current Mac install/upgrade/native update/rollback/actual complete migration backup/recovery/applicable SSH/performance/final release remain independent. Diagnostics 1943/1944 require actual client interaction and remain unselected. No reset/clean/project commit/push/merge/release/issue closure/hosted-only bypass. Stop after batch.';
export const modules = [
  {scenarioId:'P0-WORKTREES-2692',tests:[names.read,names.cancel,names.native,names.ssh,names.sdk],assertion:'Execute original complete frozen and built current private read method: exact path/argv/options/signal/output and failure mapping; 1MiB UTF8 boundary and invalid encoding on real native/SSH; caller/connection abort and typed owning SDK worktree consumers, no read RPC.'},
  {scenarioId:'P0-WORKTREES-2694',tests:[names.root,names.cancel,names.native,names.ssh,names.sdk],assertion:'Execute complete frozen and built current private root method: exact bare/nonbare command sequence, preserve literal path whitespace/newlines and strip exactly one line ending, SFTP canonical errors and synthetic drive spelling, failures/cancellation short circuit, independent real native/SSH roots and list/resolve consumers/typed SDK isolation.'},
];
export const testFiles = [testFile,'packages/agent/tests/repository-writes.test.cjs','packages/agent/tests/task-journal.test.cjs','scripts/agent/p0-test-receipts.test.mjs'];
export const requiredCompanionNames = [
  'Agent drives refs, stash, remote pushes, linked worktree catalog and conflict recovery with real Git',
  'Agent checks file bytes, index and shared refs and never replays a committed operation after restart',
  'crashed mutations become unknown and an identical request is never executed again',
  'disconnect during a real commit hook leaves a queryable unknown receipt and cannot replay',
  'failed durable finalization is immediately reported as unknown instead of stale running state',
];
