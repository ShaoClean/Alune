export const batch = 'docs/acceptance/issue-257-258/batch-18-command-gateway-20261116';
export const prior =
  'docs/acceptance/issue-257-258/batch-17-log-event-subscription-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-command-gateway.test.cjs';
export const implementation = [
  'packages/agent/src/runtime/command-events.ts',
  'packages/agent/src/runtime/events.ts',
  'packages/agent/src/server/session.ts',
  'packages/agent/src/adapters/git/native.ts',
  'packages/agent/src/ports/process.ts',
  'packages/agent/src/bootstrap/repository-writes.ts',
  'packages/protocol/src/command-events.ts',
  'packages/agent-client/src/client.ts',
  'packages/agent-client/src/process.ts',
  'packages/agent-client/src/stdio.ts',
  'apps/web/src/api/workspace-events.ts',
];
export const names = {
  output:
    'P0 command gateway full frozen class emits exact output channel and payload for both streams',
  exit: 'P0 command gateway full frozen class emits exact numeric exit channel and preserves call order',
  owners:
    'P0 command gateway real stdio owners isolate command streams and reject foreign cancelled and replayed writes',
};
export const commandNames = {
  raw: 'P0 command events carry real pipe bytes and process exit 7 through the Agent queue and client',
  pressure:
    'P0 command output awaits client ACKs with bounded pipe pressure and no state coalescing',
  writes:
    'P0 authorized repository writes emit actual hook output and Git status without replaying writes',
  cancel:
    'P0 process cancellation preserves null signal status; spawn failure and progress never fabricate numeric exit',
  exits:
    'P0 command exits 0, 1 and 128 come from native close status; unsubscribed streams stay optional',
  failure: 'P0 command delivery failure stops the real process and remains an explicit failure',
  projection:
    'P0 command text projection separates resources and drops malformed events, unknown exits and disposed callbacks',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped assertions only; releaseEligible=false. Complete frozen EventsGateway executes in VM, decorators and Socket.IO send are explicit doubles, not live Nest/WebSocket. Current authorized native Git writes traverse actual child-process stdio/SDK/SQLite with two separate local owners; no remote SSH, shared kernel, Electron or browser interaction claim. commands.output binary base64/ACK stream and commands.exit structured identity replace legacy text/global broadcast; Agent ID replaces connection ID, resource ID supplies repository identity; no identical wire-format compatibility or universal shell/PTY coverage. Additional in-process AgentSession transport/controlled ACK tests verify UTF-8 projection/backpressure, not transport throughput. Pre-cancellation means not-started; running cancellation may be unknown and cannot imply rollback. Persistent duplicate-write rejection does not provide command event replay. Full P0, current Mac install/upgrade/native update/rollback, actual pre-migration full backup/recovery, applicable SSH/performance/final release gates remain independent. Hosted-only requirements unchanged; blocked UI entries retained.';
export const modules = [
  {
    scenarioId: 'P0-PROTOCOL-0198',
    tests: [
      names.output,
      names.owners,
      commandNames.raw,
      commandNames.pressure,
      commandNames.writes,
      commandNames.projection,
      commandNames.failure,
    ],
    assertion:
      'Execute complete frozen emitCommandOutput with stdout/stderr, empty/Unicode/CRLF/NUL and exact command:output fields. Current authorized native Git output uses reliable ACKed binary chunks <=16KiB with exact reconstructed pipe bytes, ordered command identity and owning Agent/session/resource; two real stdio owners reject foreign/pre-cancelled/replayed writes without hook reruns. Incremental text projection matches legacy fields with migrated routing IDs; no live socket or universal shell claim.',
  },
  {
    scenarioId: 'P0-PROTOCOL-0199',
    tests: [
      names.exit,
      names.owners,
      commandNames.raw,
      commandNames.writes,
      commandNames.cancel,
      commandNames.exits,
      commandNames.failure,
    ],
    assertion:
      'Execute complete frozen emitCommandExit and exact command:exit numeric 0/1/7/128 fields after output. Successor native close status supplies exitCode/signal once per command after its outputs; actual Git maps hook 7 to 1 by oracle. Null/SIGTERM cancellation and spawn failure never invent numeric exits; two stdio owners/restart retain succeeded task and refuse write replay. Outcome/progress are not exit codes and unknown is not retry authorization.',
  },
  {
    scenarioId: 'P0-PROTOCOL-0203',
    tests: [
      names.output,
      names.owners,
      commandNames.raw,
      commandNames.pressure,
      commandNames.writes,
      commandNames.projection,
      commandNames.failure,
    ],
    assertion:
      'Capture complete frozen server.emit command:output exact channel, both stream payloads and ordered calls. Current commands.output topic replaces global socket channel with subscribed owner/session/resource ACKed base64 output. Reconstruct actual stdout/stderr and compare text compatibility callbacks to frozen fields; no coalescing, resource decoder mixing, disposed callbacks or silent delivery failure. Actual local stdio confirms separate-owner event identity and no events for rejected writes; no legacy WebSocket traffic claim.',
  },
  {
    scenarioId: 'P0-PROTOCOL-0204',
    tests: [
      names.exit,
      names.owners,
      commandNames.raw,
      commandNames.writes,
      commandNames.cancel,
      commandNames.exits,
      commandNames.projection,
      commandNames.failure,
    ],
    assertion:
      'Capture complete frozen server.emit command:exit exact channel, four numeric codes and output/exit ordering. Current commands.exit structured topic preserves actual process status with command/operation and owner/session/resource, one exit following output per command; signal/null remains SDK-only, no numeric legacy callback fabricated. Failed/foreign/cancelled/repeated operations are distinguished and persisted duplicate after restart cannot execute a second hook. Local stdio plus real process companions only; no socket or remote claim.',
  },
];
export const testFiles = [
  testFile,
  'apps/web/tests/p0-command-events.test.mjs',
  'packages/agent/tests/p0-log-context-viewer.test.cjs',
  'packages/agent/tests/events.test.cjs',
  'packages/agent/tests/logging.test.cjs',
  'packages/agent/tests/diagnostics.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'packages/agent/tests/collaboration.test.cjs',
  'scripts/agent/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'P0 LogContext diagnostic snapshots remain owner scoped and cancellation has no side effects',
  'mutation receipts survive process restart without storing parameters or operation results',
  'crashed mutations become unknown and an identical request is never executed again',
  'stdio collaboration keeps staged data and credentials scoped; an ambiguous platform write cannot replay after restart',
];
