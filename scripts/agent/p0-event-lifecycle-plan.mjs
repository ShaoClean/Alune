export const batch = 'docs/acceptance/issue-257-258/batch-20-event-lifecycle-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-19-state-gateway-20261116/replay-02';
export const testFile = 'packages/agent/tests/p0-event-lifecycle.test.cjs';
export const implementation = [
  'packages/agent/src/server/session.ts',
  'packages/agent/src/bootstrap/stdio.ts',
  'packages/agent/src/bootstrap/state-kernel.ts',
  'packages/agent/src/runtime/events.ts',
  'packages/agent/src/index.ts',
  'packages/protocol/src/methods.ts',
  'packages/agent-client/src/client.ts',
  'packages/agent-client/src/process.ts',
  'packages/agent-client/src/stdio.ts',
];
export const names = {
  connect:
    'P0 event lifecycle complete frozen handleConnection logs exactly one client ID without wire or store effects',
  disconnect:
    'P0 event lifecycle complete frozen handleDisconnect logs exactly one client ID and does not destroy the gateway',
  module:
    'P0 event lifecycle complete frozen EventsModule registers and exports the identical gateway class with no hidden composition',
  composition:
    'P0 event lifecycle current session composes exact core capabilities gates initialization and isolates per-session event queues',
  close:
    'P0 event lifecycle current close is idempotent aborts owned work rejects pending delivery and disposes once without affecting another session',
  stdio:
    'P0 event lifecycle real stdio EOF signals and malformed input close safely while owners and fresh subscriptions remain isolated',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped only; releaseEligible=false. Whole frozen EventsModule and dependency EventsGateway execute with explicit framework decorator/logger doubles; no live Nest/Socket.IO container, network, singleton-scope or legacy debug-log parity claim. Frozen connect/disconnect only log unvalidated socket client ID and do not own gateway destruction. Current validated initialize/health identity and explicit session close replace those diagnostic hooks; current code does not promise old socket debug messages or IDs. Actual AgentSession captured transport verifies full core event composition, protocol gating, separate queues for same-agent sessions and bounded close, not production shared UI kernel. Controlled pending query/durable:false mutation have no external side effects and do not prove running-write rollback; durable unknown/no-replay uses unchanged companions. Actual SDK/stdio/SQLite file-secret-backend fixture executes production kernel/session safely in disposable directories, EOF/SIGTERM/SIGINT and malformed input; no login Keychain/default credentials, real remote SSH, actual browser/Electron, installer or updater claims. Whole gateway source/export responsibilities remain uncredited; EventsModule only contains one provider/export and no custom body. State subscriptions are session-local and not durable event replay. Unknown writes must be queried, never automatically resent. Existing UI 1943/1944 remain unchanged. Full P0, current Mac real install/upgrade/native update/rollback, actual pre-migration full backup/recovery, applicable SSH/performance/final release gates remain independent. Hosted-only requirements unchanged.';
export const modules = [
  {
    scenarioId: 'P0-PROTOCOL-0192',
    tests: [names.connect, names.composition, names.stdio],
    assertion:
      'Execute complete frozen handleConnection exact debug category/message/context for two IDs, empty/unicode/missing ID and null failure, with no server/timer/store/room effects. Current initialized per-session identity replaces diagnostic socket hook: pre-initialize health/subscription and malformed/incompatible initialize rejected; minor version negotiated, duplicate initialize rejected, valid health survives. Actual SDK/stdio owner identity/restart and session subscription reset checked; old socket ID/debug message is explicitly retired, no unchanged wire/log claim.',
  },
  {
    scenarioId: 'P0-PROTOCOL-0193',
    tests: [names.disconnect, names.close, names.stdio],
    assertion:
      'Execute frozen handleDisconnect exact debug record for repeated/empty/unicode/missing IDs, null failure and no destruction of retained log batch. Current explicit close is same promise on repeat, aborts both session and request signals, rejects pending reliable delivery, removes transport listeners, releases queue and calls disposer once; peer remains healthy. Actual stdio EOF and SIGTERM/SIGINT exit 0, malformed JSON exits 1 with only safe stderr, old client refuses use and restart has new session/fresh subscription. Controlled writes have no external side effects; durable unknown/no-replay companions are separate evidence.',
  },
  {
    scenarioId: 'P0-PROTOCOL-0205',
    tests: [names.module, names.composition, names.close, names.stdio],
    assertion:
      'Review and execute entire frozen EventsModule: exactly two imports, one empty exported class, Module config only providers/exports with the same fully loaded EventsGateway class and no custom members/side effects. Current exported AgentSession composes one EventQueue plus exact core capabilities per session; reserved overrides rejected, version capabilities gated and ACK releases only owner queue. Explicit close and actual production kernel/stdio prove lifecycle wiring in current fixture. Does not auto-accept whole gateway source/export or assert live Nest DI/singleton/production shared UI scope.',
  },
  {
    scenarioId: 'P0-PROTOCOL-0206',
    tests: [names.module, names.composition, names.close, names.stdio],
    assertion:
      'Execute full exported frozen EventsModule rather than matching its name: empty class is instantiated, decorator target matches export, exported provider is the identical actual full gateway constructor, no other config/imports/members. Successor AgentSession/EventQueue/serveStdio exports run through production dispatch and real SDK/stdio. Core subscription/ACK identity and per-session cleanup are asserted, not inferred from export presence. No old Nest runtime restored and no automatic whole-gateway acceptance.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/protocol-compat.test.cjs',
  'packages/agent/tests/events.test.cjs',
  'packages/agent-client/tests/client.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'packages/agent/tests/collaboration.test.cjs',
  'scripts/agent/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'mutation receipts survive process restart without storing parameters or operation results',
  'crashed mutations become unknown and an identical request is never executed again',
  'stdio collaboration keeps staged data and credentials scoped; an ambiguous platform write cannot replay after restart',
];
