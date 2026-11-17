export const batch = 'docs/acceptance/issue-257-258/batch-05-bootstrap-session-20261113';
export const prior = 'docs/acceptance/issue-257-258/batch-04-storage-lifecycle-20261113/replay-03';
export const testFile = 'packages/agent/tests/p0-bootstrap-session.test.cjs';
export const modules = [
  [
    '0131',
    'root controller greeting is replaced by initialized health dispatch',
    'Full frozen root controller file and its only method reviewed and executed in a restricted VM; actual Agent CLI refuses pre-initialize health, dispatches exact session health after initialize, refuses obsolete getHello and nonempty health params. Greeting/HTTP root is intentionally retired; scoped health responsibility replacement only.',
  ],
  [
    '0132',
    'root controller export has no uninitialized or foreign Agent authority',
    'Complete frozen AppController constructor and sole getHello delegation executed; successor uses initialized stdio dispatch. Two real temporary Agents have different identities/sessions, and an actual registered repository from the second Agent is refused by the first before execution.',
  ],
  [
    '0138',
    'root service greeting successor reports exact health and application version',
    'Complete frozen service file, exported class and its only method reviewed/executed; stateless Hello World greeting is replaced by exact Agent health, implementation/version from root application version and negotiated protocol. No Nest/global service or HTTP greeting compatibility claim.',
  ],
  [
    '0139',
    'root service ownership survives restart without reusing session identity',
    'Entire frozen stateless AppService export and getHello surface inspected/executed; successor reports exact initialized Agent/session health. Real CLI EOF exit is clean, writer reopens, persisted Agent identity survives and session identity changes.',
  ],
].map(([suffix, title, assertion]) => ({
  scenarioId: 'P0-BOOTSTRAP-' + suffix,
  name: 'P0-BOOTSTRAP-' + suffix + ' ' + title,
  assertion,
}));
export const unresolved = [
  {
    scenarioId: 'P0-BOOTSTRAP-0141',
    reason:
      'Whole bootstrap.ts includes all ServerOptions, Nest creation, HTTP/socket bearer authorization or CORS, body-parser limits, static cache/SPA routing, terminal configuration, listen/log and startup-failure cleanup. This batch verifies only Agent stdio lifecycle; no whole-file pass.',
  },
  {
    scenarioId: 'P0-BOOTSTRAP-0143',
    reason:
      'The complete startServer export includes HTTP/static/auth/socket and injected-secret behavior as well as cleanup. Agent close regression and CLI signal tests cover only lifecycle successors; they do not establish all startServer responsibilities.',
  },
  {
    scenarioId: 'P0-BOOTSTRAP-0460',
    reason:
      'The frozen main.ts installs uncaughtExceptionMonitor with origin/error diagnostics, starts HTTP, enables Nest shutdown hooks and prints a URL. Agent EOF/signals, malformed input and private-host refusal are verified, but default uncaught exception monitoring/log persistence and hosted web startup have not been validated as replacements.',
  },
];
export const implementation = [
  'packages/agent/src/server/session.ts',
  'packages/agent/src/bootstrap/stdio.ts',
  'packages/agent/src/cli/main.ts',
  'packages/agent/bin/alune-agent.cjs',
  'packages/agent-client/src/stdio.ts',
  'packages/agent-client/src/client.ts',
  'packages/agent-client/src/process.ts',
  'packages/protocol/src/methods.ts',
];
export const limitations =
  'Scoped successor assertions for the retired root greeting/controller/service on dirty darwin-arm64 sources. Full frozen files and sole methods are reviewed; Hello World and HTTP root are intentionally not restored. Real temporary CLI/SQLite and real in-process stream transports only; no daily data, physical SSH, hosted HTTP/socket/static/auth replacement, OS secrets, installed/upgrade/rollback or release acceptance. Old and current source fingerprints remain separate; releaseEligible=false.';
export const regression =
  'P0 bootstrap reentrant close waits for actual disposal and shares its promise';
export const lifecycleTests = [
  regression,
  'P0 bootstrap CLI EOF and signals release writer without stdout pollution',
  'P0 bootstrap malformed frames fail and incompatible major cannot initialize or obtain health',
  'P0 bootstrap disposal errors and deadline retain failed shutdown outcomes',
  'P0 bootstrap serve-ui refuses a missing private host before creating state',
];
