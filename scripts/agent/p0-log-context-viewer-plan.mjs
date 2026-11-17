export const batch = 'docs/acceptance/issue-257-258/batch-15-log-context-viewer-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-14-logging-controller-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-log-context-viewer.test.cjs';
export const implementation = [
  'apps/web/src/pages/LogViewerPage.tsx',
  'apps/web/src/pages/log-history.ts',
  'packages/agent/src/adapters/logging/log-store.ts',
  'packages/agent/src/adapters/logging/http-trace.ts',
  'packages/agent/src/modules/diagnostics/logs.ts',
  'packages/protocol/src/legacy/logging.ts',
];
export const names = {
  isolation:
    'P0 LogContext diagnostic snapshots remain owner scoped and cancellation has no side effects',
  type: 'P0 LogContext frozen alias and current store tracer and protocol accept the same unknown record boundary',
  runtime: 'P0 LogContext unknown values normalize redact and persist without mutating callers',
  format:
    'P0 log formatLine matches frozen bytes for levels contexts error summaries Unicode and multiline records',
  cap: 'P0 log viewer display cap retains latest five thousand live and paused rows at exact boundaries',
  disk: 'P0 log viewer cap is display-only and cannot truncate persisted diagnostic records',
};
export const limitations =
  'Local darwin-arm64 working-tree scoped assertions only; releaseEligible=false. Frozen LogContext alias is obtained via AST from full archived logger.ts; compiler equality checks actual current built LogStore.write, createHttpTracer writer and LogEntry.context declarations with strict unknown values and four required compile-time rejections. Whole frozen/current log-store/redactor modules execute against real temporary files and current SQLite settings. Internal bigint/functions/Error/cycles are normalized; this does not expand JSON RPC types. Entire frozen/current LogViewerPage.tsx modules execute in a restricted VM with explicit React state/effect/JSX/UI widget/socket/Agent API stand-ins. Real exported formatter and component callbacks execute; this is not a browser, DOM, layout, React scheduler, clipboard or full UI subscription acceptance. 28 exact formatter cases and live/paused 4999/5000/5001 boundaries preserve order/IDs; current fixture windows never exceed 1000 records. Actual file store persists 6005 records independently; not UI throughput or performance proof. Dedicated two-owner/pre-cancellation assertions and same-run diagnostics/task-journal/stdio companions preserve owner-local snapshots, corrupt configuration, durable unknown/no-replay boundaries; no SSH or remote host claim. No production code changed or new public/global reset hook restored. Full P0, current Mac real installation/upgrade/update/rollback, actual pre-migration full backup/recovery, applicable SSH/performance/final release gates remain independent; hosted-only unchanged.';
export const modules = [
  {
    scenarioId: 'P0-DIAGNOSTICS-0428',
    tests: [names.type, names.runtime, names.isolation],
    assertion:
      'Frozen LogContext type-only alias has exact strict type equality to three current context boundaries; positive unknown-record fixture and four negative cases compile. Frozen/current real stores normalize nested/error/circular/bigint/non-finite/optional/function values, redact live/disk, leave caller object intact. Runtime normalization does not authorize non-JSON RPC. Local snapshots, cancellation and durable ambiguity companion assertions remain explicit.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-1932',
    tests: [names.cap, names.disk],
    assertion:
      'MAX_VISIBLE_ENTRIES exact 5000 in frozen/current whole modules; complete component callbacks/state exercise live and paused exact boundaries and over-cap batches retaining ordered latest rows and unique IDs; footer matches cap. Real store retains 6005 ordered disk entries independently from display cap. No browser/DOM or whole source-module acceptance.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-1933',
    tests: [names.format, names.runtime],
    assertion:
      'Exact frozen/current formatLine outputs across 4 levels x 7 context/error cases including Unicode, multiline, nested JSON, false/null/zero, padding, spacing and omitted stacks. Caller context redaction is checked before formatting; formatter is not itself a redaction or clipboard API. No UI click/clipboard source-module association.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/logging.test.cjs',
  'packages/agent/tests/diagnostics.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'packages/agent/tests/collaboration.test.cjs',
  'scripts/agent/p0-test-receipts.test.mjs',
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
