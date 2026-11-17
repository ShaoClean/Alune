export const batch = 'docs/acceptance/issue-257-258/batch-16-log-viewer-actions-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-15-log-context-viewer-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-log-viewer-actions.test.cjs';
export const implementation = [
  'apps/web/src/pages/LogViewerPage.tsx',
  'apps/web/src/pages/log-history.ts',
  'apps/web/src/api/logging.ts',
  'packages/agent/tests/log-viewer-actions-fixture.cjs',
];
export const names = {
  frozen:
    'P0 log viewer frozen log subscription joins on connect reconnect and cleans up pending history',
  current:
    'P0 log viewer current invalidations refresh bounded owner history coalesce and discard disposed reads',
};
export const blockedScenarios = ['P0-DIAGNOSTICS-1943', 'P0-DIAGNOSTICS-1944'];
export const limitations =
  'Local darwin-arm64 working-tree scoped only; releaseEligible=false. Full frozen/current TSX and logging API modules execute in a restricted VM with explicit React/hooks/JSX/widgets/selection/clipboard/desktop bridge/transport stand-ins. Actual copy and directory onClick handlers execute, with exact bytes, filters, empty results, Unicode/multiline selection, rejection/missing clipboard notices, 2400ms notice expiry, bridge availability, zero renderer arguments, failure handling and stale callback assertions. No browser/DOM/React native scheduling, system clipboard permission, Electron IPC, OS directory opening, WebSocket, SSH or full UI subscription claim. Same-run real SQLite owner/pre-cancellation and durable unknown/no-replay companions remain explicit; they do not certify these UI doubles as end-to-end transports. No production code changed and no retired Nest runtime restored. Full P0, current Mac actual install/upgrade/update/rollback, actual pre-migration full backup/recovery, applicable SSH/performance/final release gates remain independent; hosted-only unchanged.';
export const modules = [
  {
    scenarioId: 'P0-DIAGNOSTICS-1936',
    tests: [names.frozen, names.current],
    assertion:
      'Execute frozen logs:subscribe emit on connect and reconnect, disconnect status and socket cleanup. Current owner Agent event registration, initial bounded history read, refresh on diagnostics.logs.changed and events.resync-required, unrelated-event exclusion, in-flight coalescing, and event/close unsubscribe replace the room subscription. Explicit transport/hook doubles; no actual WebSocket/SSH/browser claim. Real diagnostic snapshot ownership/pre-cancellation and stdio/durable-ambiguity companions run separately.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-1937',
    tests: [names.frozen, names.current],
    assertion:
      'Execute frozen log:entries listener, pre-history stream/history deduplication and ordered subsequent append. Current invalidations pull owner-local bounded history through actual component and cursor; never trust event payload as log rows, same snapshot cannot duplicate rows, coalesced refresh retains order/unique IDs, disposed delayed history cannot append and local owner fixtures stay separate. Explicit transport/hook doubles; real store/stdio ownership companions do not turn fixtures into full UI subscription acceptance.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/p0-log-context-viewer.test.cjs',
  'packages/agent/tests/logging.test.cjs',
  'packages/agent/tests/diagnostics.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'packages/agent/tests/collaboration.test.cjs',
  'scripts/agent/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'P0 LogContext diagnostic snapshots remain owner scoped and cancellation has no side effects',
  'logging settings use durable revisions and reject stale or invalid saves',
  'immutable log snapshots cross UTF-8 chunk boundaries, redact ciphertext and publish bounded invalidations',
  'renderer log flood is rate limited and stale snapshot handles fail explicitly',
  'corrupt logging configuration stays intact and valid replacement is refused until recovery',
  'mutation receipts survive process restart without storing parameters or operation results',
  'crashed mutations become unknown and an identical request is never executed again',
  'stdio collaboration keeps staged data and credentials scoped; an ambiguous platform write cannot replay after restart',
];
