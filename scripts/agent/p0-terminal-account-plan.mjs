// Reviewed migration assertions; no coverage/name-based inference or retired
// Socket.IO implementation is reintroduced into the application.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateBindings, validateLedger } from './p0-test-receipts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = '8f30e6bcc0a4b7706c192896a73b87dc1a915ed9';
const terminalTest = 'packages/agent/tests/p0-terminal-migration.test.cjs';
const accountTest = 'packages/agent/tests/p0-account-migration.test.cjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const names = {
  creation: 'P0 terminal identifiers, dimensions and creation refusal retain frozen boundaries',
  lifecycle: 'P0 terminal state, output ACK, input, resize and confirmed removal survive migration',
  output: 'P0 terminal Unicode output, backpressure and bounded input retain exact data',
  ownership: 'P0 terminal duplicate requests, per-owner limit and foreign operations are refused',
  stopped: 'P0 terminal exit, disconnect, overflow and startup failures preserve explicit stopped states',
  shutdown: 'Agent terminal shutdown awaits a late startup and its asynchronous transport disposal',
  handlers: 'Agent terminal handlers replace gateway commands with session-owned validated RPCs',
  timeouts: 'P0 terminal startup and parser ACK timeouts stop only their own sessions',
  transactions: 'P0 token revisions, transactions and notifications preserve atomic failure boundaries',
  bindings: 'P0 token binding, credential snapshots and remote changes retain target isolation',
  unreadable: 'P0 token unreadable secrets preserve rows and refuse credential rebinding',
  migration: 'P0 imported token migration rewraps every row atomically and retains failed originals',
};
const terminalInputs = [
  'packages/agent/src/modules/terminals/index.ts',
  'packages/agent/src/modules/terminals/sessions.ts',
  'packages/agent/src/modules/terminals/registry.ts',
  'packages/agent/src/modules/terminals/handlers.ts',
  'packages/agent/src/ports/terminal.ts',
  'packages/protocol/src/terminals.ts',
  'packages/domain/src/terminal.ts',
];
const accountInputs = [
  'packages/agent/src/modules/accounts/access-tokens.ts',
  'packages/agent/src/adapters/sqlite/access-tokens.ts',
  'packages/agent/src/adapters/migration/legacy-tokens.ts',
  'packages/agent/src/ports/state.ts',
  'packages/agent/src/ports/settings-errors.ts',
];
function test(file, name) {
  const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
  const found = lines.flatMap((line, index) => line.includes(`test('${name}'`) ? [index + 1] : []);
  if (found.length !== 1) throw Error('Missing or ambiguous exact assertion: ' + name);
  return { file, name, line: found[0] };
}
export function terminalAccountPlan(ledger, progress) {
  validateLedger(ledger);
  if (progress.currentSha !== sha) throw Error('Unexpected reviewed progress SHA');
  const remaining = new Set(progress.rows.filter(row => row.status === 'needs-explicit-assertion').map(row => row.id));
  const bindings = [];
  const add = (file, ids, testKeys, assertion, terminal = true) => {
    const entries = ids.map(([kind, name]) => `${kind}:${file}:${name}`);
    if (entries.some(id => !remaining.has(id))) throw Error('Binding is not an unasserted P0 ID');
    bindings.push({ entries, tests: testKeys.map(key => test(terminal ? terminalTest : accountTest, names[key])),
      implementation: terminal ? terminalInputs : accountInputs, assertion,
      limitations: terminal
        ? 'Immutable P0 service/gateway and current Agent session/RPC behavior with a controlled PTY port. Verifies only the named lifecycle, ownership, transport-boundary and event assertions. Does not certify real PTY processes, SSH, browser interactions, full module signatures or retired Socket.IO wire compatibility.'
        : 'Immutable P0 and current Agent code on disposable in-memory SQLite and synthetic ciphers. Named transactions, bindings, notifications and rollback assertions only; not real Keychain, full legacy Agent import, installed upgrade or recovery acceptance.' });
  };
  const service = 'apps/server/src/terminal/terminal.service.ts';
  const methods = values => values.map(name => ['method', `TerminalService.${name}`]);
  add(service, [['export', 'validTerminalId'], ...methods(['create'])], ['creation', 'ownership'],
    'Valid/invalid UUIDs, authenticated availability, dimensions, duplicate IDs and the exact eight-session per-window limit are asserted against frozen and current implementations.');
  add(service, [['export', 'TerminalService'], ...methods(['start', 'state', 'output', 'pump', 'ack', 'input', 'resize', 'close', 'owned'])], ['lifecycle', 'output', 'ownership'],
    'Both constructors run. Exact state/output packets, Unicode reconstruction and packet bounds, parser ACK gating, input/resize effects, immutable owner-filtered state, foreign-owner refusals and confirmed removal are asserted.');
  add(service, methods(['finish', 'remove', 'disconnect', 'dispose', 'onModuleDestroy']), ['stopped', 'ownership', 'shutdown', 'timeouts'],
    'Exit, startup failure, overflow, disconnect and both timeout paths assert terminal states and single disposal. All owner sessions are removed; Agent shutdown additionally waits for late startup and asynchronous disposal.');
  add(service, [
    ['channel', 'entry.owner.emit:terminal:state:184'],
    ['channel', 'entry.owner.emit:terminal:output:234'],
    ['channel', 'entry.owner.emit:terminal:removed:316'],
  ], ['lifecycle', 'output', 'handlers'],
    'The exact frozen state/output/removal payloads are asserted; current RPC event emission attaches the owning repository resource and omits undefined fields. Socket.IO itself is retired.');
  const gateway = 'apps/server/src/terminal/terminal.gateway.ts';
  add(gateway, [['export', 'TerminalGateway'], ...['afterInit', 'handleDisconnect', 'reply', 'create', 'input', 'resize', 'ack', 'close'].map(name => ['method', `TerminalGateway.${name}`]),
    ...['create', 'input', 'resize', 'ack', 'close'].map(name => ['socket-handler', 'terminal:' + name])], ['handlers', 'ownership'],
    'Frozen gateway commands, success/error replies, authentication and disconnect delegation execute directly. Their Agent replacements enforce protocol 1.4, non-durable session ownership, subscription and resource checks, exact command arguments and structured refusal.');
  const accounts = 'apps/server/src/access-tokens/access-tokens.service.ts';
  const accountMethods = values => values.map(name => ['method', `AccessTokensService.${name}`]);
  add(accounts, [['export', 'AccessTokensService'], ...accountMethods(['revision', 'bump', 'changed', 'mutate', 'row'])], ['transactions'],
    'Both stores construct their schema-backed state and directly exercise revision reads, explicit bump/notification, stale mutation, transaction rollback, row lookup and nonsecret listing.', false);
  add(accounts, accountMethods(['binding', 'reconcile', 'selection', 'apply', 'decrypt', 'credential']), ['bindings', 'unreadable'],
    'Direct binding/decryption/credential calls assert target isolation, exact selection states, stale snapshot refusal, irreversible observed target changes and failed-credential rollback.', false);
  add(accounts, [['channel', 'this.events.server.emit:access-tokens:changed:96']], ['transactions', 'bindings'],
    'Frozen store notifications and the Agent change callback are counted: failed/no-op transactions do not notify, successful changes do. This is the store boundary, not an end-to-end broadcast claim.', false);
  const migration = 'apps/server/src/access-tokens/access-token-migration.ts';
  add(migration, [['export', 'migrateImportedAccessTokens']], ['migration'],
    'Both standalone migration functions rewrap two rows and rotate revisions atomically. Unavailable keys, second-row encryption failure and SQL commit failure preserve every original row and revision; successful reruns are idempotent.', false);
  const ids = bindings.flatMap(row => row.entries);
  if (new Set(ids).size !== ids.length) throw Error('Duplicate migration binding');
  const plan = { schemaVersion: 1, sha, reviewedTooling: Object.fromEntries([terminalTest, accountTest]
    .map(file => [file, hash(fs.readFileSync(path.join(root, file)))])), bindings };
  validateBindings(ledger, plan);
  return plan;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [ledgerFile, progressFile, output] = process.argv.slice(2);
  if (!output) throw Error('Usage: p0-terminal-account-plan.mjs LEDGER PROGRESS NEW_PLAN');
  const plan = terminalAccountPlan(JSON.parse(fs.readFileSync(ledgerFile)), JSON.parse(fs.readFileSync(progressFile)));
  fs.writeFileSync(output, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ bindings: plan.bindings.length, ids: plan.bindings.flatMap(row => row.entries).length }));
}
