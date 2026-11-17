export const prior = 'docs/acceptance/issue-257-258/batch-03-shared-foundations-20261113/replay-03';
export const testFile = 'packages/agent/tests/p0-storage-lifecycle.test.cjs';
export const modules = [
  [
    '0180',
    'database module successor owns durable private WAL state',
    'Complete old database module reviewed: isolated factory WAL/foreign-key values compared with AgentState; current private persisted generation reopens without lost JSON. Explicit Agent directory replaces environment/home default and schema initialization gains integrity checks.',
  ],
  [
    '0181',
    'database provider has explicit agent ownership and exclusive lifecycle',
    'Entire old global DATABASE provider metadata and export reviewed; new explicit AgentState ownership, durable status, competing writer refusal, foreign Agent refusal and independent host resource identities. No Nest DI/runtime compatibility claim.',
  ],
  [
    '0182',
    'database service successor retains SQL errors and atomic rollback',
    'Whole old service method/getter inventory reviewed with all methods separately asserted; same real SQLite binding port refuses SQL errors, rolls back duplicate-write transaction atomically, and remains usable. No arbitrary SQL service restored.',
  ],
  [
    '0183',
    'database service raw handle remains an internal port',
    'Entire exported class constructor/getter/method surface is bound to all SQL/error/shutdown assertions, not only its name or getter. Frozen getter retains raw handle identity; successor owned handle is internal. Actual kernel storage handlers expose only status and database-only backup, reject SQL parameters, and do not expose paths/handles in status.',
  ],
  [
    '0184',
    'database shutdown closes handles and rejects captured ports',
    'Real old onModuleDestroy closes connection; successor repeated close shares a promise, closes SQL handle and captured document/resource/task ports, rejects backup, releases writer for restart and preserves committed JSON. Failed startup and owned cleanup failure also release writer.',
  ],
  [
    '0185',
    'database run preserves bindings changes and constraint refusal',
    'Old run versus current internal prepare.run: positional/named parameters, Unicode/NUL/SQL-looking bound text, BLOB/null, exact rowid and changes, zero-row deletion and duplicate constraint refusal.',
  ],
  [
    '0186',
    'database get preserves absent null binary and first row values',
    'Old get versus current internal prepare.get: absent undefined, first ordered row, exact null/BLOB/Unicode/integer fields and named binding; SQL failure remains visible.',
  ],
  [
    '0187',
    'database all preserves empty ordered and parameterized result sets',
    'Old all versus current internal prepare.all: empty array, complete ordered multiple rows, positional and named filtering and SQL failure.',
  ],
].map(([suffix, title, assertion]) => ({
  scenarioId: 'P0-STORAGE-' + suffix,
  name: 'P0-STORAGE-' + suffix + ' ' + title,
  assertion,
}));
export const unresolved = ['P0-PROTOCOL-2241', 'P0-PROTOCOL-2299', 'P0-PROTOCOL-2305'];
export const limitations =
  'Scoped internal storage successor assertions on exact dirty darwin-arm64 sources; frozen Nest metadata/service run only in an allowlisted VM on disposable databases. Public SQL/Nest services remain retired. Old default data path and schema differ intentionally: no daily data, OS secrets, external network, actual migration, complete bootstrap, physical SSH, installation/upgrade/rollback or release acceptance. Historical receipts retain prior source fingerprints and are not merged into current release evidence.';
export const implementation = [
  'packages/agent/src/adapters/sqlite/state.ts',
  'packages/agent/src/bootstrap/state-kernel.ts',
  'packages/agent/src/ports/state.ts',
  'packages/protocol/src/storage.ts',
];
export const eventDifferences = [
  {
    name: 'CommandOutputEvent',
    topic: 'commands.output',
    fields: {
      connectionId: 'AgentEvent.agentId (owning Agent identity)',
      repositoryId: 'AgentEvent.resource.resourceId with resource.agentId',
      command: 'CommandOutput.command display text; executable/args remain separate',
      data: 'CommandOutput.base64 original bytes; incremental TextDecoder only in UI callback',
      type: 'CommandOutput.stream',
    },
    blocker:
      'No legacy type export. Sequenced scoped bytes replace text-only payload; runtime semantics were narrowly exercised in batch-02, not a literal whole-module replacement.',
  },
  {
    name: 'CommandExitEvent',
    topic: 'commands.exit',
    fields: {
      connectionId: 'AgentEvent.agentId',
      repositoryId: 'AgentEvent.resource.resourceId',
      command: 'CommandExit.command',
      exitCode: 'number | null with signal; numeric callback only when non-null',
    },
    blocker:
      'No legacy type export; interruption has no numeric exit. Restoring old number-only interface would erase unknown/signal semantics.',
  },
  {
    name: 'ConnectionStatusEvent',
    topic: 'hosts.changed',
    fields: {
      connectionId: 'payload.hostId (saved host profile), distinct from envelope Agent identity',
      status: 'payload.status validated by UI projection',
      error: 'payload.error optional string',
      updatedAt: 'payload.updatedAt finite number',
    },
    blocker:
      'Old connection identity and new Agent/profile/route identities differ; DTO assignability and pure-barrel checks cannot prove reconnect/SSH lifecycle.',
  },
  {
    name: 'RepositoryStatusEvent',
    topic: 'repositories.changed',
    fields: {
      repositoryId: 'resource.resourceId',
      connectionId: 'resource.agentId',
      isDirty: 'fresh repository status read after invalidation',
      currentBranch: 'fresh repository status read after invalidation',
      ahead: 'fresh repository status read after invalidation',
      behind: 'fresh repository status read after invalidation',
    },
    blocker:
      'Changed event is an invalidation, not a frozen status snapshot. No fabricated isDirty/branch/ahead/behind fields are accepted as equivalence.',
  },
  {
    name: 'ServerEvents',
    topic: 'AgentEvent.type + envelope',
    fields: {
      'connection:status': 'hosts.changed',
      'repo:status': 'repositories.changed',
      'command:output': 'commands.output',
      'command:exit': 'commands.exit',
    },
    blocker:
      'Four legacy categories have scoped successors; Agent events add identity/session/sequence/ACK semantics and additional topics. Dictionary naming does not establish source-module or aggregate compatibility.',
  },
];
