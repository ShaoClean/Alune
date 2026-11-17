export const batch = 'docs/acceptance/issue-257-258/batch-19-state-gateway-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-18-command-gateway-20261116/replay-01';
export const testFile = 'apps/web/tests/p0-state-gateway.test.mjs';
export const implementation = [
  'packages/agent/src/runtime/events.ts',
  'packages/agent/src/server/session.ts',
  'packages/agent/src/bootstrap/hosts.ts',
  'packages/agent/src/adapters/ssh/connect.ts',
  'packages/agent/src/bootstrap/repositories-kernel.ts',
  'packages/agent/src/bootstrap/repository-writes.ts',
  'packages/agent/src/runtime/reads.ts',
  'packages/agent-client/src/client.ts',
  'packages/agent-client/src/process.ts',
  'packages/agent-client/src/stdio.ts',
  'apps/web/src/api/workspace-events.ts',
  'apps/web/src/api/agent-repositories.ts',
  'apps/web/src/stores/connectionStore.ts',
];
export const names = {
  connection:
    'P0 state gateway complete frozen class emits connection status with optional fields and no-server guard',
  repository:
    'P0 state gateway complete frozen class emits repository status with exact spread and identity precedence',
  hosts:
    'P0 state gateway real stdio host failure emits owner-scoped ordered status without exposing a key or contacting a host',
  owners:
    'P0 state gateway real stdio repository changes re-read native status and isolate owners resources cancellation and durable replay',
};
export const projectionNames = {
  connection:
    'P0 ConnectionStatusEvent projects frozen fields from sequenced Agent events and ignores stale or malformed host status',
  repository:
    'P0 RepositoryStatusEvent successor invalidates only its owning resource and re-reads the frozen status summary',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped assertions only; releaseEligible=false. Complete frozen EventsGateway executes in VM with explicit decorator and socket-send doubles, no live Nest/WebSocket. Successor hosts.changed uses validated four-state timestamped projection; old emitter also accepted arbitrary states and missing timestamps, not promised compatible. Actual local production host failure uses a disposable missing private-key path, fails before socket connection, emits connecting/error and tests foreign/pre-cancel rejection and disposal. Connected/disconnected projection and stale/malformed status are controlled AgentSession inputs, no successful SSH/remote host or browser/Electron claim. Actual SDK/stdio/SQLite/native Git with two separate owners and two same-owner resources proves repository invalidation, fresh status reads, scope, pre-cancellation and durable duplicate rejection across restart. repositories.changed plus resource re-read replaces arbitrary legacy repo:status payload; old data spread could override identity, current envelope cannot; Agent ID replaces legacy routing ID for local repository projection. State notifications may coalesce and require resync, not reliable event history, global wire compatibility, filesystem watching or shared-kernel UI coverage. Persistent task receipt is not event replay; unknown writes require query and cannot be automatically resent. Full P0, current Mac real install/upgrade/native update/rollback, actual pre-migration full backup/recovery, applicable SSH/performance/final release gates remain independent. Hosted-only requirements unchanged; UI 1943/1944 retained unchanged.';
const connectionTests = [names.connection, names.hosts, projectionNames.connection];
const repositoryTests = [names.repository, names.owners, projectionNames.repository];
export const modules = [
  {
    scenarioId: 'P0-PROTOCOL-0196',
    tests: connectionTests,
    assertion:
      'Execute full frozen emitConnectionStatus including exact connection:status fields, optional error/time and absent-server guard. Current hosts.changed projects four validated states through sequenced AgentSession/SDK into frozen-compatible fields; malformed inputs are ignored and stale timestamps cannot overwrite newer connection store state. Real stdio production missing-key authentication failure emits ordered connecting/error for its host with increasing time, redacted error and offline/stale catalog; foreign owner/pre-cancel have no events, another owner stays healthy and disposed callbacks stop. Legacy arbitrary status/missing time are explicit migration limits; no successful SSH or UI assertion.',
  },
  {
    scenarioId: 'P0-PROTOCOL-0197',
    tests: repositoryTests,
    assertion:
      'Execute full frozen emitRepoStatus exact repo:status channel and spread behavior, nested/empty data, legacy identity override and missing-server failure. Current native Git stage sends owner/session/resource generation invalidations, re-reads exact clean/dirty branch/ahead/behind status via production repository query adapter, and projects summary to frozen fields using migrated local Agent routing ID. Two stdio owners and same-owner resources remain isolated; foreign/pre-cancel requests do not stage or notify. Success and task persist across restart, duplicate operation is refused before/after restart without new event/write. Controlled in-flight reads retry on invalidation and resync/disposal callbacks execute. No arbitrary broadcast or watcher/remote/UI parity claimed.',
  },
  {
    scenarioId: 'P0-PROTOCOL-0201',
    tests: connectionTests,
    assertion:
      'Capture exact full frozen server emit connection:status channel and payload with optional fields. Its successor is subscribed hosts.changed with validated owner/session sequence and hostId-to-connectionId projection; real local stdio connecting/error production failure and controlled connected/disconnected events compare to frozen fields. Timestamp ordering, malformed rejection, foreign/pre-cancel no-event behavior, safe error and disposal are explicit; arbitrary legacy status and missing time not accepted as current wire format. No live socket or successful SSH claim.',
  },
  {
    scenarioId: 'P0-PROTOCOL-0202',
    tests: repositoryTests,
    assertion:
      'Capture exact full frozen server emit repo:status channel, summary fields and legacy spread override. Current repositories.changed invalidates one resource and re-reads actual Git status rather than fabricating summary from progress; actual two stdio owners plus second same-owner repository prove event envelopes and isolation. Resource generations increase; pre-cancel/foreign requests have no side effect; actual durable task and repeated-operation refusal survive restart with no event replay. Controlled query invalidation/resync/disposal tested separately. Not identical global broadcast, filesystem watcher, remote or UI coverage.',
  },
];
export const testFiles = [
  testFile,
  'apps/web/tests/p0-six-contracts.test.mjs',
  'packages/agent/tests/events.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'packages/agent/tests/collaboration.test.cjs',
  'scripts/agent/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'mutation receipts survive process restart without storing parameters or operation results',
  'crashed mutations become unknown and an identical request is never executed again',
  'stdio collaboration keeps staged data and credentials scoped; an ambiguous platform write cannot replay after restart',
];
