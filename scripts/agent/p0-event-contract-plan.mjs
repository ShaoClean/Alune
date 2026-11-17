import * as command from './p0-command-gateway-plan.mjs';
import * as state from './p0-state-gateway-plan.mjs';

export const batch = 'docs/acceptance/issue-257-258/batch-23-event-contract-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-22-use-socket-20261116/replay-02';
export const testFile = 'apps/web/tests/p0-event-contract.test.mjs';
export const implementation = [
  ...new Set([
    ...command.implementation,
    ...state.implementation,
    'packages/protocol/src/index.ts',
    'packages/protocol/src/messages.ts',
    'apps/web/src/api/ui-agent.ts',
  ]),
];
export const names = {
  frozen:
    'P0 event contract entire frozen module has exactly five type declarations and every field is checked by positive and negative compiler cases',
  successor:
    'P0 event contract successor compiler proves scoped binary nullable exit envelopes and explicitly rejects legacy wire assignability',
  projection:
    'P0 event contract all legacy fields map explicitly to current callbacks with strict payload validation and snapshot invalidation boundary',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped acceptance only; releaseEligible=false. Entire exact frozen events.ts contains only four exported interfaces and one dictionary type, with no imports, functions or runtime exports. All 23 fields/types/optional flags are reviewed, every field has compiler positive/negative cases and ServerEvents has exactly four typed keys. Current types intentionally are not legacy-assignable: scoped Agent/session/sequence/resource envelopes, reliable base64 bytes and nullable signal exits replace legacy global text callbacks; retired type names are not restored. Strict compiler tests document that legacy number/string declarations did not enforce finite time, safe integers or valid IDs. Production UI projection maps connectionId from Agent owner for commands but host profile ID for host status; repository invalidation triggers actual native status re-read, not payload snapshot synthesis. Same-run unchanged AgentSession/SDK/native processes and real production-kernel stdio/SQLite/Git tests separately establish retained bytes/exits/ACK pressure, host offline failure, owner/resource isolation, pre-cancel no side effects and durable duplicate rejection across restart. New projection test uses a controlled event source, not transport or UI rendering; old gateway tests use VM/decorator/socket doubles. No live Nest/Socket.IO, React/DOM/Electron, successful SSH, arbitrary remote host, production shared UI kernel, install/update/rollback, full backup/recovery or performance assertion. Unknown writes require query and must not be automatically resent; task receipts are not event history. Only original source ID P0-PROTOCOL-2299 credited, not five previously mapped type IDs or aggregate barrels 2241/2305. Legacy module compatibility is explicitly rejected; scoped migrated responsibility acceptance is not release approval. UI 1943/1944 remain unchanged and unselected; apps/server retirement failure and independent full P0/current Mac product release gates remain. Hosted-only requirements unchanged.';
export const modules = [
  {
    scenarioId: 'P0-PROTOCOL-2299',
    tests: [
      ...new Set([
        ...Object.values(names),
        ...Object.values(command.names),
        ...Object.values(command.commandNames),
        ...Object.values(state.names),
        ...Object.values(state.projectionNames),
        'P0 ServerEvents successor set includes reliable command topics and rejects malformed command payloads',
      ]),
    ],
    assertion:
      'Review all five entire frozen type declarations and all 23 field/type/optionality pairs; compile concrete full, omitted, malformed, union and excess-property cases for every field plus four category keys, and assert no runtime imports/exports. Compile current actual protocol source types with valid binary output/scoped envelopes and nullable exits; explicitly reject old/new assignments and restored legacy exports. Production projection checks every retained callback field, Agent versus host-profile routing ID, both UTF-8 streams, numeric/null exits, malformed payload rejection, foreign command resource refusal, repository invalidation without fabricated snapshot and disposal. Same-run full frozen emitter plus actual AgentSession/SDK/native Git/stdio/SQLite assertions verify real bytes, ordered exits/ACK pressure, actual repository dirty/branch/ahead/behind re-read, host missing-key failure before network, owner/session/resource isolation, cancellation and durable no-replay/restart. This closes only migrated source responsibilities with exact limits; not literal type/module/wire compatibility, aggregate barrel acceptance, successful SSH or UI rendering.',
  },
];
export const testFiles = [...new Set([testFile, ...command.testFiles, ...state.testFiles])];
export const requiredCompanionNames = [
  ...new Set([...command.requiredCompanionNames, ...state.requiredCompanionNames]),
];
