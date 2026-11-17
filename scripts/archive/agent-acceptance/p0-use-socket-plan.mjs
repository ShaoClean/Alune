import * as command from './p0-command-gateway-plan.mjs';
import * as state from './p0-state-gateway-plan.mjs';
import * as lifecycle from './p0-event-lifecycle-plan.mjs';

export const batch = 'docs/acceptance/issue-257-258/batch-22-use-socket-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-21-whole-gateway-20261116/replay-01';
export const testFile = 'apps/web/tests/p0-use-socket.test.mjs';
export const implementation = [
  ...new Set([
    ...command.implementation,
    ...state.implementation,
    ...lifecycle.implementation,
    'apps/web/src/hooks/useSocket.ts',
    'apps/web/src/hooks/useConnectionStatusSync.ts',
    'apps/web/src/api/ui-agent.ts',
  ]),
];
export const names = {
  frozen:
    'P0 useSocket complete frozen source export registers exact callbacks returns its socket ref and cleans only its owned socket',
  lifecycle:
    'P0 useSocket current entire module switches shared clients removes owned listeners and preserves peer subscriptions',
  integration:
    'P0 useSocket actual Agent sessions project subscribed events with owner isolation resync and decoder disposal across client replacement',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped acceptance only; releaseEligible=false. Entire unmodified frozen/current useSocket modules execute in VM, with explicit effect/ref/external-store scheduler/import substitutions, not React renderer/scheduling, browser/Electron or live Socket.IO. Frozen creates one owned websocket-only socket per mount, returns a stable ref, retains the initial events closure and unregisters exact handlers before disconnect. Current hook returns undefined, uses external shared Agent identity, disconnects when absent, subscribes via real workspace projection, cleans its own listeners/decoders on replacement/unmount and never closes a shared client. Initial callbacks persist for unchanged Agent identity; arbitrary legacy event passthrough and socket ref are retired, not wire/API compatible. Production useConnectionStatusSync is the only caller, ignores the return and maps callbacks to repository/host/token refresh; rendering/store integration is not executed here. In-memory actual AgentSession/EventQueue/AgentClient verifies all retained projections, resync, owner isolation and partial UTF-8 disposal. Same-run real SDK/stdio/SQLite/native Git and process tests separately validate successor bytes/exits, repository re-read, production missing-key host failure before network, subscription/identity reset and durable no-write-replay. No successful SSH, installed app, actual React mount, full shared UI kernel, throughput or arbitrary event compatibility claimed. Persistent task receipts are not event replay; unknown writes require query and cannot automatically retry. Full P0, current Mac real install/upgrade/native update/rollback, actual pre-migration full backup/recovery and applicable SSH/performance/final release gates remain independent; apps/server retirement failure is preserved. Hosted-only policy unchanged; UI 1943/1944 still need real client evidence. Only two original source/export IDs credited; no duplicate credit for previously accepted event/method IDs.';
const behavioral = [
  ...new Set([
    ...Object.values(names),
    ...Object.values(command.commandNames),
    command.names.owners,
    state.names.hosts,
    state.names.owners,
    ...Object.values(state.projectionNames),
    lifecycle.names.composition,
    lifecycle.names.close,
    lifecycle.names.stdio,
  ]),
];
export const modules = [
  {
    scenarioId: 'P0-PROTOCOL-1907',
    tests: behavioral,
    assertion:
      'Review every statement/import and execute the entire frozen/current useSocket file. Verify sole export, exact owned socket options/ref, callback argument identity, rerender closure, two-consumer isolation, cleanup/remount; current absent/shared/replaced client subscriptions, no shared-client close and decoder removal execute with explicit hook scheduler. Actual AgentSession/SDK projection covers host four-state validation, repository invalidation, tokens, host/resync refresh, command bytes/numeric versus unknown exits, foreign-resource refusal, no callbacks after unmount and safe replacement. Same-run production stdio/native Git command/repository/host and lifecycle companions establish current successor behavior and no automatic write replay. Socket ref and arbitrary event passthrough intentionally retired; no React/DOM/live socket or install assertion.',
  },
  {
    scenarioId: 'P0-PROTOCOL-1908',
    tests: behavioral,
    assertion:
      'Load the entire exact frozen/current module and assert useSocket is its sole runtime export; execute exported function through mount/rerender/cleanup/remount and two consumers, including actual AgentSession/Client event projection, owner/session/resource validation and client replacement with pending UTF-8. Explicit hook scheduler/import doubles do not prove React scheduling; current shared-client ownership, undefined return, stable-client initial callback closure and successor event mapping are documented migration boundaries. Real current stdio/SDK/native Git and durable no-replay companion assertions run in the same replay; no receipt based only on export presence or prior results.',
  },
];
export const testFiles = [
  ...new Set([
    testFile,
    command.testFile,
    state.testFile,
    lifecycle.testFile,
    'apps/web/tests/p0-command-events.test.mjs',
    'apps/web/tests/p0-six-contracts.test.mjs',
    ...command.testFiles,
    ...lifecycle.testFiles.filter((f) => f !== lifecycle.testFile),
  ]),
];
export const requiredCompanionNames = [
  ...new Set([
    ...command.requiredCompanionNames,
    ...state.requiredCompanionNames,
    ...lifecycle.requiredCompanionNames,
  ]),
];
