export const batch = 'docs/acceptance/issue-257-258/batch-24-nest-logger-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-23-event-contract-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-nest-logger.test.cjs';
export const implementation = [
  'packages/agent/src/adapters/logging/log-store.ts',
  'packages/agent/src/adapters/logging/redact.ts',
  'packages/agent/src/adapters/logging/index.ts',
  'packages/agent/src/modules/diagnostics/logs.ts',
  'packages/agent/src/bootstrap/state-kernel.ts',
  'packages/agent/src/server/session.ts',
];
export const names = {
  source:
    'P0 Nest logger entire frozen source and class include every private helper and public override',
  record:
    'P0 Nest record normalizes all message kinds and documents serialization and severity failures',
  log: 'P0 Nest log demotes exactly the five framework contexts and retains explicit console argument order',
  error:
    'P0 Nest error preserves independent stack and context optional arguments and records redacted stack',
  overrides:
    'P0 Nest warn debug verbose and fatal retain exact levels context and failure ordering',
  kernel:
    'P0 Nest migrated recording uses production kernel levels redaction disk filtering and restart without framework console',
  owners:
    'P0 Nest successor diagnostics isolate owners snapshot handles and pre-cancelled writes without invented retry',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped migrated-responsibility acceptance only; releaseEligible=false. Entire frozen nest-logger.ts, logger.ts, LogStore, redactor and logging constants execute exact Git bytes in restricted VMs using disposable real files; ConsoleLogger is an explicit method spy, not actual Nest rendering or console redaction. Every private helper/public override is exercised, including all message types, startup context matching, stack/context optionality and console-before-record failure ordering. Nest class/superclass output, startup context demotion and verbose/fatal aliases are explicitly retired: successor does not implement a Nest bridge or arbitrary-object serializer; test explicitly supplies normalized string/level/source/context to the real private desktop.log handler of openStateKernel. Current real SQLite/kernel/log files retain normalized record semantics, level filtering, redaction and restart; malformed severity/types rejected. Direct trusted desktop handler is not a cancellation boundary; separate public diagnostics handler tests pre-cancel before side effects. Cross-owner snapshots/independent close checked with two local production kernels; unchanged same-run actual stdio and durable task tests establish public transport/restart/no-replay separately. Logging receipts remain non-durable; no claimed exactly-once log delivery or retry after uncertain result. No live Nest server/Socket.IO/React/DOM/Electron, console format, SSH, arbitrary remote host, installation/update/rollback, full backup/recovery or performance claim. Only nine exact original source/class/method IDs 0447..0455 credited; no already accepted logger/store/module IDs. UI 1943/1944, apps/server independent retirement failure, full P0/current Mac product release gates remain. Hosted-only requirements unchanged.';
const common = [names.kernel, names.owners];
export const modules = [
  {
    scenarioId: 'P0-DIAGNOSTICS-0447',
    tests: Object.values(names),
    assertion:
      'Review complete source: three imports, text helper and sole class with all seven methods. Execute every method/message conversion, context/stack branch, filtering and failure order against actual frozen logger/store. Current production kernel retains only explicit normalized recording; Nest console inheritance/startup noise and aliases intentionally retired. Whole-file scoped migrated responsibility only, not Nest API compatibility.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-0448',
    tests: Object.values(names),
    assertion:
      'Instantiate complete frozen AluneNestLogger and verify superclass identity, exact prototype and all overrides; full class behavior and errors checked. Current owner-local production kernel/log files replace framework class; no class/export/console compatibility promised.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-0449',
    tests: [names.record, names.error, ...common],
    assertion:
      'Private record executes INFO/WARN/DEBUG/ERROR dispatch, Error/string/JSON/null/array/number/boolean/undefined/symbol/function conversion, context prefix and optional stack; circular/bigint/throwing serializer/unsupported severity fail without rows. Current normalized typed records preserve real disk redaction/filtering/restart; arbitrary object conversion is retired rather than accepted as an RPC.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-0450',
    tests: [names.log, ...common],
    assertion:
      'Frozen log forwards exact original message/context before recording; exactly five case-sensitive substring framework contexts map to DEBUG, normal/absent/empty contexts to INFO; default threshold suppresses startup records only. Successor takes explicit severity and filters DEBUG; framework context detection and Nest console output retired.',
  },
  {
    scenarioId: 'P0-DIAGNOSTICS-0451',
    tests: [names.error, ...common],
    assertion:
      'Frozen error keeps undefined versus empty stack/context console arguments, ERROR level, Error.message, optional structured stack and nest prefix; disk message/stack redacted. Current normalized ERROR/stack retained in real private kernel log storage/restart; actual superclass console output and arbitrary Error conversion are outside successor RPC.',
  },
  ...[
    ['0452', 'warn', 'WARN'],
    ['0453', 'debug', 'DEBUG'],
    ['0454', 'verbose', 'DEBUG'],
    ['0455', 'fatal', 'ERROR'],
  ].map(([id, method, level]) => ({
    scenarioId: 'P0-DIAGNOSTICS-' + id,
    tests: [names.overrides, ...common],
    assertion: `Frozen ${method} forwards unchanged message and optional truthy context to superclass, then records ${level} with exact source; failure ordering and logger store-failure containment checked. Current explicit ${level} normalized records retain filtering/redaction/disk/restart; framework method alias and console inheritance retired. Fatal is a severity mapping, not a process exit.`,
  })),
];
export const testFiles = [
  testFile,
  'packages/agent/tests/logging.test.cjs',
  'packages/agent/tests/diagnostics.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'packages/agent/tests/p0-logging-boundaries.test.cjs',
  'scripts/agent/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'logging settings use durable revisions and reject stale or invalid saves',
  'immutable log snapshots cross UTF-8 chunk boundaries, redact ciphertext and publish bounded invalidations',
  'renderer log flood is rate limited and stale snapshot handles fail explicitly',
  'corrupt logging configuration stays intact and valid replacement is refused until recovery',
  'mutation receipts survive process restart without storing parameters or operation results',
  'crashed mutations become unknown and an identical request is never executed again',
  'P0 logging real stdio Agent flushes INFO on EOF and isolates snapshots across sessions',
];
