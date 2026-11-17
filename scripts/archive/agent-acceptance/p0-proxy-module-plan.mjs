export const batch = 'docs/acceptance/issue-257-258/batch-26-proxy-module-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-25-proxy-runtime-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-proxy-module.test.cjs';
export const implementation = [
  'packages/agent/src/bootstrap/settings-kernel.ts',
  'packages/agent/src/bootstrap/state-kernel.ts',
  'packages/agent/src/modules/settings/proxy.ts',
  'packages/agent/src/adapters/secrets/protected.ts',
  'packages/agent/src/adapters/network/runtime.ts',
  'packages/agent/src/server/session.ts',
];
export const names = {
  registration:
    'P0 proxy module full frozen registration binds secret token paths exports and constructor failures',
  ownership:
    'P0 proxy module successor isolates explicit directories cipher ownership and concurrent revisions',
  missing:
    'P0 proxy module missing bound secret fails closed without regeneration and permits explicit clear',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped migrated-responsibility acceptance only; releaseEligible=false. Entire exact frozen proxy.module.ts executes with recorded Nest decorators, explicit service/settings constructor doubles, synthetic env and synthetic homedir; validates whole module shape, token binding, lazy fresh descriptors, directory defaults/override and constructor error propagation. No Nest container, legacy global lifetime, actual home or legacy JSON store execution claim. Successor intentionally uses explicit owner-local directory/SQLite document and lazy fixed protected-secret backend rather than global DI/file path; actual kernels and SDK/stdio establish encrypted persistence, CAS, pre-execution cancellation, isolation, owner shutdown/restart and missing-key rejection without regeneration. Backend caller options mutation cannot select Keychain. Invalid authentication actual loopback test never reaches direct destination; successful HTTP direct path explicitly requires disabled policy. Durable receipts separately prove unknown writes are not replayed; ports/results are not durable receipts and cancellation does not imply rollback. Only original module IDs 0479/0480/0481 credited, no controller/settings-source/UI credit. No live Nest, Electron install/upgrade/update/rollback, successful SSH, remote host, actual full migration backup/recovery, performance or final release claim. Existing client UI 1943/1944 and independent apps/server retirement failure remain pending. Hosted-only restrictions unchanged.';
export const modules = [
  {
    scenarioId: 'P0-PROXY-0479',
    tests: Object.values(names),
    assertion:
      'Complete frozen source: all seven imports, sole decorated class and sole static register; exact provider/export contract, settings factory path/default/secret injection, lazy registration and constructor failures. Current explicit owner-local assembly is tested with actual SQLite/cipher and SDK process runtime; Nest/global/legacy JSON semantics retired, not claimed equivalent.',
  },
  {
    scenarioId: 'P0-PROXY-0480',
    tests: Object.values(names),
    assertion:
      'Complete ProxyModule class shape, global/module decorator metadata, sole static register and fresh provider descriptors with exact service export verified from entire frozen class. Actual successor kernels demonstrate no cross-owner settings or cipher initialization, preserved revision/encryption after close/reopen, closed owner rejection and peer continuity; process scoped bridge closes with owning Agent.',
  },
  {
    scenarioId: 'P0-PROXY-0481',
    tests: Object.values(names),
    assertion:
      'Execute full register repeatedly: module/service identities, only settings provider, exact SECRET_STORAGE injection, default and env path cases, no eager constructor and fresh factory outputs; exact injected secret identity and thrown constructor error preserved. Successor migration explicitly replaces global env lookup with supplied owner directory/SQLite and fixed lazy secret backend, validated under cancellation/CAS/missing-key failures and restart without automatic direct fallback or secret regeneration.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/network-runtime.test.cjs',
  'packages/agent/tests/settings.test.cjs',
  'packages/agent/tests/settings-rpc.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'scripts/archive/agent-acceptance/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'explicit fetch and updater bridge fail closed when proxy authentication fails',
  'Agent updater port is scoped to its host and closes with the owning process',
  'proxy authentication remains bound to destination and failure never becomes direct access',
  'settings RPC persists revisions, encrypts credentials and exposes no credential read capability',
  'mutation receipts survive process restart without storing parameters or operation results',
  'crashed mutations become unknown and an identical request is never executed again',
];
