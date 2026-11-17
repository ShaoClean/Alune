export const batch = 'docs/acceptance/issue-257-258/batch-10-logging-boundaries-20261113';
export const prior = 'docs/acceptance/issue-257-258/batch-09-main-diagnostics-20261113/replay-02';
export const testFile = 'packages/agent/tests/p0-logging-boundaries.test.cjs';
export const implementation = [
  'packages/agent/src/adapters/logging/log-store.ts',
  'packages/agent/src/adapters/logging/redact.ts',
  'packages/agent/src/adapters/logging/index.ts',
  'packages/agent/src/modules/diagnostics/logs.ts',
  'packages/agent/src/bootstrap/state-kernel.ts',
  'packages/agent/src/bootstrap/ui.ts',
  'packages/agent/src/server/session.ts',
];
export const names = {
  zero: 'P0 logging zero and negative internal history limits return no entries',
  redact:
    'P0-DIAGNOSTICS-0456 whole redactor preserves bounded values and explicitly strengthens secret masking',
  store:
    'P0-DIAGNOSTICS-0409 whole store preserves validation levels live delivery flush and settings persistence',
  rotation: 'P0 logging rotation retention size caps and bounded history use real isolated files',
  fallback:
    'P0 logging directory switches fallback append failures and malformed history remain contained',
  tail: 'P0 logging partial history tails and cleanup IO failures do not discard usable entries',
  module: 'P0-DIAGNOSTICS-0444 logging module registration has private Agent handler successors',
  owner: 'P0-DIAGNOSTICS-0445 module ownership isolates settings history and cancelled mutations',
  close: 'P0-DIAGNOSTICS-0446 shutdown flushes pending diagnostics before the Agent releases state',
  stdio: 'P0 logging real stdio Agent flushes INFO on EOF and isolates snapshots across sessions',
};
export const limitations =
  'Local darwin-arm64 working-tree scoped successor assertions only; releaseEligible=false. Full frozen redactor and LogStore execute in restricted VM with real isolated filesystem and exact frozen shared constants. Frozen Nest module uses explicit Module/LoggingController/logger dependencies; no old Nest/HTTP server is started. Current logs execute real disk/SQLite/stdio Agent sessions with synthetic data, file credential backend, no user data or OS credentials. Nest-specific server shutdown line/signal context is intentionally retired, replaced by Agent-owned flush/resource release, not claimed byte-equivalent. Source-level associations are limited assertions, not exhaustive branch/feature coverage. Ciphertext/source/history redaction, valid JSON and corrupt SQLite-document preservation intentionally strengthen old behavior. Zero/negative internal history limits now return empty; public snapshot limits remain 1–1000. Existing diagnostics/protocol/task/SDK regressions run in this replay. Actual Electron log windows/UI, original logger/HTTP trace and Nest logger, SSH/install/update/rollback/performance and full P0/release gates remain independent. Hosted-only safety requirements unchanged.';
export const modules = [
  {
    scenarioId: 'P0-DIAGNOSTICS-0409',
    tests: [names.store, names.rotation, names.fallback, names.tail, names.zero, names.stdio],
    assertion:
      'Entire frozen LogStore loads and executes real files: settings validation/defaults/persistence, level filtering, listeners/refusal/unsubscribe, immediate/timed/batched flush, bounded/reloaded/tail history, size/date rotation, retention/total cap/current-file protection, directory switch/recreate/fallback, IO refusal and close. Current successor retains common positive-limit results and real stdio EOF/restart persistence; zero/negative internal count bug is intentionally fixed. Current corrupt settings and immutable UTF-8 RPC snapshots covered by same-run diagnostics regressions. Scoped source assertion, not every OS failure or race.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-0456',
    tests: [names.redact, names.fallback, names.stdio],
    assertion:
      'Entire frozen/current redactors execute literal and every legacy text-pattern family, string/depth/key/array/circular/type bounds, sensitive-key empty/null behavior; current error/source/history/ciphertext masking, finite JSON and safe prototype behavior are explicitly strengthened. Disk and stdio readback suppress synthetic secrets. No user secret or external service used.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-0444',
    tests: [names.module, names.owner, names.close, names.stdio],
    assertion:
      'Whole frozen logging.module.ts executes with explicit decorator/controller/logger doubles; sole LoggingController registration and exported LoggingModule are checked. Current openStateKernel installs the six private diagnostics handlers at protocol minor 1 and a separate private desktop.log; isolated state ownership and shutdown flushing replace Nest registration/lifecycle. Live old HTTP server and UI are outside scope.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-0445',
    tests: [names.module, names.owner, names.close, names.stdio],
    assertion:
      'Frozen LoggingModule export identity and registration are explicit; successor module is Agent kernel ownership with distinct Agent IDs/settings revisions/history/snapshot caches, pre-aborted save unchanged, cross-Agent revision conflict, real session isolation and durable settings receipts across restart. No class/API compatibility with retired Nest promised.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-0446',
    tests: [names.close, names.stdio],
    assertion:
      'Frozen shutdown method executes both absent and SIGTERM branches and flushes a real legacy store after info logging. Current kernel close is idempotent, flushes pending INFO and redacted context before releasing SQLite/writer ownership, and permits reopen; actual stdio EOF exits 0 and preserves diagnostic history and durable settings task. Nest server-closed message/signal context is explicitly retired. Same-run task crash regression keeps unknown outcomes non-replayable; snapshot handles do not cross session/Agent.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/logging.test.cjs',
  'packages/agent/tests/diagnostics.test.cjs',
  'packages/agent/tests/settings-rpc.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'packages/agent/tests/events.test.cjs',
  'packages/agent/tests/protocol-compat.test.cjs',
  'packages/agent/tests/process.test.cjs',
  'packages/agent-client/tests/client.test.cjs',
  'packages/agent-client/tests/stdio.test.cjs',
  'scripts/agent/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'logging settings use durable revisions and reject stale or invalid saves',
  'immutable log snapshots cross UTF-8 chunk boundaries, redact ciphertext and publish bounded invalidations',
  'renderer log flood is rate limited and stale snapshot handles fail explicitly',
  'corrupt logging configuration stays intact and valid replacement is refused until recovery',
  'mutation receipts survive process restart without storing parameters or operation results',
  'crashed mutations become unknown and an identical request is never executed again',
];
