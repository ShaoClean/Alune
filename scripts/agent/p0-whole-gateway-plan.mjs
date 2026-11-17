import * as log from './p0-log-gateway-plan.mjs';
import * as command from './p0-command-gateway-plan.mjs';
import * as state from './p0-state-gateway-plan.mjs';
import * as lifecycle from './p0-event-lifecycle-plan.mjs';

export const batch = 'docs/acceptance/issue-257-258/batch-21-whole-gateway-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-20-event-lifecycle-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-whole-gateway.test.cjs';
export const implementation = [
  ...new Set([
    ...log.implementation,
    ...command.implementation,
    ...state.implementation,
    ...lifecycle.implementation,
    'packages/agent/src/adapters/logging/log-store.ts',
    'packages/protocol/src/command-events.ts',
    'apps/web/src/api/ui-agent.ts',
  ]),
];
export const names = {
  whole:
    'P0 whole gateway exact source export and all responsibilities execute together without hidden effects',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped only; releaseEligible=false. Entire frozen EventsGateway source/export reviewed as eight top-level statements, five imports, two constants, four fields, four lifecycle interfaces and nine methods, then executed together on one instance. Nest decorators, Socket.IO sends, store and timer in aggregate test are explicit doubles; separate same-run tests use the actual frozen LogStore with disposable files and controlled timers. No live Nest container, Socket.IO network or singleton claim. Frozen wildcard CORS and unvalidated client-ID debug records are retired declarations, not current access policy or promised compatibility. Actual production AgentSession/EventQueue plus SDK/stdio/SQLite/native Git execute current replacements: initialized session identity/close, bounded subscribed log invalidations with snapshot pull, host status projections, repository invalidation and re-read, and ACKed binary command streams/actual numeric exit. Legacy arbitrary status, repository spread identity override, global broadcast and room batch wire formats are explicitly replaced, not retained. Successful SSH, real browser/Electron, installer/updater, performance and production shared UI kernel are outside this scoped run. Host test uses a disposable missing key and stops before network. Two local owners plus same-owner resources do not prove shared-kernel UI behavior. Pre-cancellation does not imply running mutation rollback. Persistent task receipt/duplicate refusal is not event replay; unknown writes require queries and cannot automatically retry. Source/export receive exact two receipts only after all mapped behavioral assertions pass in this run; no new credit for prior method/channel/module IDs. Existing UI 1943/1944 remain unchanged. Independent retirement gate still checks apps/server; full P0, current Mac actual install/upgrade/native update/rollback, actual pre-migration full backup/recovery and applicable SSH/performance/final release gates remain separate. Hosted-only requirements unchanged.';
const behavioralTests = [
  ...new Set([
    names.whole,
    ...Object.values(log.names),
    ...Object.values(command.names),
    ...Object.values(command.commandNames),
    ...Object.values(state.names),
    ...Object.values(state.projectionNames),
    ...Object.values(lifecycle.names),
  ]),
];
export const modules = [
  {
    scenarioId: 'P0-PROTOCOL-0188',
    tests: behavioralTests,
    assertion:
      'Review and execute complete frozen gateway source with exact imports/constants/decorator configuration, fields, interfaces, sole exported class and every method; reject unreviewed members or top-level effects. One-instance trace combines initialization, no-server/no-audience guards, room subscription, logging batch, connection/disconnection, all four emitter families, timer reset and destroy/no late send. Same-run individual edge-case tests use full class and actual frozen LogStore. Current production AgentSession lifecycle and real SDK/stdio/SQLite/native Git tests exercise identity/subscription/owner/resource isolation, bounded invalidations/resync, snapshot pull, fresh Git status, actual ACKed command bytes/exits, cancellation/restart and duplicate-write refusal. All exact references must pass in this replay; changed wire/identity semantics and test-double boundaries remain explicit, no automatic credit from prior receipts or inventory.',
  },
  {
    scenarioId: 'P0-PROTOCOL-0189',
    tests: behavioralTests,
    assertion:
      'Load full frozen EventsGateway export, require it to be the sole runtime export and exact decorator target, construct independent instances, execute all nine methods together and in detailed same-run behavioral cases; verify real module provider/export constructor identity separately. Current exported AgentSession/EventQueue/serveStdio and production host/repository/diagnostics/command composition execute via actual local SDK children and controlled transports. Verify initialization, ownership, close/disposal, current event flow and durable no-replay before issuing precisely this export ID receipt. Not merely export presence or class-name matching; no live Nest/socket/singleton/shared-UI claim, whole-class migration intentionally changes transport and event formats.',
  },
];
export const testFiles = [
  ...new Set([
    testFile,
    log.testFile,
    command.testFile,
    state.testFile,
    lifecycle.testFile,
    'apps/web/tests/p0-command-events.test.mjs',
    'apps/web/tests/p0-six-contracts.test.mjs',
    'packages/agent/tests/p0-log-context-viewer.test.cjs',
    'packages/agent/tests/protocol-compat.test.cjs',
    'packages/agent/tests/events.test.cjs',
    'packages/agent-client/tests/client.test.cjs',
    'packages/agent/tests/logging.test.cjs',
    'packages/agent/tests/diagnostics.test.cjs',
    'packages/agent/tests/task-journal.test.cjs',
    'packages/agent/tests/collaboration.test.cjs',
    'scripts/agent/p0-test-receipts.test.mjs',
  ]),
];
export const requiredCompanionNames = [
  ...new Set([
    ...log.requiredCompanionNames,
    ...command.requiredCompanionNames,
    ...state.requiredCompanionNames,
    ...lifecycle.requiredCompanionNames,
  ]),
];
