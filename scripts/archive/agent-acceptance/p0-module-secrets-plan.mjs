export const batch = 'docs/acceptance/issue-257-258/batch-06-module-secrets-20261113';
export const prior = 'docs/acceptance/issue-257-258/batch-05-bootstrap-session-20261113/replay-03';
export const testFile = 'packages/agent/tests/p0-module-secrets.test.cjs';
export const modules = [
  [
    '0135',
    'full module registration maps every static and dynamic dependency to scoped Agent composition',
    'Entire frozen AppModule file and static decorator imports/controllers/providers plus complete register method executed in an allowlisted VM. Every static and dynamic dependency is explicitly mapped to live Agent capabilities; disposable Agent runs core health, storage, repository/Git, files/terminals/logging/settings and events smoke. Composition assertion only; individual module business behavior and Nest/HTTP/socket compatibility are not claimed.',
  ],
  [
    '0136',
    'module instances isolate Agent authority and negotiate their actual handler sets',
    'Complete frozen AppModule export surface inspected and executed by the companion composition test. Real local, independent and remote-mode kernels expose their own handler sets and protocol minor filters; repository authority does not cross Agent instances, native/private and secret reads are absent from stdio. Remote-mode runs locally and is not physical SSH validation.',
  ],
  [
    '0137',
    'registration shares one protected cipher for AI and proxy and retains it across restart',
    'Complete frozen AppModule.register with omitted and two distinct injected secret dependencies executed; old Secrets/Proxy/AI registration factories checked with explicit synthetic dependencies. Live successor fixes registration option capture, shares an actual file-backed protected cipher for AI/proxy, encrypts and reopens both, rejects RPC backend selection and persisted backend mismatch without fallback or replacement. No OS Keychain/DPAPI, plaintext legacy secret compatibility or arbitrary injected storage API preservation claimed.',
  ],
].map(([suffix, title, assertion]) => ({
  scenarioId: 'P0-BOOTSTRAP-' + suffix,
  name: 'P0-BOOTSTRAP-' + suffix + ' ' + title,
  assertion,
}));
export const unresolved = [];
export const implementation = [
  'packages/agent/src/bootstrap/settings-kernel.ts',
  'packages/agent/src/bootstrap/state-kernel.ts',
  'packages/agent/src/bootstrap/collaboration.ts',
  'packages/agent/src/bootstrap/repositories-kernel.ts',
  'packages/agent/src/bootstrap/terminals.ts',
  'packages/agent/src/bootstrap/hosts.ts',
  'packages/agent/src/bootstrap/ui.ts',
  'packages/agent/src/modules/files/access.ts',
  'packages/agent/src/modules/diagnostics/logs.ts',
  'packages/agent/src/modules/settings/ai.ts',
  'packages/agent/src/modules/settings/proxy.ts',
  'packages/agent/src/adapters/secrets/protected.ts',
  'packages/agent/src/server/session.ts',
  'packages/agent-client/src/client.ts',
  'packages/protocol/src/methods.ts',
];
export const limitations =
  'Working-tree darwin-arm64 scoped module-registration replacement only. Frozen Nest registration executes in an allowlisted VM with explicit dependency doubles; new composition uses actual temporary SQLite, Git, framed streams and file-backed protected credentials. Exact capability presence and selected live smoke do not validate all domain behavior. Old global DI, HTTP/socket/SPA/auth, ServerOptions, main diagnostics, actual OS secrets, physical SSH, installation/update/rollback and other platforms remain outside this batch. Historical receipts are not release evidence; releaseEligible=false.';
export const regression =
  'P0 module secret registration captures backend options before lazy initialization';
export const lifecycleTests = [
  regression,
  'P0 module unavailable registered backend refuses fallback without replacing existing credentials',
];
