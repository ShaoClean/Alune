export const batch = 'docs/acceptance/issue-257-258/batch-07-startup-options-20261113';
export const prior = 'docs/acceptance/issue-257-258/batch-06-module-secrets-20261113/replay-05';
export const testFile = 'packages/agent/tests/p0-startup-options.test.cjs';
export const devTestFile = 'apps/web/tests/integration/p0-startup-auth.test.mjs';
export const secretTestFile = 'packages/agent/tests/p0-module-secrets.test.cjs';
export const modules = [
  [
    '0142',
    'all six startup options have explicit local successors or retirement boundaries',
    'Exact frozen ServerOptions optional fields and types inspected; frozen startServer executes with omitted and configured options in a restricted VM. Actual desktop HTTP ephemeral loopback, confined static/SPA, mandatory bearer/Host, private roles and CLI legacy-option refusal tested. Real file-backed protected cipher/AI restart and RPC backend refusal re-executed by the bound 0137 test. Arbitrary host/port/webRoot/Nest injected storage/desktop boolean options are intentionally retired, with explicit successors; no old API type compatibility or whole startServer claim.',
  ],
  [
    '0144',
    'complete socket bearer adapter is replaced by guarded IPC and origin-bound dev sessions',
    'Complete frozen DesktopSocketAdapter.createIOServer runs via actual frozen source with explicit IoAdapter double; inherited options, allowRequest override, exact token truth table and callback count asserted. Real desktop HTTP/IPC and real disposable Agent test main-frame owner/origin, generation, navigation revocation, pre-initialize and direct raw role denials. Actual Vite/WebSocket gateway rejects missing/wrong invitations, origins/Host and native paths; independent valid-ID raw peers prove server privilege refusal. Socket.IO transport/options are intentionally retired, not restored.',
  ],
].map(([suffix, title, assertion]) => ({
  scenarioId: 'P0-BOOTSTRAP-' + suffix,
  name: 'P0-BOOTSTRAP-' + suffix + ' ' + title,
  assertion,
}));
export const unresolved = [];
export const implementation = [
  'apps/desktop/src/desktop-agent.cjs',
  'apps/desktop/src/main.cjs',
  'apps/desktop/src/workspace-preferences.cjs',
  'apps/desktop/src/agent-window-channel.cjs',
  'apps/web/agent-dev.ts',
  'apps/web/vite.config.ts',
  'packages/agent/src/cli/main.ts',
  'packages/agent/src/bootstrap/ui.ts',
  'packages/agent/src/bootstrap/state-kernel.ts',
  'packages/agent/src/bootstrap/settings-kernel.ts',
  'packages/agent/src/adapters/secrets/protected.ts',
  'packages/agent-client/src/ui-host.ts',
  'packages/agent/src/server/session.ts',
  'packages/agent-client/src/frame-channel.ts',
  'packages/protocol/src/messages.ts',
];
export const limitations =
  'Working-tree darwin-arm64 scoped options/authentication replacement only. Frozen entire startup file executes against explicit Nest/Express/IoAdapter doubles. Actual desktop module runs with synthetic manifest/assets and Electron/migration/safeStorage doubles; its HTTP/IPC, supervised Agent and actual Vite/WebSocket are real disposable processes. Stable asset symlink containment only, not hostile concurrent mutation of installed application files. No actual Electron header injection, OS Keychain, legacy import, installed/update/rollback, physical SSH, main diagnostics or complete startServer/source pass. Historical receipts remain at their original fingerprints; releaseEligible=false.';
export const regression =
  'P0 startup rejects an absent or malformed desktop bearer before side effects';
export const lifecycleTests = [
  regression,
  'P0 startup serves only confined assets and reserves exact retired API routes',
  'P0 startup confines asset symlinks to the packaged web root',
  'P0 startup development gateway enforces loopback invitation origin host and workspace roles',
  'P0-BOOTSTRAP-0137 registration shares one protected cipher for AI and proxy and retains it across restart',
];
