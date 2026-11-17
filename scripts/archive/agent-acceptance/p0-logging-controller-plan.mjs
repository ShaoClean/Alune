export const batch = 'docs/acceptance/issue-257-258/batch-14-logging-controller-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-13-http-logging-20261113/replay-01';
export const testFile = 'packages/agent/tests/p0-logging-controller.test.cjs';
export const implementation = [
  'packages/agent/src/modules/diagnostics/logs.ts',
  'packages/agent/src/adapters/logging/log-store.ts',
  'packages/agent/src/bootstrap/state-kernel.ts',
  'packages/agent-client/src/client.ts',
];
export const names = {
  settings:
    'P0 logging controller settings retain validation persistence and errors with explicit revision conflicts',
  recent:
    'P0 logging controller recent reads use bounded immutable releasable owner-local snapshots',
  client:
    'P0 logging controller client levels messages contexts and redaction match with strict RPC shape',
  rate: 'P0 logging controller flood rollover reports exact drops without extending the rate window',
  cancellation:
    'P0 logging controller cancellation rejects before side effects and preserves separate owners',
  integration:
    'P0 logging controller successor is wired through real stdio RPC and durable settings restart',
};
export const limitations =
  'Local darwin-arm64 working-tree scoped successor assertions only; releaseEligible=false. Entire frozen LoggingController executes in a restricted VM against verified real frozen LogStore/redactor/shared logging bytes and isolated real files. Nest decorators and BadRequestException are explicit metadata/error stand-ins: no old Nest HTTP server/serialization/middleware is started. Current real SQLite-backed diagnosticLogs handlers and a real child-process stdio state kernel replace controller routes. Settings validation, normalized custom/default directories, nondirectory preservation, exact error identity for unexpected legacy failure, current revision CAS/persistence/restart, read parity/immutability/release/cross-owner rejection, renderer client level fallback/truncation/context/redaction/input rejection, exact 60-message/60000ms boundary/drop-warning rollover, and all six pre-cancelled RPC handlers are asserted. Current strict integer snapshot range 1..1000 replaces permissive legacy string/default/clamp queries; current request shape and 1 MiB maximum are deliberate safety strengthening. Current source is authenticated renderer web or ordinary session client rather than renderer-supplied source. Clock is mocked only in one test process; not exact wall clock performance. Two local owners and same-run stdio/task journal ambiguity tests are not SSH/network/UI subscription or remote mutation end-to-end acceptance. No public HTTP/global reset hook restored, no production code changed. Full P0, current Mac real installation/upgrade/update/rollback, actual pre-migration full backup/recovery, applicable SSH/performance/final release gates remain independent; hosted-only unchanged.';
export const modules = ['P0-DIAGNOSTICS-0434', 'P0-DIAGNOSTICS-0435'].map((scenarioId) => ({
  scenarioId,
  tests: Object.values(names),
  assertion:
    'Execute whole frozen LoggingController and all four methods (settings/save/recent/client), including validation-to-BadRequest mapping and unexpected error identity; exact current successor assertions cover revision/settings persistence, read snapshot lifecycle and ownership, client levels/context/redaction/shape/size and deterministic flood rollover. All six current RPC handlers reject a pre-aborted signal with exact reason before side effects; actual stdio kernel verifies routing and restart. Source/class scoped responsibilities only; decorators are spies and no Nest HTTP server is claimed.',
}));
export const testFiles = [
  testFile,
  'packages/agent/tests/logging.test.cjs',
  'packages/agent/tests/diagnostics.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'packages/agent/tests/collaboration.test.cjs',
  'packages/agent/tests/p0-ai-service-migration.test.cjs',
  'packages/agent/tests/p0-review-service-migration.test.cjs',
  'scripts/archive/agent-acceptance/p0-test-receipts.test.mjs',
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
