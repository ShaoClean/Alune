import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateBindings, validateLedger } from './p0-test-receipts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const sha = '8f30e6bcc0a4b7706c192896a73b87dc1a915ed9';
const testFile = 'packages/agent/tests/p0-migration-boundaries.test.cjs';
const limitation = 'Frozen server implementation is compared with the current Agent migration implementation using isolated synthetic storage/filesystem/transport fixtures. Directly asserted exports and methods only; no whole-module, uncalled helper, controller, browser, real credential or external-host claim.';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const testLines = fs.readFileSync(path.join(root, testFile), 'utf8').split('\n');

function test(name) {
  const matches = testLines.flatMap((line, index) => line.includes(`test('${name}'`) ? [index + 1] : []);
  if (matches.length !== 1) throw Error(`Ambiguous migration test: ${name}`);
  return { file: testFile, name, line: matches[0] };
}

function entries(file, values) {
  return values.map(value => `${value.kind}:${file}:${value.name}`);
}

function binding(file, values, implementation, testName, assertion) {
  return {
    entries: entries(file, values),
    implementation,
    tests: [test(testName)],
    assertion,
    limitations: limitation,
  };
}

const migrationTest = {
  validators: 'P0 migrated token and model validators retain exact values and rejection boundaries',
  settings: 'P0 AI settings direct revision, readability, provider, key and persistence contracts survive migration',
  logValidation: 'P0 log validation and writable-directory probes preserve exact errors without residue',
  logLifecycle: 'P0 log store direct lifecycle, disk append, history reload, rotation and cleanup retain exact effects',
  redaction: 'P0 log redaction direct registration, text and nested context retain secret suppression',
  prActions: 'P0 PR mutation, revision, permission and code payload contracts retain exact refusal states',
  proxySettings: 'P0 proxy direct revision and credential snapshots preserve target binding and corrupt-state refusal',
  terminalRegistry: 'P0 terminal registry direct locking, matching and confirmed removal preserve repository ownership',
  prValidation: 'P0 PR remote, query and creation validators preserve literal values and invalid boundaries',
  prContent: 'P0 PR content normalization preserves complete, partial, binary and discussion projections',
  aiPrompt: 'P0 AI response parsing and prompt bounds preserve exact content and invalid responses',
  sshBuilders: 'P0 SSH proxy and shell builders preserve quoting, local addresses and fail-closed override reads',
};

export function migrationPlan(ledger, progress) {
  validateLedger(ledger);
  if (progress.currentSha !== sha) throw Error('Expected continuation progress at reviewed SHA');
  const rows = new Map(ledger.entries.map(row => [row.id, row]));
  const remaining = new Set(progress.rows.filter(row => row.status === 'needs-explicit-assertion').map(row => row.id));
  const add = (file, values, implementation, testName, assertion) => {
    const row = binding(file, values, implementation, testName, assertion);
    for (const id of row.entries) {
      if (!rows.has(id)) throw Error(`Unknown frozen ID: ${id}`);
      if (!remaining.has(id)) throw Error(`ID is not remaining: ${id}`);
    }
    return row;
  };
  const plans = [];
  plans.push(add('apps/server/src/access-tokens/access-tokens.service.ts', [
    { kind: 'export', name: 'tokenValue' },
  ], ['packages/agent/src/modules/accounts/access-tokens.ts'], migrationTest.validators,
  'The frozen/current token validator is called directly with exact valid, malformed, length, control-character and whitespace inputs.'));
  plans.push(add('apps/server/src/ai/ai-settings.ts', [
    { kind: 'export', name: 'validateModels' }, { kind: 'export', name: 'AiSettingsStore' },
    ...['read', 'assertRevision', 'assertReadable', 'provider', 'key', 'saveProvider', 'saveModels', 'saveCommit', 'persist']
      .map(name => ({ kind: 'method', name: `AiSettingsStore.${name}` })),
  ], ['packages/agent/src/modules/settings/ai.ts'], migrationTest.settings,
  'Both frozen and current settings stores are instantiated and directly exercised for readability, revisions, provider/key access, model/commit updates, persistence, secret omission and corrupt storage.'));
  plans.push(add('apps/server/src/logging/log-store.ts', [
    { kind: 'export', name: 'LogValidationError' }, { kind: 'export', name: 'validateLoggingSettings' },
    { kind: 'export', name: 'assertWritableDirectory' },
  ], ['packages/agent/src/adapters/logging/log-store.ts'], migrationTest.logValidation,
  'Direct validation, writable-directory and error-constructor contracts are compared across frozen/current implementations for literal settings and residue-preserving filesystem probes.'));
  plans.push(add('apps/server/src/logging/log-store.ts', [
    { kind: 'export', name: 'LogStore' },
    ...['resolveDirectory', 'settings', 'update', 'enabled', 'write', 'recent', 'subscribe', 'flush', 'close', 'target', 'append', 'loadHistory', 'cleanup']
      .map(name => ({ kind: 'method', name: `LogStore.${name}` })),
  ], ['packages/agent/src/adapters/logging/log-store.ts'], migrationTest.logLifecycle,
  'The direct lifecycle test compares construction and exact log writes, subscriptions, flush, reload, rotation, cleanup, custom-directory update and idempotent close effects.'));
  plans.push(add('apps/server/src/logging/redact.ts', [
    ...['registerSecret', 'redactText', 'redactContext'].map(name => ({ kind: 'export', name })),
  ], ['packages/agent/src/adapters/logging/redact.ts'], migrationTest.redaction,
  'Secret registration, text redaction and nested context redaction are directly compared for credential-shaped literals and safe values.'));
  plans.push(add('apps/server/src/repository/pull-request-actions.ts', [
    ...['requestRevision', 'assertRevision', 'validateMutation', 'requestActions', 'codeCommentPayload']
      .map(name => ({ kind: 'export', name })),
  ], ['packages/agent/src/modules/reviews/pull-request-actions.ts'], migrationTest.prActions,
  'Each exported PR action/revision/payload function is directly compared across frozen/current implementations for provider, permission, stale revision and literal payload boundaries.'));
  plans.push(add('apps/server/src/proxy/proxy-settings.ts', [
    { kind: 'export', name: 'ProxySettingsStore' },
    ...['read', 'assertRevision', 'snapshot', 'save'].map(name => ({ kind: 'method', name: `ProxySettingsStore.${name}` })),
  ], ['packages/agent/src/modules/settings/proxy.ts'], migrationTest.proxySettings,
  'Both proxy stores are directly exercised for revisions, credential snapshots, target binding, clearing and corrupt-state refusal without exposing stored secrets.'));
  plans.push(add('apps/server/src/terminal/terminal-registry.ts', [
    { kind: 'export', name: 'TerminalRegistry' },
    ...['assertAvailable', 'withoutTerminals', 'matching', 'assertRemovable', 'remove']
      .map(name => ({ kind: 'method', name: `TerminalRegistry.${name}` })),
  ], ['packages/agent/src/modules/terminals/registry.ts'], migrationTest.terminalRegistry,
  'Terminal ownership, matching, removal confirmation, temporary locks and failure recovery are directly compared for synthetic repository/connection scopes.'));
  plans.push(add('apps/server/src/repository/pull-request-remote.ts', [
    { kind: 'export', name: 'pullRequestRemote' },
  ], ['packages/agent/src/modules/reviews/pull-request-remote.ts'], migrationTest.prValidation,
  'Remote URL normalization is directly compared for SSH, HTTPS credentials, aliases, encoded traversal, file schemes and malformed values.'));
  plans.push(add('apps/server/src/repository/pull-requests.service.ts', [
    { kind: 'export', name: 'PULL_REQUEST_TIMEOUT_MS' },
    { kind: 'export', name: 'validatePullRequestQuery' },
    { kind: 'export', name: 'validatePullRequestDetailQuery' },
  ], ['packages/agent/src/modules/reviews/pull-requests.service.ts'], migrationTest.prValidation,
  'Query/detail validators and the declared timeout constant are directly compared for valid, missing, stale, malformed and unsafe query values.'));
  plans.push(add('apps/server/src/repository/pull-request-creation.service.ts', [
    { kind: 'export', name: 'validateCreation' }, { kind: 'export', name: 'validateCreate' },
  ], ['packages/agent/src/modules/reviews/pull-request-creation.service.ts'], migrationTest.prValidation,
  'Creation validators are directly compared for branch, title, reviewer, operation, revision and unsafe-input boundaries.'));
  plans.push(add('apps/server/src/repository/pull-request-center.service.ts', [
    { kind: 'export', name: 'centerQuery' }, { kind: 'export', name: 'centerProjectKey' },
  ], ['packages/agent/src/modules/reviews/pull-request-center.service.ts'], migrationTest.prValidation,
  'Center query normalization and project-key generation are directly compared for malformed values, trimming, sorting and provider/path normalization.'));
  plans.push(add('apps/server/src/repository/pull-request-content.ts', [
    ...['text', 'count', 'normalizeFile', 'normalizeDiscussion'].map(name => ({ kind: 'export', name })),
  ], ['packages/agent/src/modules/reviews/pull-request-content.ts'], migrationTest.prContent,
  'Content and discussion normalizers are directly compared for complete, partial, binary, renamed, oversized, provider-specific and malformed records.'));
  plans.push(add('apps/server/src/ai/ai-provider.ts', [
    { kind: 'export', name: 'parseCommit' },
  ], ['packages/agent/src/adapters/providers/ai-provider.ts'], migrationTest.aiPrompt,
  'Commit response parsing is directly compared for JSON, fenced JSON, whitespace, malformed, newline and length-boundary responses.'));
  plans.push(add('apps/server/src/ai/pull-request-prompt.ts', [
    { kind: 'export', name: 'parsePullRequest' }, { kind: 'export', name: 'pullRequestPrompt' },
  ], ['packages/agent/src/modules/ai/pull-request-prompt.ts'], migrationTest.aiPrompt,
  'Pull-request parsing and prompt construction are directly compared for malformed data, exact trimming and bounded/truncated large previews.'));
  plans.push(add('packages/ssh-client/src/proxy-git.ts', [
    { kind: 'export', name: 'isLoopbackAddress' }, { kind: 'export', name: 'sshProxyCommand' },
    { kind: 'export', name: 'proxyGitArguments' },
  ], ['packages/agent/src/adapters/ssh/proxy-git.ts'], migrationTest.sshBuilders,
  'Loopback classification, SSH proxy command generation and fail-closed proxy Git arguments are directly compared with inert synthetic connection output.'));
  plans.push(add('packages/ssh-client/src/terminal-shell.ts', [
    { kind: 'export', name: 'terminalShellCommands' },
  ], ['packages/agent/src/adapters/ssh/terminal-shell.ts'], migrationTest.sshBuilders,
  'Terminal shell command builders are directly compared for POSIX, Windows, UNC, newline, Unicode, NUL and literal metacharacter paths.'));
  const ids = plans.flatMap(row => row.entries);
  if (new Set(ids).size !== ids.length) throw Error('Duplicate migration binding');
  return {
    schemaVersion: 1,
    sha,
    reviewedTooling: { [testFile]: hash(fs.readFileSync(path.join(root, testFile))) },
    bindings: plans,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [ledgerFile, progressFile, output] = process.argv.slice(2);
  if (!output) throw Error('Usage: p0-server-migration-plan.mjs LEDGER PROGRESS NEW_PLAN');
  const ledger = JSON.parse(fs.readFileSync(ledgerFile));
  const progress = JSON.parse(fs.readFileSync(progressFile));
  const plan = migrationPlan(ledger, progress);
  validateBindings(ledger, plan);
  fs.writeFileSync(output, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ bindings: plan.bindings.length, ids: new Set(plan.bindings.flatMap(row => row.entries)).size }));
}
