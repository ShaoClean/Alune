export const batch = 'docs/acceptance/issue-257-258/batch-42-staged-diff-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-41-staged-revision-20261116/replay-02';
export const testFile = 'packages/agent/tests/p0-staged-diff.test.cjs';
export const implementation = [
  'packages/agent/src/modules/git/staged-changes.ts',
  'packages/agent/src/modules/git/repository-transport.ts',
  'packages/agent/src/adapters/git/native.ts',
  'packages/agent/src/adapters/ssh/connection-manager.ts',
  'packages/agent/src/modules/ai/service.ts',
  'packages/agent/src/modules/repositories/reads.ts',
  'packages/protocol/src/repositories.ts',
  'packages/agent-client/src/client.ts',
];
export const expectedChanges = [];
export const blockedScenarios = [];
export const names = {"matrix": "P0 staged diff frozen and current preserve exact args UTF8 byte limits status and transport errors", "native": "P0 staged diff frozen and current real native match independent patches without writes or filters", "ssh": "P0 staged diff frozen and current real SSH match independent patches without writes or filters", "cancel": "P0 staged diff cancellation preserves reasons and current rejects cancelled LFS fallback", "read": "P0 staged diff real read consumer enforces raw patch raw sequence and rejects index races", "ai": "P0 staged diff real staged AI integration returns fingerprints rejects changed index and isolates repositories", "sdk": "P0 staged diff actual SDK isolates owning staged diffs rejects foreign resources and exposes no revision RPC"};
export const limitations = 'Local darwin-arm64 scoped working-tree acceptance, releaseEligible=false. Exactly original private StagedChanges.diff only; complete frozen staged-changes/repository-transport/git-shell modules execute verified Git objects; old CommandOutputLimitError maps to current port class, not full old SSH manager. Exact cached argv/string preservation and UTF8 byte caps tested, shared 96 KiB error text for all configured limits. Scripted unknown-error/status/limit/signal tests and LFS retry. Real native and encrypted loopback SSH compare independent Git patches: empty, literal paths, unstaged exclusion, binary/mode/symlink/rename as delete-add, unborn, real patch overflow; external diff/textconv/color disabled with marker absence. Repository snapshots cover HEAD/refs/index ordinary repo/Git files modes links during measured reads. read raw-patch-raw consistency and AI consumer use real Git; synthetic provider/settings/fetch, intentional index race outside read-only measurement, no external AI network. Typed current SDK isolation/strict params/preabort/no helper RPC; no private diff RPC, no external SSH deployment or remote in-flight kill claim. Frozen transport has cancelled LFS extra dispatch; current rejects before retry via batch31 existing guard; explicit safety difference. Companion durable unknown/no replay regressions not read-helper crash injection. No extra credit for revision/read/assertRevision/AI/SDK or companion tests. Historical apps/server/.DS_Store missing and original failure retained; current baseline separate, fullPreservationVerified=false. Retirement packages/shared fails; full P0/current Mac install/upgrade/native update/rollback/actual migration backup/recovery/applicable SSH/performance/final release remain independent. Diagnostics 1943/1944 need actual client, unselected. No reset/clean/project commit/push/merge/release/issue closure/hosted-only bypass. Stop after batch.';
export const modules = [{
  scenarioId: 'P0-DIFF-2667',
  tests: Object.values(names),
  assertion: 'Execute complete frozen/current private diff helper; exact cached argv/custom arguments and byte limits, empty/string output, 502/413/error identity, composed signals and bounded LFS fallback; real native/encrypted loopback SSH independent patch comparison with repository snapshots/filter suppression; actual read/AI consumers and owning typed SDK integration; preabort and controlled in-flight cancellation including explicit safer current LFS cancellation difference.',
}];
export const testFiles = [
  testFile,
  'packages/agent/tests/p0-ai-service-migration.test.cjs',
  'packages/agent/tests/repository-writes.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'scripts/archive/agent-acceptance/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'Agent drives refs, stash, remote pushes, linked worktree catalog and conflict recovery with real Git',
  'Agent checks file bytes, index and shared refs and never replays a committed operation after restart',
  'crashed mutations become unknown and an identical request is never executed again',
  'disconnect during a real commit hook leaves a queryable unknown receipt and cannot replay',
  'failed durable finalization is immediately reported as unknown instead of stale running state',
];
