export const batch = 'docs/acceptance/issue-257-258/batch-25-proxy-runtime-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-24-nest-logger-20261116/replay-02';
export const testFile = 'packages/agent/tests/p0-proxy-runtime.test.cjs';
export const implementation = [
  'packages/agent/src/adapters/network/runtime.ts',
  'packages/agent/src/adapters/network/proxy-transport.ts',
  'packages/agent/src/modules/settings/proxy.ts',
  'packages/agent/src/bootstrap/settings-kernel.ts',
  'packages/agent/src/bootstrap/state-kernel.ts',
  'packages/agent/src/server/session.ts',
];
export const names = {
  source:
    'P0 proxy service entire frozen source class and fetch preserve revision dispatch and retired cleanup',
  failures:
    'P0 proxy fetch snapshot factory and request failures never retry or select implicit direct fallback',
  bridge:
    'P0 updater bridge coalesces creation retries failures and returns only live public revision metadata',
  lifecycle:
    'P0 proxy destruction contains failed bridge creation and closes pending creation with explicit successor lifecycle policy',
  real: 'P0 proxy real frozen and current transports retain inflight requests switch revisions and fail closed through stable bridge',
  owners:
    'P0 proxy current kernel bridge ownership cancellation and durable settings remain isolated across restart',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree migrated-responsibility acceptance only; releaseEligible=false. Exact full frozen proxy.service.ts and proxy-transport.ts execute against explicit decorator/settings ports and actual disposable loopback HTTP CONNECT servers, including successful revision switching, inflight preservation, bad authentication and corrupt settings without direct fallback. Controlled dependency doubles expose dispatcher graceful/forced cleanup, bridge coalescing/bind rejection and pending-close race; current runtime is also executed from exact source for those branches and from production dist for real transport. Nest decorator/container runtime is retired, not restored. Current close deliberately differs: idempotent, refuses new work, rejects bridge creation finishing during close and still destroys dispatchers after bind rejection; frozen onModuleDestroy can reject before cleanup. Actual kernel owners use isolated SQLite/file-secret backend, carry agent-loopback metadata and keep settings revisions over restart; direct handler cancellation is checked only before save. Same-run SDK/stdio updater test establishes process ownership/EOF and task-journal tests separately establish durable receipts and no replay of unknown writes. Bridge handles/ports and log or external network results are not durable receipts, and cancellation does not imply rollback. No actual Electron updater/install/upgrade/rollback, Nest container, React/DOM, successful SSH, remote network host, full migration backup/recovery or performance claim. Only exact original IDs 0482..0485 credited. Client UI 1943/1944, apps/server retirement failure and complete current Mac release gates remain independent. Hosted-only requirements unchanged.';
export const modules = [
  {
    scenarioId: 'P0-PROXY-0482',
    tests: Object.values(names),
    assertion:
      'Whole frozen source includes all three imports, fields, constructor, fetch arrow, bridge and destroy methods. Execute complete class dispatch/cache/failure/retirement/bridge/teardown responsibilities with exact frozen transport, and current production runtime/kernel/stdio equivalents. Framework DI decorator is explicit spy; Nest framework runtime retired. Source-wide scoped migrated responsibility, not live Nest compatibility.',
  },
  {
    scenarioId: 'P0-PROXY-0483',
    tests: Object.values(names),
    assertion:
      'Complete frozen ProxyService class constructor owns exact settings and full prototype/own fetch property, revision dispatcher caching, pending retired dispatcher draining, public bridge metadata and failures. Current owner-local ProxyRuntime replaces service with explicit closed/idempotent lifecycle improvements; complete actual loopback and kernel owner/restart behavior checked.',
  },
  {
    scenarioId: 'P0-PROXY-0484',
    tests: [names.bridge, names.lifecycle, names.real, names.owners],
    assertion:
      'Bridge creation is coalesced, bind rejection resets cached promise for explicit next call, each public response reads current revision/enabled and only port/revision/enabled, read failure rejects without creating duplicate listener. Exact snapshot supplier used for per-request routing; actual stable credential-free loopback port uses saved revisions/auth fail-closed policy and is owner-scoped. Current post-close bridge completion explicitly rejects; not an Electron native update or cross-host port claim.',
  },
  {
    scenarioId: 'P0-PROXY-0485',
    tests: [names.source, names.lifecycle, names.real, names.owners],
    assertion:
      'Frozen destroy awaits bridge and closes it, then destroys current plus pending retired dispatchers; contains graceful close errors. Pending bind failure legacy rejection-before-cleanup is documented, successor instead drains and closes idempotently, rejects future work and in-flight bridge completion. Actual loopback ports and SDK process ports close with their owner while other owner remains usable; no rollback/automatic retry/exactly-once network claim.',
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
