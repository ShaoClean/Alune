export const batch = 'docs/acceptance/issue-257-258/batch-13-http-logging-20261113';
export const prior = 'docs/acceptance/issue-257-258/batch-12-native-workspace-20261113/replay-02';
export const testFile = 'packages/agent/tests/p0-http-logging.test.cjs';
export const implementation = [
  'packages/agent/src/adapters/logging/http-trace.ts',
  'packages/agent/src/adapters/logging/log-store.ts',
  'packages/agent/src/bootstrap/state-kernel.ts',
  'packages/agent/src/modules/diagnostics/logs.ts',
];
export const names = {
  owner:
    'P0 logger ownership replaces the frozen singleton and reset hook with isolated kernel lifetimes',
  levels:
    'P0 logger four levels filtering and write failures retain redacted disk and live semantics',
  error:
    'P0 errorContext retains error identity fields and non-error coercion before current redaction',
  response:
    'P0 traceHttp preserves response identity HTTP errors URL metadata context and a single send',
  failure: 'P0 traceHttp rethrows failures and cancellations unchanged even when logging fails',
  integration:
    'P0 state kernel actually routes AI HTTP tracing through its owned diagnostics store',
};
export const limitations =
  'Local darwin-arm64 working-tree scoped successor assertions only; releaseEligible=false. Entire original logger.ts executes from verified frozen Git bytes in a restricted VM. Legacy LogStore and process/os dependencies are explicit spies to test lazy singleton/env/default/reset/exit and wrapper failures without touching home or global process listeners. Current production has no singleton/reset hook: two real SQLite/file-backed state kernels prove private ownership, close flushing, independent lifetimes and reopen, replacing global store mutation rather than restoring it. Current LogStore provides four-level writing/filtering/redaction and owns close; failure-isolated HTTP tracer retains old error fields, response/thrown identity, host+path metadata, status, duration and single-send semantics. New helper is private; no legacy public RPC restored. Real AI models request through actual state kernel and loopback HTTP server verifies tracer wiring with disposable file credentials, no external traffic or OS credentials. Direct send doubles cover success/non-2xx/invalid URL/failure/cancellation; elapsed time validated as nonnegative integers, not exact clock values. Cross-Agent diagnostic snapshots and task unknown/non-replayability use required same-run companion assertions; no SSH transport is claimed. Context redaction deliberately strengthens old logging. Type-only LogContext, Nest logger/HTTP controllers, UI and whole desktop startup are not automatically accepted. Full P0, current Mac real installation/upgrade/update/rollback, actual pre-migration full backup/recovery, applicable SSH/performance/final release gates remain independent; hosted-only unchanged.';
export const modules = [
  {
    scenarioId: 'P0-DIAGNOSTICS-0427',
    tests: Object.values(names),
    assertion:
      'Whole frozen logger module executes lazy ownership/reset/exit, every four-level wrapper/enabled, errorContext and outgoing trace success/error/cancel branches. Current private ownership/log-store/tracer are explicit successor responsibilities; real kernel AI loopback request proves actual wiring. Scoped source assertion, not exhaustive OS/clock/console/UI coverage.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-0429',
    tests: [names.owner, names.levels],
    assertion:
      'Frozen logStore lazily creates one store, honors explicit data dir over test tmp/home fallback and registers exit flush; identity reused until reset. Successor uses independent kernel-owned stores, real file/SQLite isolation, INFO flush on close, idempotent close and reopen without global substitution. Directory selection is local owner state, never a remote resource identifier.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-0430',
    tests: [names.owner],
    assertion:
      'Frozen setLogStore closes old store, installs exact supplied object or resets to undefined, and exit callbacks flush current owner. Current lifetime-scoped dependency injection replaces global test hook; closing/reopening one real kernel cannot close or redirect another kernel logs. No public/global reset hook restored.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-0431',
    tests: [names.levels, names.failure],
    assertion:
      'Execute every frozen logger debug/info/warn/error wrapper with literal context and enabled true/false plus failing writes/enabled. Current real LogStore retains four-level records/filtering and redacted live/disk behavior; tracer isolates failing writer so success and original rejection are unchanged, without a second send.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-0432',
    tests: [names.error, names.failure],
    assertion:
      'Whole frozen/current errorContext executes Error name/message/code/stack optional branches and string, null, undefined, number, boolean, object and Symbol coercion. Exact raw field parity before current LogStore redaction; HTTP rejections retain original thrown identity and failure diagnostics include structured context.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-0433',
    tests: [names.response, names.failure, names.integration],
    assertion:
      'Original and current outgoing tracer preserves same Response, non-2xx WARN, host/port/path without URL userinfo/query/fragment, invalid URL label, context precedence and nonnegative duration. Failure/cancel WARN rethrows exact reason with one send; failing log writer never alters result. Real kernel AI request reaches actual loopback server and persists INFO/status/path/duration, synthetic key absent. No real provider/SSH or automatic mutation retry claimed.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/logging.test.cjs',
  'packages/agent/tests/diagnostics.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'packages/agent/tests/collaboration.test.cjs',
  'packages/agent/tests/p0-ai-service-migration.test.cjs',
  'packages/agent/tests/p0-review-service-migration.test.cjs',
  'scripts/archive/agent-acceptance/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'logging settings use durable revisions and reject stale or invalid saves',
  'immutable log snapshots cross UTF-8 chunk boundaries, redact ciphertext and publish bounded invalidations',
  'renderer log flood is rate limited and stale snapshot handles fail explicitly',
  'corrupt logging configuration stays intact and valid replacement is refused until recovery',
  'mutation receipts survive process restart without storing parameters or operation results',
  'crashed mutations become unknown and an identical request is never executed again',
  'stdio collaboration keeps staged data and credentials scoped; an ambiguous platform write cannot replay after restart',
];
