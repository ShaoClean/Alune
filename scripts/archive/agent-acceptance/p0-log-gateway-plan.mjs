export const batch = 'docs/acceptance/issue-257-258/batch-17-log-event-subscription-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-16-log-viewer-actions-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-log-gateway.test.cjs';
export const implementation = [
  'packages/agent/src/server/session.ts',
  'packages/agent/src/runtime/events.ts',
  'packages/agent/src/modules/diagnostics/logs.ts',
  'packages/agent-client/src/client.ts',
  'packages/agent-client/src/process.ts',
  'packages/agent-client/src/stdio.ts',
];
export const names = {
  frozen:
    'P0 log gateway frozen subscription metadata joins only logs and batches ordered redacted rows at 100ms',
  cleanup:
    'P0 log gateway frozen destroy detaches listener and cancels pending batch without late sends',
  subscription:
    'P0 log gateway real stdio subscription replaces topics rejects malformed requests and emits invalidations not log payloads',
  owners:
    'P0 log gateway real stdio owners stay isolated across unsubscribe close and restart without inherited subscription',
  pressure:
    'P0 log gateway current queue bounds invalidation flood emits resync and releases pending events on close',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped only; releaseEligible=false. Complete frozen EventsGateway and LogStore execute with real disposable files; Nest decorators, Socket.IO room membership/emission and only gateway timer scheduler are explicit doubles. Successor executes real Agent/SDK/SQLite child-process stdio, exact replacement topic subscriptions, bounded state invalidations and pull snapshots; event payload/ack shape intentionally changes from legacy room log batches, no legacy wire parity claim. Actual EventQueue with captured send and controlled ACK verifies 10000-notification bounds/resync/close, not end-to-end throughput. Two independent local owners and restart do not certify two UI sessions sharing a kernel, remote SSH, Electron, browser or live WebSocket. Same-run pre-cancellation and durable unknown/no-replay companions do not claim running mutation rollback. No retired Nest runtime restored; no production edits necessary. Existing blocked UI entries retained. Full P0, actual current Mac install/upgrade/native update/rollback, actual pre-migration backup/recovery, applicable SSH/performance/final release gates remain independent. Hosted-only requirements unchanged.';
export const modules = [
  {
    scenarioId: 'P0-PROTOCOL-0190',
    tests: [names.frozen, names.subscription, names.pressure],
    assertion:
      'Execute frozen afterInit against actual frozen LogStore: one listener, no-audience exclusion, exactly one 100ms timer, ordered redacted room-only batches and subsequent batch reset. Successor real stdio emits only subscribed bounded changed invalidations, retains readable snapshots, and real EventQueue bounds 10000 notifications with explicit resync. No Nest/WebSocket traffic claim.',
  },
  {
    scenarioId: 'P0-PROTOCOL-0191',
    tests: [names.cleanup, names.owners, names.pressure],
    assertion:
      'Frozen onModuleDestroy removes actual store listener and cancels pending timer; post-destroy writes persist without sending. Successor EventQueue close releases pending/in-flight memory and refuses further reliable writes, actual local Agent graceful close exits 0, another owner continues, and restart changes session, drops old snapshot and requires fresh subscription. No shared-kernel or remote-SSH claim.',
  },
  {
    scenarioId: 'P0-PROTOCOL-0194',
    tests: [names.frozen, names.subscription, names.owners],
    assertion:
      'Execute frozen subscribeLogs method, exact logs room join and ok result. Successor actual events.subscribe returns exact topic/session shape, replaces previous filters, rejects eight malformed requests without losing subscription, [] disables later delivery while logs remain queryable. Local owner/session IDs checked; no socket transport claim.',
  },
  {
    scenarioId: 'P0-PROTOCOL-0195',
    tests: [names.frozen, names.subscription, names.owners],
    assertion:
      'Frozen SubscribeMessage logs:subscribe and ConnectedSocket decorators register subscribeLogs and method executes room join. Current capability dispatch traverses real child stdio AgentSession through SDK subscribe; validated response binds current session, restart has no inherited subscription, malformed topics rejected. Explicit protocol migration from room subscription to topic replacement; no Nest route server claim.',
  },
  {
    scenarioId: 'P0-PROTOCOL-0200',
    tests: [names.frozen, names.subscription, names.owners, names.pressure],
    assertion:
      'Frozen LOG_ROOM log:entries send occurs only for active audience and preserves ordered redacted batched records. Current wire emits only small owner/session-bound changed invalidations (no log/secret payload), pulls exact persisted redacted history; filters and owner isolation tested in real stdio. Controlled-ACK EventQueue emits resync and latest invalidation under flood and releases on close. Invalidation/pull intentionally replaces log batch wire shape.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/p0-log-context-viewer.test.cjs',
  'packages/agent/tests/events.test.cjs',
  'packages/agent/tests/logging.test.cjs',
  'packages/agent/tests/diagnostics.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'packages/agent/tests/collaboration.test.cjs',
  'scripts/archive/agent-acceptance/p0-test-receipts.test.mjs',
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
