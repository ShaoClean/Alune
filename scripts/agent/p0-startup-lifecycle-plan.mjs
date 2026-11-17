import {
  implementation as earlierImplementation,
  lifecycleTests as earlierTests,
  modules as earlierModules,
} from './p0-startup-options-plan.mjs';
export const batch = 'docs/acceptance/issue-257-258/batch-08-startup-lifecycle-20261113';
export const prior = 'docs/acceptance/issue-257-258/batch-07-startup-options-20261113/replay-01';
export const testFile = 'packages/agent/tests/p0-startup-lifecycle.test.cjs';
export const fixtureFile = 'packages/agent/tests/startup-lifecycle-fixture.cjs';
export const companionTestFile = 'packages/agent/tests/p0-startup-options.test.cjs';
export const devTestFile = 'apps/web/tests/integration/p0-startup-auth.test.mjs';
export const secretTestFile = 'packages/agent/tests/p0-module-secrets.test.cjs';
export const modules = [
  [
    '0141',
    'complete startup source rejects malformed and oversized frames without losing its host',
    'Complete frozen bootstrap source with allowlisted Nest/Express/IoAdapter dependencies is inventoried and executed, including options, bearer/socket adapter, both parser registrations, static/fallback decisions, listen/getUrl diagnostics and failure cleanup. Successors execute actual desktop HTTP/IPC and Agent source: UTF-8 exact 8MiB parent frame boundary reaches schema validation; +1 rejects; malformed frames end only their session. All lifecycle, large multi-reword and prior options/auth/security tests are mandatory bindings. Explicit retirement of HTTP/Nest/Socket.IO and replaced budgets, not old endpoint compatibility.',
  ],
  [
    '0143',
    'complete startup responsibilities have explicit bounded lifecycle successors',
    'Whole frozen startServer default/configured, middleware/listen/getUrl failures and cleanup are executed with explicit dependency doubles. Actual successor tests cover early token/manifest/migration refusal, real EADDRINUSE, HTTP construction/partial IPC rollback, shared idempotent shutdown, half-open socket/handler/child/writer cleanup, error aggregation, same-directory restart, role/Host/auth/static confinement and diagnostics channel. Five actual Git rewords carry escaped Unicode in one >100KiB <1MiB request with each message <=32KiB; persisted receipt is queryable after host restart and never replayed. General RPC schema and frame budgets deliberately replace old HTTP JSON parsers.',
  ],
].map(([suffix, title, assertion]) => ({
  scenarioId: 'P0-BOOTSTRAP-' + suffix,
  name: 'P0-BOOTSTRAP-' + suffix + ' ' + title,
  assertion,
}));
export const unresolved = [];
export const implementation = [
  ...earlierImplementation,
  'packages/protocol/src/methods.ts',
  'packages/domain/src/rebase.ts',
  'packages/agent-client/src/ui-host.ts',
  'packages/agent/src/modules/git/interactive-rebase.ts',
];
export const limitations =
  'Working-tree local darwin-arm64 scoped replacement only, releaseEligible=false. Frozen complete bootstrap executes in restricted VM using explicit Nest/Express/IoAdapter/logger doubles, not the old live server or old Express body parsing. Actual desktop bytes run with synthetic manifest/assets, Electron/migration/safeStorage doubles and real HTTP/IPC/Agent/SQLite/Git; construction/registration/removal and proxy cleanup faults are explicit injections (proxy fetch performs no network). Listen EADDRINUSE and half-open socket are real. 8MiB is the new framing budget, not a claim of 1MiB HTTP or 32KiB per-message compatibility removal. Stable symlink confinement only. Installed Electron header injection, actual OS credentials/migration, global main exception diagnostics 0460/0008, SSH/installation/update/rollback and complete release gates remain independent. Prior receipts retain original fingerprints.';
export const lifecycleTests = [
  'P0 lifecycle rolls back partial IPC registration and permits a fresh start',
  'P0 lifecycle reclaims the Agent when HTTP server construction throws',
  'P0 lifecycle close is shared and removes handlers channels sockets and writer lock',
  'P0 lifecycle preserves startup failures and releases real listen and migration failures',
  'P0 lifecycle cleanup failures retain the original startup error and still release the Agent',
  'P0 lifecycle proxy cleanup errors still release channels HTTP handlers and the Agent',
  'P0 lifecycle ordinary desktop surfaces startup rejection to stderr dialog and failure exit',
  ...earlierModules.map((m) => m.name),
  ...earlierTests,
];
